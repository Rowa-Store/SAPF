// shopifyProdutos.js — leitura de produtos do Shopify para a comparação com
// a Olist (tela /olist). Só lê: nada aqui altera o Shopify.
//
// Cada cor é um produto à parte no Shopify ("Legging Estrella - Rosa"), com
// os tamanhos como variantes. A FAMÍLIA é o conjunto de produtos com o mesmo
// modelo — o nome antes do último " - " ("Legging Estrella"); os SKUs de
// cores diferentes não têm prefixo em comum.

import { shopifyGraphQL } from './shopify.js';

const CAMPOS_PRODUTO = `
  id title productType vendor updatedAt
  variants(first: 100) {
    nodes {
      sku title price barcode
      inventoryItem { measurement { weight { unit value } } }
    }
  }
`;

const QUERY_POR_SKU = `
query ProdutoPorSku($busca: String!) {
  productVariants(first: 5, query: $busca) { nodes { product { ${CAMPOS_PRODUTO} } } }
}`;

const QUERY_POR_TITULO = `
query ProdutosPorTitulo($busca: String!) {
  products(first: 50, query: $busca) { nodes { ${CAMPOS_PRODUTO} } }
}`;

const QUERY_ATUALIZACOES = `
query AtualizacoesProdutos($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Product { id title updatedAt } }
}`;

/** Aspas para a sintaxe de busca do Shopify. */
function entreAspas(termo) {
  return `"${String(termo).replace(/["\\]/g, '')}"`;
}

/** Busca por título palavra a palavra ("title:Legging* title:Estrella*"):
 *  com aspas, o curinga do Shopify não funciona. */
function buscaPorTitulo(texto) {
  return String(texto)
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .map((p) => `title:${p}*`)
    .join(' ');
}

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** "Legging Estrella - Rosa" -> "Legging Estrella". Sem " - ", o título inteiro. */
export function modeloDoTitulo(titulo) {
  const texto = String(titulo ?? '').trim();
  const corte = texto.lastIndexOf(' - ');
  return corte > 0 ? texto.slice(0, corte).trim() : texto;
}

function semRepetidos(produtos) {
  return [...new Map(produtos.map((p) => [p.id, { ...p, variants: p.variants?.nodes ?? p.variants }])).values()];
}

/** Produtos cujo modelo é exatamente `modelo`, mais recentes por título. */
async function produtosDoModelo(modelo) {
  const dados = await shopifyGraphQL(QUERY_POR_TITULO, { busca: buscaPorTitulo(modelo) });
  const alvo = normalizar(modelo);
  return semRepetidos(dados.products?.nodes ?? []).filter((p) => normalizar(modeloDoTitulo(p.title)) === alvo);
}

/**
 * Produtos do Shopify para o termo buscado: o SKU de uma variação traz o
 * produto dela (com todos os tamanhos); sem SKU igual, busca pelo nome.
 * `familia: true` acrescenta os outros produtos do mesmo modelo (as outras cores).
 */
export async function buscarProdutosParaOlist(termo, { familia = false } = {}) {
  const texto = String(termo ?? '').trim();
  if (!texto) return [];

  const porSku = await shopifyGraphQL(QUERY_POR_SKU, { busca: `sku:${entreAspas(texto)}` });
  let produtos = semRepetidos((porSku.productVariants?.nodes ?? []).map((n) => n.product));

  const busca = buscaPorTitulo(texto);
  if (produtos.length === 0 && busca) {
    const porTitulo = await shopifyGraphQL(QUERY_POR_TITULO, { busca });
    produtos = semRepetidos(porTitulo.products?.nodes ?? []);
  }

  if (familia && produtos.length) {
    const modelos = [...new Set(produtos.map((p) => modeloDoTitulo(p.title)))];
    const daFamilia = (await Promise.all(modelos.map(produtosDoModelo))).flat();
    produtos = semRepetidos([...produtos, ...daFamilia]);
  }

  return produtos.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
}

// Limite de ids por chamada de `nodes` no Admin API.
const IDS_POR_CONSULTA = 250;

/** `{ [gid]: { titulo, atualizadoEm } }` dos produtos pedidos. Produto
 *  apagado no Shopify não volta no mapa. */
export async function atualizacoesDosProdutos(ids) {
  const resultado = {};
  for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) {
    const dados = await shopifyGraphQL(QUERY_ATUALIZACOES, { ids: ids.slice(i, i + IDS_POR_CONSULTA) });
    for (const p of dados.nodes ?? []) {
      if (p?.id) resultado[p.id] = { titulo: p.title, atualizadoEm: p.updatedAt };
    }
  }
  return resultado;
}

/** Aceita "123" ou o gid completo e sempre devolve o gid do produto. */
export function paraGidProduto(id) {
  const texto = String(id ?? '');
  return texto.startsWith('gid://') ? texto : `gid://shopify/Product/${texto}`;
}
