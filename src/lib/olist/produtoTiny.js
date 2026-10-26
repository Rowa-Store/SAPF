// produtoTiny.js — comparação entre o Shopify e a Olist (Tiny), e o payload
// do "trazer do Shopify".
//
// Modelo da Olist: SEM produto pai. Cada variante do Shopify (um tamanho de
// uma cor) é um produto SIMPLES na Olist, com o SKU como código e o nome
// "Título - Tamanho" ("Calça Cool - Azul Marinho - P"). O Tiny não aceita
// dois produtos com o mesmo nome, por isso o tamanho vai no nome.
//
//   - De cada SKU: nome, preço, NCM (regra do código, fiscal/ncm.js) e peso.
//   - O GTIN aparece do lado do Shopify só para consulta: vai sempre VAZIO.
//
// Campo sem valor do lado de cá (peso vazio, produto sem regra de NCM) não
// é comparado nem apaga o que está na Olist.

import { ncmDoProduto } from '../fiscal/ncm.js';
import { valorMonetario } from '../utils.js';

/** Campos comparados de cada SKU, na ordem da tela. `soOlist`: não existe no Shopify. */
export const CAMPOS = [
  { chave: 'nome', rotulo: 'Nome' },
  { chave: 'preco', rotulo: 'Preço' },
  { chave: 'ncm', rotulo: 'NCM', soOlist: true },
  { chave: 'peso', rotulo: 'Peso' },
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

/** Nome do SKU na Olist: o título, mais a opção quando o produto tem variantes. */
export function nomeDoSku(titulo, opcao) {
  return opcao ? `${titulo} - ${opcao}` : titulo;
}

const COMPARAVEL = {
  nome: (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
  preco: (v) => (v == null ? null : Number(v).toFixed(2)),
  ncm: (v) => String(v ?? '').replace(/\D+/g, ''),
  peso: (v) => (v == null ? null : Number(v).toFixed(3)),
};

/** Campos com valor do lado de cá que estão diferentes na Olist. */
function diferentes(esperado, olist, campos) {
  return campos.filter(
    (chave) => esperado[chave] != null && COMPARAVEL[chave](esperado[chave]) !== COMPARAVEL[chave](olist?.[chave])
  );
}

/** O que interessa do cadastro de um produto simples do Tiny. */
function doCadastro(cadastro) {
  return {
    id: String(cadastro.id),
    nome: cadastro.nome ?? null,
    preco: numeroOuNull(cadastro.preco),
    ncm: String(cadastro.ncm ?? '').trim() || null,
    peso: numeroOuNull(cadastro.peso_liquido) || numeroOuNull(cadastro.peso_bruto),
    ativo: (cadastro.situacao ?? 'A') === 'A',
  };
}

/**
 * Comparação de um produto do Shopify (uma cor) com a Olist, SKU a SKU.
 *
 * @param {object} produto buscarProdutosParaOlist
 * @param {Record<string, object|null>} noTiny produtosNoTinyPorCodigo — por código normalizado
 * @param {{ campos?: string[] }} opcoes campos comparados (padrão: todos de
 *   CAMPOS) — sem o cadastro completo, só os que a pesquisa do Tiny traz.
 */
export function compararProduto(produto, noTiny, { campos = CAMPOS.map((c) => c.chave) } = {}) {
  const ncm = ncmDoProduto({ titulo: produto.title, tipo: produto.productType });
  const peso = produto.variants.map(pesoEmKg).find((p) => p != null) ?? null;

  const linhas = produto.variants.map((variante) => {
    const sku = String(variante.sku ?? '').trim();
    const opcao = variante.title !== 'Default Title' ? variante.title : null;
    const shopify = {
      preco: numeroOuNull(variante.price),
      gtin: String(variante.barcode ?? '').trim() || null,
      opcao,
    };
    const esperado = { nome: nomeDoSku(produto.title, opcao), preco: shopify.preco, ncm, peso };
    const base = { sku, shopify, esperado, olist: null, diferencas: [] };
    if (!sku) return { ...base, situacao: 'sem_sku' };

    const achado = noTiny[normalizarCodigo(sku)];
    if (!achado) return { ...base, situacao: 'nova' };
    if (achado.duplicados) return { ...base, situacao: 'bloqueado', duplicados: achado.duplicados };
    if (achado.variacao) return { ...base, situacao: 'em_pai', emPai: achado.variacao };

    const olist = doCadastro(achado.simples);
    const diferencas = diferentes(esperado, olist, campos);
    // Inativo na Olist: a gravação reativa.
    const situacao = diferencas.length || !olist.ativo ? 'diferente' : 'igual';
    return { ...base, olist, diferencas, situacao };
  });

  const naOlist = linhas.filter((l) => l.olist).length;
  return {
    id: produto.id,
    titulo: produto.title,
    tipo: produto.productType,
    status: produto.status,
    situacao: naOlist ? 'encontrado' : 'nao_encontrado',
    esperado: { nome: produto.title, ncm, peso },
    linhas,
  };
}

/** Payload de produto.incluir: um produto simples por SKU. */
export function simplesParaIncluir(linha) {
  return {
    codigo: linha.sku,
    nome: linha.esperado.nome,
    unidade: 'UN',
    preco: valorMonetario(linha.shopify.preco),
    origem: ORIGEM_PADRAO,
    situacao: 'A',
    tipo: 'P',
    classe_produto: 'S',
    gtin: '',
    ...(linha.esperado.ncm ? { ncm: linha.esperado.ncm } : {}),
    ...(linha.esperado.peso != null ? { peso_liquido: linha.esperado.peso, peso_bruto: linha.esperado.peso } : {}),
  };
}

/**
 * Payload de produto.alterar do produto simples. O que não vem do Shopify
 * (unidade, origem, tipo...) é repetido do cadastro atual; o produto fica
 * ativo (reativa o que estava inativo).
 */
export function simplesParaAlterar(linha, cadastro) {
  return {
    ...simplesParaIncluir(linha),
    unidade: cadastro.unidade || 'UN',
    origem: cadastro.origem ?? ORIGEM_PADRAO,
    tipo: cadastro.tipo || 'P',
    classe_produto: cadastro.classe_produto || 'S',
    ...(!linha.esperado.ncm && cadastro.ncm ? { ncm: cadastro.ncm } : {}),
    ...(linha.esperado.peso == null
      ? { peso_liquido: cadastro.peso_liquido, peso_bruto: cadastro.peso_bruto }
      : {}),
  };
}

/**
 * A comparação depois de gravar, sem reler o Tiny: cada SKU gravado (por
 * código normalizado -> id na Olist) passa a igual, com o que foi enviado.
 */
export function comoFicou(produto, gravados) {
  const linhas = produto.linhas.map((l) => {
    const id = gravados.get(normalizarCodigo(l.sku));
    if (id === undefined) return l;
    const olist = { ...(l.olist ?? {}), ...l.esperado, id: id ?? l.olist?.id ?? null, ativo: true };
    return { ...l, olist, diferencas: [], situacao: 'igual' };
  });
  return { ...produto, linhas, situacao: linhas.some((l) => l.olist) ? 'encontrado' : 'nao_encontrado' };
}
