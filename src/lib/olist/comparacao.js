// comparacao.js — monta a comparação Shopify x Olist de uma busca. Usado
// pela rota que mostra a comparação e pela que traz do Shopify, que refaz
// a leitura em vez de confiar no que a tela mandou.

import { buscarProdutosParaOlist } from '../integrations/shopifyProdutos.js';
import { produtosDoTinyPorCodigo } from '../integrations/tiny.js';
import { compararProdutos, normalizarCodigo } from './produtoTiny.js';

/**
 * @param {{ busca: string, familia?: boolean, skus?: string[] }} filtro
 *   `skus` restringe a consulta ao Tiny a estes códigos (e a comparação aos
 *   produtos que têm algum deles).
 */
export async function compararBusca({ busca, familia = false, skus = null }) {
  let produtos = await buscarProdutosParaOlist(busca, { familia });
  const pedidos = skus ? new Set(skus.map(normalizarCodigo)) : null;
  if (pedidos) {
    produtos = produtos
      .map((p) => ({ ...p, variants: p.variants.filter((v) => pedidos.has(normalizarCodigo(v.sku))) }))
      .filter((p) => p.variants.length);
  }

  const codigos = produtos.flatMap((p) => p.variants.map((v) => v.sku)).filter((s) => String(s ?? '').trim());
  const doTiny = await produtosDoTinyPorCodigo(codigos, { nomes: produtos.map((p) => p.title) });
  return { produtos: compararProdutos(produtos, doTiny), doTiny };
}
