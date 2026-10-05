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
// Emissão fiscal (nota.fiscal.emitir) mora em /api/pedidos/[id]/emitir.

import { garantirContribuinteIcms, incluirNotaRascunho, obterNota } from '@/lib/integrations/tiny';
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
    const { idNota, retorno } = await incluirNotaRascunho(payload);

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
      payload,
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

    return Response.json({
      ok: true,
      tinyNotaId: idNota,
      confirmacao,
      contribuinte,
      tinyNotaIdAnterior: anterior?.tiny_nota_id ?? null,
      mensagem: anterior
        ? `Novo rascunho criado no Tiny no lugar do ${anterior.tiny_nota_id} — é este que "Emitir nota" ` +
          `vai emitir. Cancele ou exclua o rascunho ${anterior.tiny_nota_id} dentro do Tiny: a API não ` +
          'faz isso, e os dois ficam duplicados até você remover o antigo à mão.'
        : 'Rascunho criado no Tiny. Confira os dados e emita a nota pela tela de atacado.',
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
