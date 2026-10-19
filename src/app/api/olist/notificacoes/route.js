// GET /api/olist/notificacoes — produtos já levados à Olist que mudaram no
// Shopify depois do último envio (updatedAt mais novo que o gravado). A tela
// /olist consulta de tempos em tempos e mostra no aviso do topo.

import { listarProdutosOlist } from '@/lib/db';
import { atualizacoesDosProdutos } from '@/lib/integrations/shopifyProdutos';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { ok, erro, produtos } = await listarProdutosOlist();
  if (!ok) return erroJson(`Não foi possível ler os produtos enviados: ${erro}`, 502);

  try {
    const atuais = await atualizacoesDosProdutos(produtos.map((p) => p.shopify_product_id));
    const atualizados = produtos
      .map((p) => ({ ...p, atual: atuais[p.shopify_product_id] }))
      .filter(
        ({ atual, shopify_atualizado_em }) =>
          atual && (!shopify_atualizado_em || Date.parse(atual.atualizadoEm) > Date.parse(shopify_atualizado_em))
      )
      .map(({ shopify_product_id, titulo, atual }) => ({
        id: shopify_product_id,
        titulo: atual.titulo ?? titulo,
        atualizadoEm: atual.atualizadoEm,
      }));
    return Response.json({ atualizados });
  } catch (e) {
    return erroJson(`Não foi possível consultar o Shopify: ${e.message}`, 502);
  }
}
