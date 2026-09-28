// /api/pedidos/[id]/rascunho — inclusão do rascunho da nota no Tiny.
//
// ESTE ENDPOINT ESCREVE EM PRODUÇÃO.
//
//   - POST cria o rascunho. Exige `confirmacaoTeste: true`.
//   - GET  devolve o rascunho já criado (o payload realmente enviado ao Tiny).
//
// Não existe edição: depois de enviado ao Tiny, o rascunho do pedido não é
// alterado por este sistema — cliente e itens se ajustam antes, na tela de
// conferência (/pedidos/[id]/rascunho).
//
// Emissão fiscal (nota.fiscal.emitir) mora em /api/pedidos/[id]/emitir.

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
