// GET /api/olist/comparar?busca=...&familia=1 — o produto do Shopify (pelo
// SKU de uma variação ou pelo nome), com todos os tamanhos, lado a lado com o
// cadastro de cada SKU na Olist. `familia=1` traz também as outras cores do
// mesmo modelo. Só lê.

import { compararBusca } from '@/lib/olist/comparacao';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  const parametros = new URL(request.url).searchParams;
  const busca = (parametros.get('busca') ?? '').trim();
  if (!busca) return erroJson('Informe um SKU ou nome de produto.', 400);

  try {
    const { produtos } = await compararBusca({ busca, familia: parametros.get('familia') === '1' });
    return Response.json({ produtos });
  } catch (e) {
    return erroJson(e.message, 502);
  }
}
