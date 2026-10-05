// /api/pedidos/[id]/rascunho — inclusão do rascunho da nota no Tiny.
//
// ESTE ENDPOINT ESCREVE EM PRODUÇÃO.
//
//   - POST cria o rascunho. Exige `confirmacaoTeste: true`. Com
//     `substituir: true`, cria um NOVO mesmo que o pedido já tenha rascunho
//     (às vezes o Tiny acusa duplicidade e a saída é reenviar com uma
//     alteração mínima). O novo passa a ser o rascunho do pedido — é ele que
//     "Emitir nota" emite — e o antigo vai para tiny_notas_substituidas, para
//     ser removido à mão no Tiny. Nota já emitida nunca é substituída.
//   - GET  devolve o rascunho já criado (o payload realmente enviado ao Tiny).
//
// A API 2.0 do Tiny não altera nota: cliente e itens se ajustam na tela de
// conferência (/pedidos/[id]/rascunho) e seguem num rascunho novo.
//
// Se o Tiny recusar com "Um produto pai não pode ser informado", o código do
// pai é trocado pelo da variação certa (ver trocarProdutosPai em tiny.js) e a
// inclusão é tentada mais UMA vez. O payload gravado é o que foi aceito.
//
// Emissão fiscal (nota.fiscal.emitir) mora em /api/pedidos/[id]/emitir.

import {
  erroDeProdutoPai,
  garantirContribuinteIcms,
  incluirNotaRascunho,
  obterNota,
  trocarProdutosPai,
} from '@/lib/integrations/tiny';
import { obterPedidoCompleto } from '@/lib/integrations/shopify';
import {
  obterRascunhoCriado,
  registrarRascunhoCriado,
  registrarErro,
  salvarItensPendentes,
  statusPorPedido,
} from '@/lib/db';
import { totalDaNota } from '@/lib/fiscal/montarNota';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Tamanho/cor de cada SKU do pedido no Shopify, para achar a variação certa
 * no Tiny. Falhar aqui não impede a troca — só deixa a escolha sem opções.
 */
async function opcoesPorSku(gid) {
  try {
    const pedido = await obterPedidoCompleto(gid);
    const mapa = {};
    for (const linha of pedido.lineItems ?? []) {
      if (!linha.sku) continue;
      const selecionadas = (linha.variant?.selectedOptions ?? [])
        .map((o) => o.value)
        .filter((v) => v && v !== 'Default Title');
      mapa[linha.sku] = selecionadas.length
        ? selecionadas
        : String(linha.variantTitle ?? '')
            .split(' / ')
            .map((v) => v.trim())
            .filter((v) => v && v !== 'Default Title');
    }
    return mapa;
  } catch (erro) {
    console.error(`[rascunho] Não foi possível ler as opções dos itens do pedido ${gid} no Shopify:`, erro);
    return {};
  }
}

/**
 * Inclui o rascunho; se o Tiny recusar por produto pai, troca pelos códigos
 * das variações e tenta de novo uma vez. Devolve também o payload aceito e
 * as trocas feitas. Lança com a lista do que não deu para resolver.
 */
async function incluirTrocandoProdutosPai(payload, gid) {
  try {
    return { ...(await incluirNotaRascunho(payload)), payload, trocas: [] };
  } catch (erro) {
    if (!erroDeProdutoPai(erro.message)) throw erro;

    const { itens, trocas, pendentes } = await trocarProdutosPai(payload.nota_fiscal.itens, await opcoesPorSku(gid), {
      mensagemErro: erro.message,
    });
    if (pendentes.length > 0 || trocas.length === 0) {
      const detalhe = pendentes.length
        ? pendentes.map((p) => `${p.codigo}${p.descricao ? ` (${p.descricao})` : ''}: ${p.motivo}`).join('; ')
        : 'nenhum código da nota foi encontrado como produto pai no Tiny';
      throw new Error(
        `${erro.message}. Não deu para trocar pela variação automaticamente — ${detalhe}. ` +
          'Corrija o SKU no Shopify ou o cadastro no Tiny e tente de novo.'
      );
    }

    const corrigido = { ...payload, nota_fiscal: { ...payload.nota_fiscal, itens } };
    return { ...(await incluirNotaRascunho(corrigido)), payload: corrigido, trocas };
  }
}

export async function GET(request, { params }) {
  const { id } = await params;
  const gid = paraGid(id);

  const { ok, erro, rascunho } = await obterRascunhoCriado(gid);
  if (!ok) return erroJson(`Não foi possível carregar o rascunho: ${erro}`, 502);
  if (!rascunho) return erroJson('Este pedido ainda não tem rascunho criado no Tiny.', 404);

  return Response.json({
    orderName: rascunho.shopify_order_name,
    classificacao: rascunho.classificacao,
    payload: rascunho.payload_enviado,
    totalNota: rascunho.payload_enviado ? totalDaNota(rascunho.payload_enviado) : 0,
    tinyNotaId: rascunho.tiny_nota_id,
    notaEmitida: rascunho.nota_emitida,
    tinyNotasSubstituidas: rascunho.tiny_notas_substituidas ?? [],
  });
}

export async function POST(request, { params }) {
  const { id } = await params;
  const gid = paraGid(id);

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);
  }

  const { payload, classificacao, orderName, confirmacaoTeste, itensPendentes, substituir } = corpo ?? {};

  // Trava 1 — confirmação explícita de que a pessoa sabe que isso escreve no Tiny real.
  if (confirmacaoTeste !== true) {
    return erroJson(
      'Confirmação ausente. Marque a caixa de confirmação na tela: criar o rascunho ' +
        'grava uma nota real no Tiny de produção, mesmo a partir de um pedido fictício.',
      400
    );
  }

  if (!payload?.nota_fiscal?.itens?.length) {
    return erroJson('Payload sem itens. Volte à tela do rascunho e confira o pedido.', 400);
  }

  // Trava 2 — segundo rascunho para o mesmo pedido só quando pedido
  // explicitamente (`substituir`), e nunca por cima de nota emitida.
  let situacao;
  try {
    situacao = (await statusPorPedido([gid]))[gid];
  } catch (erro) {
    return erroJson(`Não foi possível conferir se o pedido já tem rascunho: ${erro.message}`, 502);
  }
  if (situacao?.nota_emitida) {
    return erroJson(
      `A nota deste pedido já foi emitida${situacao.numero_nf ? ` (NF ${situacao.numero_nf})` : ''} — ` +
        'não dá para enviar outro rascunho.',
      409
    );
  }
  const anterior = situacao?.status === 'rascunho_criado' ? situacao : null;
  if (anterior && substituir !== true) {
    return erroJson(
      `Pedido já processado: o rascunho ${anterior.tiny_nota_id} existe no Tiny. ` +
        'Confirme na tela que quer enviar um novo rascunho no lugar dele.',
      409,
      { tinyNotaId: anterior.tiny_nota_id }
    );
  }

  // "Contribuinte" não é campo da nota — a nota herda do cadastro do cliente
  // (ver tiny.js). Então o cadastro é marcado como Contribuinte ICMS ANTES da
  // inclusão. Falhar aqui não derruba o rascunho: a nota ainda é só rascunho e
  // a emissão é manual dentro do Tiny, então o aviso volta para a tela e a
  // pessoa decide o que fazer.
  const contribuinte = await garantirContribuinteIcms(payload?.nota_fiscal?.cliente?.cpf_cnpj, {
    clienteNota: payload?.nota_fiscal?.cliente,
  });
  if (!contribuinte.ok) {
    console.error(`[rascunho] Pedido ${gid}: ${contribuinte.mensagem}`);
  }

  try {
    const { idNota, retorno, payload: payloadAceito, trocas } = await incluirTrocandoProdutosPai(payload, gid);

    // Confirma no Tiny que a nota existe mesmo (a inclusão pode responder ok
    // sem que a nota seja localizável — melhor conferir e mostrar o resultado).
    let confirmacao = null;
    if (idNota) {
      confirmacao = await obterNota(idNota).catch((erro) => ({ aviso: erro.message }));
    }

    // Acumula: um rascunho refeito duas vezes deixa dois antigos para remover no Tiny.
    const notasSubstituidas = anterior
      ? [...(anterior.tiny_notas_substituidas ?? []), anterior.tiny_nota_id].filter(Boolean)
      : undefined;

    const registro = await registrarRascunhoCriado({
      orderId: gid,
      orderName,
      classificacao,
      payload: payloadAceito,
      tinyNotaId: idNota,
      respostaTiny: retorno,
      notasSubstituidas,
    });
    // A nota já foi criada no Tiny — isso não pode falhar por causa do
    // histórico, mas também não pode ficar invisível se o registro falhar.
    if (!registro.ok) {
      console.error(`[rascunho] Nota ${idNota} criada no Tiny, mas falhou ao registrar no Supabase:`, registro.erro);
    }

    if (itensPendentes?.length) {
      await salvarItensPendentes(orderName, itensPendentes);
    }

    const avisoTrocas = trocas.length
      ? ` O Tiny recusou produto pai — trocado pela variação: ${trocas.map((t) => `${t.de} → ${t.para}`).join(', ')}.`
      : '';

    return Response.json({
      ok: true,
      tinyNotaId: idNota,
      confirmacao,
      contribuinte,
      trocasProdutoPai: trocas,
      tinyNotaIdAnterior: anterior?.tiny_nota_id ?? null,
      mensagem: (anterior
        ? `Novo rascunho criado no Tiny no lugar do ${anterior.tiny_nota_id} — é este que "Emitir nota" ` +
          `vai emitir. Cancele ou exclua o rascunho ${anterior.tiny_nota_id} dentro do Tiny: a API não ` +
          'faz isso, e os dois ficam duplicados até você remover o antigo à mão.'
        : 'Rascunho criado no Tiny. Confira os dados e emita a nota pela tela de atacado.') + avisoTrocas,
    });
  } catch (erro) {
    console.error(`[rascunho] Tiny recusou a inclusão do pedido ${gid}:`, erro);
    // Com rascunho anterior, o erro NÃO vai para o registro: marcaria o
    // pedido como "erro" e o rascunho que já existe deixaria de ser emitível.
    if (anterior) {
      return erroJson(
        `O Tiny recusou o novo rascunho: ${erro.message}. O rascunho ${anterior.tiny_nota_id} continua ` +
          'valendo. Se o Tiny acusou duplicidade, faça uma alteração mínima e envie de novo.',
        502
      );
    }
    await registrarErro({ orderId: gid, orderName, classificacao, payload, mensagem: erro.message });
    return erroJson(`O Tiny recusou a inclusão da nota: ${erro.message}`, 502);
  }
}
