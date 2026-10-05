// POST /api/pedidos/[id]/emitir — emite a nota no Tiny (dá valor fiscal).
//
// ESTE ENDPOINT É IRREVERSÍVEL. Só funciona com a trava "permitir_emissao"
// ligada (tela de atacado) — checada de novo aqui e dentro de
// lib/integrations/tiny.js::emitirNota, então nenhuma das duas pode ser pulada.
// Antes de emitir, garante o cliente como Contribuinte ICMS no cadastro do
// Tiny (ver tiny.js) — sem isso a nota do atacado não sai. Depois de emitir,
// lê o número da NF da nota autorizada e grava no Supabase.

import { emitirNota, garantirContribuinteIcms, obterSituacaoNota } from '@/lib/integrations/tiny';
import {
  obterPermitirEmissao,
  obterRascunhoCriado,
  atualizarNotaEmitida,
  registrarNumeroNf,
  statusPorPedido,
} from '@/lib/db';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const { id } = await params;
  const gid = paraGid(id);

  // O id da nota vem do Supabase, não do navegador: emitir a nota errada é o
  // pior erro possível aqui.
  const situacao = (await statusPorPedido([gid]))[gid];
  if (situacao?.status !== 'rascunho_criado' || !situacao.tiny_nota_id) {
    return erroJson('Este pedido ainda não tem rascunho criado no Tiny.', 400);
  }
  if (situacao.nota_emitida) return erroJson('Esta nota já foi emitida.', 409);

  const permitido = await obterPermitirEmissao();
  if (!permitido) {
    return erroJson('Emissão bloqueada. Ligue "Permitir emissão" no topo da tela de atacado.', 403);
  }

  const tinyNotaId = situacao.tiny_nota_id;

  // O cliente vem do payload que foi para o Tiny neste rascunho. Emitir sem
  // Contribuinte ICMS seria irreversível — então aqui a falha bloqueia.
  const rascunho = await obterRascunhoCriado(gid);
  const cliente = rascunho.rascunho?.payload_enviado?.nota_fiscal?.cliente;
  if (!cliente?.cpf_cnpj) {
    return erroJson(
      'Não foi possível ler o cliente do rascunho para conferir o Contribuinte ICMS' +
        `${rascunho.erro ? `: ${rascunho.erro}` : ''}. A nota não foi emitida.`,
      502
    );
  }
  const contribuinte = await garantirContribuinteIcms(cliente.cpf_cnpj, { clienteNota: cliente });
  if (!contribuinte.ok) {
    return erroJson(
      `${contribuinte.mensagem} A nota não foi emitida — marque o cliente como Contribuinte ICMS no Tiny e tente de novo.`,
      502
    );
  }

  try {
    await emitirNota(tinyNotaId);
  } catch (erro) {
    return erroJson(erro.message, 502);
  }

  const registro = await atualizarNotaEmitida(gid, true);
  if (!registro.ok) {
    console.error(`[emitir] Nota ${tinyNotaId} emitida no Tiny, mas falhou ao registrar no Supabase:`, registro.erro);
  }

  // A autorização na SEFAZ pode demorar: sem número agora, a tela confere de
  // novo depois (/api/pedidos/[id]/situacao). Falhar aqui não é erro da emissão.
  let numeroNf = null;
  try {
    numeroNf = (await obterSituacaoNota(tinyNotaId)).numero;
    if (numeroNf) await registrarNumeroNf({ orderId: gid, numeroNf });
  } catch (erro) {
    console.error(`[emitir] Nota ${tinyNotaId} emitida, mas não foi possível ler o número no Tiny:`, erro);
  }

  return Response.json({
    ok: true,
    tinyNotaId,
    numeroNf,
    mensagem: 'Nota emitida no Tiny.',
  });
}
