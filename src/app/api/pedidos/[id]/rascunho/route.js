// /api/pedidos/[id]/rascunho — inclusão e edição do rascunho da nota no Tiny.
//
// ESTES ENDPOINTS ESCREVEM EM PRODUÇÃO.
//
//   - POST cria o rascunho pela primeira vez. Exige `confirmacaoTeste: true`.
//   - GET  devolve o rascunho já criado (o payload realmente enviado ao Tiny),
//     para a tela de edição carregar.
//   - PUT  "edita" um rascunho já existente. A API 2.0 do Tiny não tem
//     endpoint para alterar nem excluir uma nota, então editar aqui significa
//     criar um NOVO rascunho com os dados corrigidos — o antigo precisa ser
//     cancelado/excluído manualmente dentro do Tiny. Por isso o retorno
//     sempre inclui o id da nota antiga, para a tela deixar isso explícito.
//
// Nenhum dos dois trata emissão fiscal (nota.fiscal.emitir) — isso mora em
// /api/pedidos/[id]/emitir.

import { garantirContribuinteIcms, incluirNotaRascunho, obterNota } from '@/lib/integrations/tiny';
import {
  jaProcessado,
  obterRascunhoCriado,
  registrarRascunhoCriado,
  registrarErro,
  salvarItensPendentes,
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

export async function PUT(request, { params }) {
  const { id } = await params;
  const gid = paraGid(id);

  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return erroJson('Corpo da requisição inválido: era esperado um JSON.', 400);
  }

  const { payload, confirmacaoTeste } = corpo ?? {};

  if (confirmacaoTeste !== true) {
    return erroJson(
      'Confirmação ausente. Marque a caixa de confirmação na tela: isto cria um NOVO rascunho no ' +
        'Tiny com os dados corrigidos — o rascunho antigo precisa ser cancelado/excluído manualmente ' +
        'dentro do Tiny, porque a API não permite fazer isso.',
      400
    );
  }

  if (!payload?.nota_fiscal?.itens?.length) {
    return erroJson('Payload sem itens. Volte e confira os dados antes de salvar.', 400);
  }

  const atual = await obterRascunhoCriado(gid);
  if (!atual.ok) return erroJson(`Não foi possível confirmar o rascunho atual: ${atual.erro}`, 502);
  if (!atual.rascunho) {
    return erroJson('Este pedido ainda não tem rascunho criado no Tiny — use a inclusão normal.', 404);
  }
  if (atual.rascunho.nota_emitida) {
    return erroJson('Esta nota já foi emitida no Tiny. Uma nota emitida não pode ser recriada por aqui.', 409);
  }

  const tinyNotaIdAnterior = atual.rascunho.tiny_nota_id;
  const { classificacao, shopify_order_name: orderName } = atual.rascunho;

  try {
    const { idNota, retorno } = await incluirNotaRascunho(payload);

    let confirmacao = null;
    if (idNota) {
      confirmacao = await obterNota(idNota).catch((erro) => ({ aviso: erro.message }));
    }

    // Acumula: um rascunho corrigido duas vezes deixa dois antigos para remover no Tiny.
    const notasSubstituidas = [...(atual.rascunho.tiny_notas_substituidas ?? [])];
    if (tinyNotaIdAnterior) notasSubstituidas.push(tinyNotaIdAnterior);

    const registro = await registrarRascunhoCriado({
      orderId: gid,
      orderName,
      classificacao,
      payload,
      tinyNotaId: idNota,
      respostaTiny: retorno,
      notasSubstituidas,
    });
    if (!registro.ok) {
      console.error(
        `[rascunho] Novo rascunho ${idNota} (corrigindo ${tinyNotaIdAnterior}) criado no Tiny, mas falhou ao registrar no Supabase:`,
        registro.erro
      );
    }

    return Response.json({
      ok: true,
      tinyNotaId: idNota,
      tinyNotaIdAnterior,
      confirmacao,
      mensagem:
        `Novo rascunho ${idNota ?? ''} criado no Tiny com os dados corrigidos. ` +
        `Cancele ou exclua o rascunho ${tinyNotaIdAnterior} dentro do Tiny — a API não faz isso ` +
        'automaticamente, e os dois ficam duplicados até você remover o antigo à mão.',
    });
  } catch (erro) {
    console.error(`[rascunho] Tiny recusou a recriação do pedido ${gid} (substituindo ${tinyNotaIdAnterior}):`, erro);
    return erroJson(`O Tiny recusou a inclusão da nota corrigida: ${erro.message}`, 502);
  }
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

  const { payload, classificacao, orderName, confirmacaoTeste, itensPendentes } = corpo ?? {};

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

  // Trava 2 — nunca criar dois rascunhos para o mesmo pedido.
  const processado = await jaProcessado(gid);
  if (processado.processado) {
    return erroJson(
      `Pedido já processado: o rascunho ${processado.tinyNotaId} existe no Tiny. ` +
        'Cancele ou exclua a nota lá antes de gerar outra.',
      409,
      { tinyNotaId: processado.tinyNotaId }
    );
  }

  // "Contribuinte" não é campo da nota — a nota herda do cadastro do cliente
  // (ver tiny.js). Então o cadastro é marcado como Contribuinte ICMS ANTES da
  // inclusão. Falhar aqui não derruba o rascunho: a nota ainda é só rascunho e
  // a emissão é manual dentro do Tiny, então o aviso volta para a tela e a
  // pessoa decide o que fazer.
  const contribuinte = await garantirContribuinteIcms(payload?.nota_fiscal?.cliente?.cpf_cnpj);
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

    const registro = await registrarRascunhoCriado({
      orderId: gid,
      orderName,
      classificacao,
      payload,
      tinyNotaId: idNota,
      respostaTiny: retorno,
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
      mensagem:
        'Rascunho criado no Tiny. Confira os dados e emita a nota pela tela de atacado.',
    });
  } catch (erro) {
    console.error(`[rascunho] Tiny recusou a inclusão do pedido ${gid}:`, erro);
    await registrarErro({ orderId: gid, orderName, classificacao, payload, mensagem: erro.message });
    return erroJson(`O Tiny recusou a inclusão da nota: ${erro.message}`, 502);
  }
}
