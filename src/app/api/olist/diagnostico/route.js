// GET /api/olist/diagnostico?cursor=... — uma página de 20 produtos ativos do
// Shopify para a varredura do diagnóstico. Só o Shopify: a tela compara cada
// produto com a Olist um por vez (/api/olist/comparar?produtoId=...), por
// causa do limite de chamadas por minuto do Tiny. Só lê.

import { paginaDeProdutos } from '@/lib/integrations/shopifyProdutos';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TAMANHO_DO_LOTE = 20;

export async function GET(request) {
  const cursor = new URL(request.url).searchParams.get('cursor') || null;
  try {
    return Response.json(await paginaDeProdutos({ cursor, tamanho: TAMANHO_DO_LOTE }));
  } catch (e) {
    return erroJson(e.message, 502);
  }
}
