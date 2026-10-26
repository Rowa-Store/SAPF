// POST /api/olist/planilha — planilha de importação do Tiny com os SKUs que
// não estão na Olist, para cadastrar pela importação de planilha em vez da
// API (ver planilhaTiny.js). Só lê o Shopify: nenhuma chamada ao Tiny.
//
// Corpo: { itens: [{ produtoId, skus }] } — os SKUs sem cadastro que o
// diagnóstico achou em cada produto. Responde o .xls.

import { obterProdutosParaOlist } from '@/lib/integrations/shopifyProdutos';
import { gerarPlanilha } from '@/lib/olist/planilhaTiny';
import { compararProduto, normalizarCodigo } from '@/lib/olist/produtoTiny';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request) {
  const corpo = await request.json().catch(() => null);
  const itens = (Array.isArray(corpo?.itens) ? corpo.itens : []).filter((i) => i?.produtoId && i.skus?.length);
  if (!itens.length) return erroJson('Nenhum SKU para a planilha.', 400);
  const skusDe = new Map(itens.map((i) => [String(i.produtoId), new Set(i.skus.map(normalizarCodigo))]));

  let produtos;
  try {
    produtos = await obterProdutosParaOlist([...skusDe.keys()]);
  } catch (e) {
    return erroJson(e.message, 502);
  }

  // Comparado com uma Olist vazia: cada linha sai com o que o produto.incluir mandaria.
  const linhas = produtos.flatMap((produto) => {
    const pedidos = skusDe.get(produto.id) ?? new Set();
    return compararProduto(produto, {}).linhas.filter((l) => l.sku && pedidos.has(normalizarCodigo(l.sku)));
  });
  if (!linhas.length) return erroJson('Nenhum dos SKUs foi encontrado no Shopify.', 404);

  const data = new Date().toISOString().slice(0, 10);
  return new Response(gerarPlanilha(linhas), {
    headers: {
      'Content-Type': 'application/vnd.ms-excel',
      'Content-Disposition': `attachment; filename="produtos-tiny-${data}.xls"`,
    },
  });
}
