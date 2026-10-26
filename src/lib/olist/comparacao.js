// comparacao.js — monta a comparação Shopify x Olist de uma busca. Usado
// pela rota que mostra a comparação e pela que traz do Shopify, que refaz
// a leitura em vez de confiar no que a tela mandou.

import { buscarProdutosParaOlist, obterProdutoParaOlist } from '../integrations/shopifyProdutos.js';
import { produtosNoTinyPorCodigo } from '../integrations/tiny.js';
import { compararProduto, normalizarCodigo } from './produtoTiny.js';

// O que o registro da pesquisa do Tiny traz para comparar (sem NCM nem peso).
const CAMPOS_DA_PESQUISA = ['nome', 'preco'];

const codigosDe = (produto) => produto.variants.map((v) => String(v.sku ?? '').trim()).filter(Boolean);

/**
 * Cada produto do Shopify (uma cor) comparado com a Olist, SKU a SKU.
 *
 * @param {{ busca: string, familia?: boolean, skus?: string[] }} filtro
 *   `skus` restringe aos produtos que têm algum destes SKUs — os outros nem
 *   são consultados no Tiny.
 * @returns {Promise<{ produtos: object[], cadastros: Record<string, object> }>}
 *   cadastros: o que o Tiny tem de cada código, por código normalizado.
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
    const noTiny = await produtosNoTinyPorCodigo(codigosDe(produto), null, { nome: produto.title });
    Object.assign(cadastros, noTiny);
    comparados.push(compararProduto(produto, noTiny));
  }
  return { produtos: comparados, cadastros };
}

/** Um produto do Shopify (pelo id) comparado com a Olist — o que a
 *  gravação usa, um produto por requisição. `leve`: só nome, preço e
 *  situação, sem o produto.obter de cada SKU (o diagnóstico que procura só
 *  os não cadastrados ou os de preço desatualizado). */
export async function compararProdutoPorId(produtoId, { leve = false } = {}) {
  const produto = await obterProdutoParaOlist(produtoId);
  const cadastros = await produtosNoTinyPorCodigo(codigosDe(produto), null, { nome: produto.title, completo: !leve });
  const campos = leve ? CAMPOS_DA_PESQUISA : undefined;
  return { produto: compararProduto(produto, cadastros, { campos }), cadastros };
}
