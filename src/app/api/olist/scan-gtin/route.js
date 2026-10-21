// GET /api/olist/scan-gtin?cursor=... — uma página de 100 produtos do Shopify
// (qualquer status, os mais recentes primeiro) com o barcode de cada
// variante, para o scan de GTIN duplicado (tela /olist/scan-gtin). Só lê.
// Responde 429 quando o Shopify recusa por limite de custo (Throttled).

import { paginaDeBarcodes } from '@/lib/integrations/shopifyProdutos';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TAMANHO_DA_PAGINA = 100;

export async function GET(request) {
  const cursor = new URL(request.url).searchParams.get('cursor') || null;
  try {
    return Response.json(await paginaDeBarcodes({ cursor, tamanho: TAMANHO_DA_PAGINA }));
  } catch (e) {
    return /throttled/i.test(e.message)
      ? erroJson('Limite de chamadas do Shopify atingido.', 429, { limite: true })
      : erroJson(e.message, 502);
  }
}
