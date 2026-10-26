// shopifyProdutos.js — leitura de produtos do Shopify para a comparação com
// a Olist (tela /olist). Só lê: nada aqui altera o Shopify.
//
// Cada cor é um produto à parte no Shopify ("Legging Estrella - Rosa"), com
// os tamanhos como variantes. A FAMÍLIA é o conjunto de produtos com o mesmo
// modelo — o nome antes do último " - " ("Legging Estrella"); os SKUs de
// cores diferentes não têm prefixo em comum.

import { shopifyGraphQL } from './shopify.js';

const CAMPOS_PRODUTO = `
  id title productType vendor status
  variants(first: 100) {
    nodes {
      sku title price barcode
      selectedOptions { name value }
      inventoryItem { measurement { weight { unit value } } }
    }
  }
`;

const QUERY_POR_SKU = `
query ProdutoPorSku($busca: String!) {
  productVariants(first: 5, query: $busca) { nodes { product { ${CAMPOS_PRODUTO} } } }
}`;

const QUERY_POR_ID = `
query ProdutoPorId($id: ID!) {
  product(id: $id) { ${CAMPOS_PRODUTO} }
}`;

const QUERY_POR_TITULO = `
query ProdutosPorTitulo($busca: String!) {
  products(first: 50, query: $busca) { nodes { ${CAMPOS_PRODUTO} } }
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

/** Um produto do Shopify pelo id (gid ou número), no mesmo formato da busca. */
export async function obterProdutoParaOlist(id) {
  const texto = String(id ?? '');
  const gid = texto.startsWith('gid://') ? texto : `gid://shopify/Product/${texto}`;
  const dados = await shopifyGraphQL(QUERY_POR_ID, { id: gid });
  if (!dados.product) throw new Error(`Produto ${gid} não encontrado no Shopify.`);
  return semRepetidos([dados.product])[0];
}

const QUERY_POR_IDS = `
query ProdutosPorIds($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Product { ${CAMPOS_PRODUTO} } }
}`;

// Produtos por consulta em obterProdutosParaOlist: cada um traz até 100
// variantes, e o custo da consulta cresce com elas.
const PRODUTOS_POR_CONSULTA = 10;

/** Vários produtos do Shopify pelos ids, no formato da busca. Os que não
 *  existem mais ficam de fora. */
export async function obterProdutosParaOlist(ids) {
  const gids = ids.map((id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/Product/${id}`));
  const produtos = [];
  for (let i = 0; i < gids.length; i += PRODUTOS_POR_CONSULTA) {
    const dados = await shopifyGraphQL(QUERY_POR_IDS, { ids: gids.slice(i, i + PRODUTOS_POR_CONSULTA) });
    produtos.push(...(dados.nodes ?? []).filter((n) => n?.id));
  }
  return semRepetidos(produtos);
}

const QUERY_PAGINA = `
query PaginaDeProdutos($primeiros: Int!, $depois: String, $busca: String!, $ordem: ProductSortKeys!) {
  products(first: $primeiros, after: $depois, query: $busca, sortKey: $ordem, reverse: true) {
    nodes { id title status createdAt variants(first: 100) { nodes { sku } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Uma página de produtos do Shopify para a varredura do diagnóstico
 * (/olist/diagnostico), os mais recentes primeiro. Sem `desde`: os ativos,
 * pela data de criação. Com `desde` (ISO): os alterados depois dela, de
 * qualquer status — quem deixou de estar ativo sai do diagnóstico —, pela
 * data de alteração. Só id, título e SKUs: a comparação relê o produto.
 *
 * @returns {Promise<{ produtos: { id, titulo, status, criado, skus: string[] }[], proximo: string|null }>}
 *   proximo: cursor da página seguinte (null na última).
 */
export async function paginaDeProdutos({ cursor = null, tamanho = 50, desde = null } = {}) {
  const dados = await shopifyGraphQL(QUERY_PAGINA, {
    primeiros: tamanho,
    depois: cursor,
    busca: desde ? `updated_at:>'${new Date(desde).toISOString()}'` : 'status:active',
    ordem: desde ? 'UPDATED_AT' : 'CREATED_AT',
  });
  const { nodes = [], pageInfo } = dados.products ?? {};
  return {
    produtos: nodes.map((p) => ({
      id: p.id,
      titulo: p.title,
      status: p.status,
      criado: p.createdAt,
      skus: (p.variants?.nodes ?? []).map((v) => String(v.sku ?? '').trim()).filter(Boolean),
    })),
    proximo: pageInfo?.hasNextPage ? pageInfo.endCursor : null,
  };
}

const QUERY_BARCODES = `
query BarcodesDosProdutos($primeiros: Int!, $depois: String) {
  products(first: $primeiros, after: $depois, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id legacyResourceId title status productType createdAt
      variants(first: 100) { nodes { sku title price barcode } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Uma página de produtos do Shopify para o scan de GTIN (/olist/scan-gtin),
 * de qualquer status, os mais recentes primeiro. Só os campos escalares das
 * variantes, para a página sair barata no limite de custo do GraphQL.
 *
 * @returns {Promise<{ produtos: { id, titulo, status, tipo, criado, admin, variantes: { sku, opcao, preco, gtin }[] }[], proximo: string|null }>}
 */
export async function paginaDeBarcodes({ cursor = null, tamanho = 100 } = {}) {
  const dados = await shopifyGraphQL(QUERY_BARCODES, { primeiros: tamanho, depois: cursor });
  const { nodes = [], pageInfo } = dados.products ?? {};
  const dominio = process.env.SHOPIFY_STORE_DOMAIN;
  return {
    produtos: nodes.map((p) => ({
      id: p.id,
      titulo: p.title,
      status: p.status,
      tipo: p.productType || null,
      criado: p.createdAt,
      admin: `https://${dominio}/admin/products/${p.legacyResourceId}`,
      variantes: (p.variants?.nodes ?? []).map((v) => ({
        sku: String(v.sku ?? '').trim(),
        opcao: v.title,
        preco: v.price == null ? null : Number(v.price),
        gtin: String(v.barcode ?? '').trim(),
      })),
    })),
    proximo: pageInfo?.hasNextPage ? pageInfo.endCursor : null,
  };
}
