// POST /api/transferencias/[id]/emitir — emite a nota da transferência no Tiny.
//
// IRREVERSÍVEL. Mesma trava "permitir_emissao" da emissão de pedidos (checada
// aqui e de novo dentro de emitirNota). Depois de emitir, lê o número da NF
// da nota autorizada no Tiny e grava no Supabase, para a tela mostrar e para
// a busca por nº.
//
// Antes de emitir, lê a nota no Tiny e confere a natureza de operação contra
// a do payload enviado: nome que não existe no cadastro do Tiny vira "Venda
// para contribuinte" sem erro nenhum, e aí a nota sairia com CFOP de venda.

import { conferirNatureza, emitirNota, obterNota, obterSituacaoNota } from '@/lib/integrations/tiny';
import { paraGidTransferencia } from '@/lib/integrations/shopifyTransferencias';
import {
  atualizarNotaEmitida,
  obterPermitirEmissao,
  obterRascunhoCriado,
  registrarNumeroNf,
  statusPorPedido,
} from '@/lib/db';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const { id } = await params;
  const gid = paraGidTransferencia(id);

  // O id da nota vem do Supabase, não do navegador: emitir a nota errada é o
  // pior erro possível aqui.
  const situacao = (await statusPorPedido([gid]))[gid];
  if (situacao?.status !== 'rascunho_criado' || !situacao.tiny_nota_id) {
    return erroJson('Esta transferência ainda não tem rascunho criado no Tiny.', 400);
  }
  if (situacao.nota_emitida) return erroJson('Esta nota já foi emitida.', 409);

  if (!(await obterPermitirEmissao())) {
    return erroJson('Emissão bloqueada. Ligue "Permitir emissão" na tela de atacado.', 403);
  }

  const tinyNotaId = situacao.tiny_nota_id;

  const rascunho = await obterRascunhoCriado(gid);
  if (!rascunho.ok) return erroJson(`Não foi possível ler o rascunho no Supabase: ${rascunho.erro}`, 502);
  const esperada = rascunho.rascunho?.payload_enviado?.nota_fiscal?.natureza_operacao;
  if (!esperada?.trim()) {
    return erroJson('O rascunho registrado não tem natureza de operação — refaça o rascunho antes de emitir.', 422);
  }
  let natureza;
  try {
    natureza = conferirNatureza(await obterNota(tinyNotaId), esperada);
  } catch (erro) {
    return erroJson(`Não foi possível conferir a natureza da nota no Tiny: ${erro.message}`, 502);
  }
  if (!natureza.ok) {
    return erroJson(
      `Emissão recusada: a nota ${tinyNotaId} está no Tiny com a natureza ` +
        `"${natureza.naNota ?? '(não informada)'}", mas foi pedida "${esperada}". Confira ` +
        'natureza_operacao_id em lojas_fiscais (id da natureza no Tiny) e use "Novo rascunho".',
      422,
      { naturezaNaNota: natureza.naNota, naturezaEsperada: esperada }
    );
  }

  try {
    await emitirNota(tinyNotaId);
  } catch (erro) {
    return erroJson(erro.message, 502);
  }

  const registro = await atualizarNotaEmitida(gid, true);
  if (!registro.ok) {
    console.error(`[transferencia] Nota ${tinyNotaId} emitida no Tiny, mas falhou ao registrar no Supabase:`, registro.erro);
  }

  // Número da NF, só da nota já autorizada. A autorização na SEFAZ pode
  // demorar: sem número agora, a tela busca de novo depois
  // (/api/transferencias/[id]/situacao). Falhar aqui não é erro da emissão.
  let numeroNf = null;
  try {
    numeroNf = (await obterSituacaoNota(tinyNotaId)).numero;
    if (numeroNf) {
      await registrarNumeroNf({ orderId: gid, numeroNf });
    }
  } catch (erro) {
    console.error(`[transferencia] Nota ${tinyNotaId} emitida, mas não foi possível ler o número no Tiny:`, erro);
  }

  return Response.json({ ok: true, tinyNotaId, numeroNf, mensagem: 'Nota emitida no Tiny.' });
}
