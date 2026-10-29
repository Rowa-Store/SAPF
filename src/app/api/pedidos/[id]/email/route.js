// POST /api/pedidos/[id]/email — manda de novo a nota emitida (XML + link do
// DANFE) para o e-mail do cadastro da franquia. Botão da tela do pedido; o
// envio automático fica na emissão e na conferência (ver emailNotaFranquia.js).

import { statusPorPedido } from '@/lib/db';
import { enviarNotaParaFranquia, franquiaDoPedido } from '@/lib/fiscal/emailNotaFranquia';
import { erroJson, paraGid } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const { id } = await params;
  const gid = paraGid(id);

  const situacao = (await statusPorPedido([gid]))[gid];
  if (!situacao?.nota_emitida || !situacao.tiny_nota_id || !situacao.numero_nf) {
    return erroJson('A nota deste pedido ainda não foi emitida e autorizada.', 400);
  }

  const franquia = await franquiaDoPedido(gid);
  if (!franquia) return erroJson('O cliente desta nota não é uma franquia ativa no cadastro (B2B > Clientes).', 400);

  const resultado = await enviarNotaParaFranquia({ orderId: gid, tinyNotaId: situacao.tiny_nota_id, franquia, reenvio: true });
  if (!resultado?.enviado) return erroJson(resultado?.aviso ?? 'A nota não foi enviada.', 502);
  return Response.json(resultado);
}
