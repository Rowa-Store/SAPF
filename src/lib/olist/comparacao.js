// comparacao.js — monta a comparação Shopify x Olist de uma busca. Usado
// pela rota que mostra a comparação e pela que traz do Shopify, que refaz
// a leitura em vez de confiar no que a tela mandou.

import { buscarProdutosParaOlist, obterProdutoParaOlist } from '../integrations/shopifyProdutos.js';
import { produtoPaiNoTiny, variacoesDoPai } from '../integrations/tiny.js';
import { compararProduto, normalizarCodigo } from './produtoTiny.js';

/**
 * Cada produto do Shopify (uma cor) comparado com o pai dele na Olist.
 *
 * @param {{ busca: string, familia?: boolean, skus?: string[] }} filtro
 *   `skus` restringe aos produtos que têm algum destes SKUs — os outros nem
 *   são consultados no Tiny.
 * @returns {Promise<{ produtos: object[], cadastros: Record<string, object|null> }>}
 *   cadastros: o cadastro completo do pai na Olist, por id do produto do Shopify.
 */
export async function compararBusca({ busca, familia = false, skus = null }) {
  let produtos = await buscarProdutosParaOlist(busca, { familia });
  if (skus) {
    const pedidos = new Set(skus.map(normalizarCodigo));
    produtos = produtos.filter((p) => p.variants.some((v) => pedidos.has(normalizarCodigo(v.sku))));
  }

  const comparados = [];
  const cadastros = {};
  // Um produto por vez: a API do Tiny limita chamadas por minuto.
  for (const produto of produtos) {
    const codigos = produto.variants.map((v) => String(v.sku ?? '').trim()).filter(Boolean);
    const noTiny = await produtoPaiNoTiny({ nome: produto.title, codigos });
    cadastros[produto.id] = noTiny.pai;
    comparados.push(compararProduto(produto, noTiny, variacoesDoPai));
  }
  return { produtos: comparados, cadastros };
}

/** Um produto do Shopify (pelo id) comparado com o pai dele na Olist —
 *  o que a gravação usa, um produto por requisição. */
export async function compararProdutoPorId(produtoId) {
  const produto = await obterProdutoParaOlist(produtoId);
  const codigos = produto.variants.map((v) => String(v.sku ?? '').trim()).filter(Boolean);
  const noTiny = await produtoPaiNoTiny({ nome: produto.title, codigos });
  return { produto: compararProduto(produto, noTiny, variacoesDoPai), cadastro: noTiny.pai };
}
