// GET /api/transferencias/[id]/situacao — confere a nota da transferência no
// Tiny e, se ela já estiver autorizada, grava a emissão e o número da NF.
//
// É assim que o número chega quando a nota foi emitida direto no Tiny (fora
// do botão desta tela) ou quando a autorização demorou mais que a emissão. Só
// lê o Tiny: nada é emitido aqui.

import { obterSituacaoNota } from '@/lib/integrations/tiny';
import { contaTinyDaTransferencia, lerNaContaDaNota } from '@/lib/integrations/tinyContas';
import { paraGidTransferencia } from '@/lib/integrations/shopifyTransferencias';
import { atualizarNotaEmitida, registrarNumeroNf, statusPorPedido } from '@/lib/db';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const { id } = await params;
  const gid = paraGidTransferencia(id);

  const situacao = (await statusPorPedido([gid]))[gid];
  if (!situacao?.tiny_nota_id) {
    return Response.json({ notaEmitida: !!situacao?.nota_emitida, numeroNf: situacao?.numero_nf ?? null });
  }

  // A nota mora na conta do Tiny da loja de origem (ou na da matriz, se for
  // anterior às contas por loja).
  const conta = await contaTinyDaTransferencia(id);
  if (!conta.ok) return erroJson(conta.erro, 422);

  let tiny;
  try {
    tiny = await lerNaContaDaNota(conta.conta, (c) => obterSituacaoNota(situacao.tiny_nota_id, c));
  } catch (erro) {
    return erroJson(`Não foi possível consultar a nota no Tiny: ${erro.message}`, 502);
  }

  if (tiny.emitida) {
    if (!situacao.nota_emitida) await atualizarNotaEmitida(gid, true);
    if (tiny.numero && tiny.numero !== situacao.numero_nf) {
      const registro = await registrarNumeroNf({ orderId: gid, numeroNf: tiny.numero });
      if (!registro.ok) console.error(`[transferencia] Falha ao gravar o nº da NF de ${gid}:`, registro.erro);
    }
  }

  return Response.json({
    notaEmitida: tiny.emitida,
    numeroNf: tiny.numero ?? situacao.numero_nf ?? null,
    situacaoTiny: tiny.situacao,
  });
}
