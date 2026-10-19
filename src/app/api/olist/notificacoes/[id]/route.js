// DELETE /api/olist/notificacoes/[id]?atualizadoEm=... — dispensa a
// notificação do produto sem enviar nada à Olist: a alteração do Shopify até
// `atualizadoEm` fica marcada como vista.

import { dispensarAtualizacaoProduto } from '@/lib/db';
import { paraGidProduto } from '@/lib/integrations/shopifyProdutos';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(request, { params }) {
  const atualizadoEm = new URL(request.url).searchParams.get('atualizadoEm');
  if (!atualizadoEm || Number.isNaN(Date.parse(atualizadoEm))) {
    return erroJson('Informe atualizadoEm (data ISO do Shopify).', 400);
  }
  const resultado = await dispensarAtualizacaoProduto(paraGidProduto(params.id), atualizadoEm);
  if (!resultado.ok) return erroJson(`Não foi possível dispensar: ${resultado.erro}`, 502);
  return Response.json({ ok: true });
}
