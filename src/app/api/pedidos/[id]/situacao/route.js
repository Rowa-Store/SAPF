// GET /api/pedidos/[id]/situacao — confere a nota do pedido no Tiny e, se ela
// já estiver autorizada, grava a emissão e o número da NF no Supabase.
//
// É assim que o número chega quando a nota foi emitida direto no Tiny (fora
// do botão da tela de atacado) ou quando a autorização demorou mais que a
// emissão. Só lê o Tiny: nada é emitido aqui. Quando o número chega por aqui
// e o cliente é franquia, é aqui que a nota vai para o e-mail dela.

import { obterSituacaoNota } from '@/lib/integrations/tiny';
import { atualizarNotaEmitida, registrarNumeroNf, statusPorPedido } from '@/lib/db';
import { enviarNotaParaFranquia, franquiaDoPedido } from '@/lib/fiscal/emailNotaFranquia';
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

  let emailFranquia = null;
  if (tiny.emitida) {
    if (!situacao.nota_emitida) await atualizarNotaEmitida(gid, true);
    if (tiny.numero && tiny.numero !== situacao.numero_nf) {
      const registro = await registrarNumeroNf({ orderId: gid, numeroNf: tiny.numero });
      if (!registro.ok) console.error(`[pedido] Falha ao gravar o nº da NF de ${gid}:`, registro.erro);
      emailFranquia = await enviarSeFranquia(gid, situacao.tiny_nota_id);
    }
  }

  return Response.json({
    rascunhoCriado: true,
    tinyNotaId: situacao.tiny_nota_id,
    notaEmitida: tiny.emitida,
    numeroNf: tiny.numero ?? situacao.numero_nf ?? null,
    situacaoTiny: tiny.situacao,
    emailFranquia,
  });
}

/** A nota acabou de ganhar número: se o cliente do rascunho é franquia ativa,
 *  manda a nota para o e-mail dela. Falha aqui só vira aviso. */
async function enviarSeFranquia(gid, tinyNotaId) {
  const franquia = await franquiaDoPedido(gid);
  return franquia ? enviarNotaParaFranquia({ orderId: gid, tinyNotaId, franquia }) : null;
}
