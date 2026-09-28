// GET /api/pedidos/[id]/situacao — confere a nota do pedido no Tiny e, se ela
// já estiver autorizada, grava a emissão e o número da NF no Supabase.
//
// É assim que o número chega quando a nota foi emitida direto no Tiny (fora
// do botão da tela de atacado) ou quando a autorização demorou mais que a
// emissão. Só lê o Tiny: nada é emitido aqui.

import { obterSituacaoNota } from '@/lib/integrations/tiny';
import { atualizarNotaEmitida, registrarNumeroNf, statusPorPedido } from '@/lib/db';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request, { params }) {
  const { id } = await params;
  const gid = paraGid(id);

  const situacao = (await statusPorPedido([gid]))[gid];
  if (situacao?.status !== 'rascunho_criado' || !situacao.tiny_nota_id) {
    return Response.json({
      rascunhoCriado: false,
      notaEmitida: !!situacao?.nota_emitida,
      numeroNf: situacao?.numero_nf ?? null,
    });
  }

  let tiny;
  try {
    tiny = await obterSituacaoNota(situacao.tiny_nota_id);
  } catch (erro) {
    return erroJson(`Não foi possível consultar a nota no Tiny: ${erro.message}`, 502);
  }

  if (tiny.emitida) {
    if (!situacao.nota_emitida) await atualizarNotaEmitida(gid, true);
    if (tiny.numero && tiny.numero !== situacao.numero_nf) {
      const registro = await registrarNumeroNf({ orderId: gid, numeroNf: tiny.numero });
      if (!registro.ok) console.error(`[pedido] Falha ao gravar o nº da NF de ${gid}:`, registro.erro);
    }
  }

  return Response.json({
    rascunhoCriado: true,
    tinyNotaId: situacao.tiny_nota_id,
    notaEmitida: tiny.emitida,
    numeroNf: tiny.numero ?? situacao.numero_nf ?? null,
    situacaoTiny: tiny.situacao,
  });
}
