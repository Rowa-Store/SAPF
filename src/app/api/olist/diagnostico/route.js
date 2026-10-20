// GET /api/olist/diagnostico?cursor=...&desde=... — uma página de 20 produtos
// do Shopify para a varredura do diagnóstico, os mais recentes primeiro.
// `desde` (ISO): só os alterados depois dela (o "atualizar" do diagnóstico).
// Só o Shopify: a tela compara cada produto com a Olist um por vez
// (POST /api/olist/comparar), por causa do limite de chamadas do Tiny. Só lê.

import { paginaDeProdutos } from '@/lib/integrations/shopifyProdutos';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TAMANHO_DO_LOTE = 20;

export async function GET(request) {
  const parametros = new URL(request.url).searchParams;
  const cursor = parametros.get('cursor') || null;
  const desde = parametros.get('desde') || null;
  if (desde && Number.isNaN(Date.parse(desde))) return erroJson('Data `desde` inválida.', 400);
  try {
    return Response.json(await paginaDeProdutos({ cursor, desde, tamanho: TAMANHO_DO_LOTE }));
  } catch (e) {
    return erroJson(e.message, 502);
  }
}
