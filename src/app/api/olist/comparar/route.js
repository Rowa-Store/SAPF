// GET /api/olist/comparar?busca=...&familia=1 — o produto do Shopify (pelo
// SKU de uma variação ou pelo nome), com todos os tamanhos, lado a lado com o
// cadastro de cada SKU na Olist. `familia=1` traz também as outras cores do
// mesmo modelo. `produtoId=...` compara um produto só (o diagnóstico), e
// com `leve=1` só nome, preço e situação — sem ler o cadastro completo de
// cada SKU no Tiny. Só lê.

import { erroDeLimite } from '@/lib/integrations/tiny';
import { compararBusca, compararProdutoPorId } from '@/lib/olist/comparacao';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  const parametros = new URL(request.url).searchParams;
  const busca = (parametros.get('busca') ?? '').trim();
  const produtoId = parametros.get('produtoId');
  if (!busca && !produtoId) return erroJson('Informe um SKU ou nome de produto.', 400);

  try {
    if (produtoId) {
      const { produto } = await compararProdutoPorId(produtoId, { leve: parametros.get('leve') === '1' });
      return Response.json({ produtos: [produto] });
    }
    const { produtos } = await compararBusca({ busca, familia: parametros.get('familia') === '1' });
    return Response.json({ produtos });
  } catch (e) {
    if (erroDeLimite(e.message)) {
      return erroJson('Limite de chamadas por minuto da Olist atingido. Espere um minuto e busque de novo.', 429);
    }
    return erroJson(e.message, 502);
  }
}
