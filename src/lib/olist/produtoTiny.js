// produtoTiny.js — comparação SKU a SKU entre o Shopify e a Olist (Tiny), e
// o payload do "trazer do Shopify".
//
// Sem produto pai: cada variante do Shopify (cada SKU) é um produto da
// Olist. Achado pelo código, é atualizado; não achado, é incluído como
// produto simples.
//
// Só vai para o Tiny o campo que o Shopify tem preenchido — GTIN, peso ou
// NCM vazios do lado de cá não apagam o que já está na Olist.

import { ncmDoProduto } from '../fiscal/ncm.js';
import { valorMonetario } from '../utils.js';

/** Campos comparados, na ordem da tela. */
export const CAMPOS = [
  { chave: 'nome', rotulo: 'Nome' },
  { chave: 'preco', rotulo: 'Preço' },
  { chave: 'gtin', rotulo: 'GTIN' },
  { chave: 'ncm', rotulo: 'NCM' },
  { chave: 'peso', rotulo: 'Peso (kg)' },
];

// Origem da mercadoria (tabela da NF-e) dos produtos incluídos: 0 = nacional.
const ORIGEM_PADRAO = '0';

/** Código comparável — o Tiny casa código sem ligar para caixa nem espaços nas pontas. */
export function normalizarCodigo(codigo) {
  return String(codigo ?? '').trim().toUpperCase();
}

const FATOR_KG = { GRAMS: 0.001, KILOGRAMS: 1, POUNDS: 0.45359237, OUNCES: 0.028349523 };

function pesoEmKg(variante) {
  const peso = variante.inventoryItem?.measurement?.weight;
  const valor = Number(peso?.value) * (FATOR_KG[peso?.unit] ?? 0);
  return valor > 0 ? Number(valor.toFixed(3)) : null;
}

function numeroOuNull(valor) {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return valor === '' || valor == null || !Number.isFinite(n) ? null : n;
}

/** Os campos de CAMPOS de um lado e do outro, no mesmo formato. */
function ladoShopify(produto, variante) {
  const tamanho = variante.title && variante.title !== 'Default Title' ? ` - ${variante.title}` : '';
  return {
    nome: `${produto.title}${tamanho}`,
    preco: numeroOuNull(variante.price),
    gtin: String(variante.barcode ?? '').trim() || null,
    ncm: ncmDoProduto({ titulo: produto.title, tipo: produto.productType }),
    peso: pesoEmKg(variante),
  };
}

function ladoTiny(produto) {
  return {
    id: String(produto.id),
    nome: produto.nome ?? null,
    preco: numeroOuNull(produto.preco),
    gtin: String(produto.gtin ?? '').trim() || null,
    ncm: String(produto.ncm ?? '').trim() || null,
    peso: numeroOuNull(produto.peso_liquido) || numeroOuNull(produto.peso_bruto),
    tipoVariacao: produto.tipoVariacao ?? null,
  };
}

const COMPARAVEL = {
  nome: (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
  preco: (v) => (v == null ? null : Number(v).toFixed(2)),
  gtin: (v) => String(v ?? '').trim(),
  ncm: (v) => String(v ?? '').replace(/\D+/g, ''),
  peso: (v) => (v == null ? null : Number(v).toFixed(3)),
};

/** Campos que o Shopify tem preenchidos e que estão diferentes na Olist. */
function camposDiferentes(shopify, tiny) {
  return CAMPOS.map((c) => c.chave).filter(
    (chave) => shopify[chave] != null && COMPARAVEL[chave](shopify[chave]) !== COMPARAVEL[chave](tiny?.[chave])
  );
}

/**
 * Uma linha por SKU dos produtos do Shopify, com o lado da Olist.
 *
 * @param {object[]} produtos buscarProdutosParaOlist
 * @param {Record<string, { produto: object|null, duplicados?: number }>} doTiny produtosDoTinyPorCodigo
 */
export function compararProdutos(produtos, doTiny) {
  return produtos.map((produto) => ({
    id: produto.id,
    titulo: produto.title,
    tipo: produto.productType,
    linhas: produto.variants.map((variante) => {
      const sku = String(variante.sku ?? '').trim();
      const shopify = ladoShopify(produto, variante);
      if (!sku) return { sku, shopify, tiny: null, situacao: 'sem_sku', diferencas: [] };

      const achado = doTiny[normalizarCodigo(sku)] ?? { produto: null };
      if (achado.duplicados) return { sku, shopify, tiny: null, situacao: 'duplicado', duplicados: achado.duplicados, diferencas: [] };
      if (!achado.produto) return { sku, shopify, tiny: null, situacao: 'nao_encontrado', diferencas: [] };

      const tiny = ladoTiny(achado.produto);
      const diferencas = camposDiferentes(shopify, tiny);
      return { sku, shopify, tiny, situacao: diferencas.length ? 'diferente' : 'igual', diferencas };
    }),
  }));
}

/** Campos do Shopify que vão para o Tiny (os vazios ficam de fora). */
function camposDoShopify(shopify) {
  return {
    nome: shopify.nome,
    ...(shopify.preco != null ? { preco: valorMonetario(shopify.preco) } : {}),
    ...(shopify.gtin ? { gtin: shopify.gtin } : {}),
    ...(shopify.ncm ? { ncm: shopify.ncm } : {}),
    ...(shopify.peso != null ? { peso_liquido: shopify.peso, peso_bruto: shopify.peso } : {}),
  };
}

/** Payload de produto.incluir para um SKU que não existe na Olist. */
export function produtoParaIncluir(linha) {
  return {
    codigo: linha.sku,
    unidade: 'UN',
    origem: ORIGEM_PADRAO,
    situacao: 'A',
    tipo: 'P',
    classe_produto: 'S',
    ...camposDoShopify(linha.shopify),
  };
}

/**
 * Payload de produto.alterar. O que não vem do Shopify (unidade, origem,
 * situação...) é repetido do cadastro atual, para a alteração não zerar nada.
 */
export function produtoParaAlterar(linha, cadastroTiny) {
  return {
    codigo: cadastroTiny.codigo ?? linha.sku,
    nome: cadastroTiny.nome,
    unidade: cadastroTiny.unidade || 'UN',
    preco: cadastroTiny.preco,
    origem: cadastroTiny.origem ?? ORIGEM_PADRAO,
    situacao: cadastroTiny.situacao || 'A',
    tipo: cadastroTiny.tipo || 'P',
    ...(cadastroTiny.ncm ? { ncm: cadastroTiny.ncm } : {}),
    ...(cadastroTiny.gtin ? { gtin: cadastroTiny.gtin } : {}),
    ...camposDoShopify(linha.shopify),
  };
}
