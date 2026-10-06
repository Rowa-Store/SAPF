// POST /api/transferencias/[id]/emitir — emite a nota da transferência no Tiny.
//
// IRREVERSÍVEL — a tela pede confirmação antes. Depois de emitir, lê o número da NF
// da nota autorizada no Tiny e grava no Supabase, para a tela mostrar e para
// a busca por nº.
//
// Antes de emitir, lê a nota no Tiny e confere a natureza de operação contra
// a do payload enviado: nome que não existe no cadastro do Tiny vira "Venda
// para contribuinte" sem erro nenhum, e aí a nota sairia com CFOP de venda.
//
// Tudo na conta do Tiny da loja de origem (tinyContas.js) — e só nela: um
// rascunho que ficou na conta da matriz não é emitido, é refeito.

import { conferirNatureza, emitirNota, obterNota, obterSituacaoNota } from '@/lib/integrations/tiny';
import { contaTinyDaTransferencia } from '@/lib/integrations/tinyContas';
import { paraGidTransferencia } from '@/lib/integrations/shopifyTransferencias';
import {
  anotarErro,
  atualizarNotaEmitida,
  obterRascunhoCriado,
  registrarNumeroNf,
  statusPorPedido,
} from '@/lib/db';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Recusa a emissão e guarda a mensagem para o "Ver erro" da linha. */
async function falhou(gid, mensagem, status, extra) {
  await anotarErro(gid, mensagem);
  return erroJson(mensagem, status, extra);
}

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

  const tinyNotaId = situacao.tiny_nota_id;

  const lida = await contaTinyDaTransferencia(id, { paraGravar: true });
  if (!lida.ok) return falhou(gid, lida.erro, 422);
  const conta = lida.conta;

  const rascunho = await obterRascunhoCriado(gid);
  if (!rascunho.ok) return falhou(gid, `Não foi possível ler o rascunho no Supabase: ${rascunho.erro}`, 502);
  const esperada = rascunho.rascunho?.payload_enviado?.nota_fiscal?.natureza_operacao;
  if (!esperada?.trim()) {
    return falhou(gid, 'O rascunho registrado não tem natureza de operação — refaça o rascunho antes de emitir.', 422);
  }
  let natureza;
  try {
    natureza = conferirNatureza(await obterNota(tinyNotaId, conta), esperada);
  } catch (erro) {
    // Não achar a nota aqui costuma ser rascunho criado em outra conta (a da
    // matriz, antes das contas por loja) — emitir por lá é o erro fiscal.
    return falhou(
      gid,
      `Não foi possível ler a nota ${tinyNotaId} na conta do Tiny de "${conta.nome}": ${erro.message}. ` +
        'Se o rascunho foi criado pela matriz, use "Novo rascunho" para refazê-lo na conta da loja de origem.',
      502
    );
  }
  if (!natureza.ok) {
    return falhou(
      gid,
      `Emissão recusada: a nota ${tinyNotaId} está no Tiny com a natureza ` +
        `"${natureza.naNota ?? '(não informada)'}", mas foi pedida "${esperada}". Confira ` +
        'o id e o nome da natureza em lojas_fiscais (naturezas_tiny da loja de origem) e use "Novo rascunho".',
      422,
      { naturezaNaNota: natureza.naNota, naturezaEsperada: esperada }
    );
  }

  try {
    await emitirNota(tinyNotaId, conta);
  } catch (erro) {
    return falhou(gid, erro.message, 502);
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
    numeroNf = (await obterSituacaoNota(tinyNotaId, conta)).numero;
    if (numeroNf) {
      await registrarNumeroNf({ orderId: gid, numeroNf });
    }
  } catch (erro) {
    console.error(`[transferencia] Nota ${tinyNotaId} emitida, mas não foi possível ler o número no Tiny:`, erro);
  }

  return Response.json({ ok: true, tinyNotaId, numeroNf, mensagem: 'Nota emitida no Tiny.' });
}
