// produtoTiny.js — comparação SKU a SKU entre o Shopify e a Olist (Tiny), e
// o payload do "trazer do Shopify".
//
// Sem produto pai: cada variante do Shopify (cada SKU) é um produto da
// Olist. Achado pelo código, é atualizado; não achado, é incluído como
// produto simples.
//
// Só vai para o Tiny o campo que o Shopify tem preenchido — peso vazio do
// lado de cá não apaga o que já está na Olist.
//
// O GTIN aparece do lado do Shopify só para consulta: para o Tiny ele vai
// sempre VAZIO (inclusive na atualização, apagando o que estiver lá).
//
// O NCM não vem do Shopify: sai só das regras do código (fiscal/ncm.js). Por
// isso ele é campo só do lado da Olist — comparado com o NCM da regra, que
// fica em `linha.ncm`. Sem regra para o produto, o NCM da Olist não é tocado.

import { ncmDoProduto } from '../fiscal/ncm.js';
import { valorMonetario } from '../utils.js';

/** Campos da tela, na ordem. `soOlist`: não existe no Shopify.
 *  `soShopify`: só para consulta — não é comparado nem enviado. */
export const CAMPOS = [
  { chave: 'nome', rotulo: 'Nome' },
  { chave: 'preco', rotulo: 'Preço' },
  { chave: 'gtin', rotulo: 'GTIN', soShopify: true },
  { chave: 'ncm', rotulo: 'NCM', soOlist: true },
  { chave: 'peso', rotulo: 'Peso (kg)' },
];

/** Os campos que aparecem do lado do Shopify. */
export const CAMPOS_SHOPIFY = CAMPOS.filter((c) => !c.soOlist);

/** Os campos que aparecem do lado da Olist — os comparados. */
export const CAMPOS_OLIST = CAMPOS.filter((c) => !c.soShopify);

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
    peso: pesoEmKg(variante),
  };
}

function ladoTiny(produto) {
  return {
    id: String(produto.id),
    nome: produto.nome ?? null,
    preco: numeroOuNull(produto.preco),
    ncm: String(produto.ncm ?? '').trim() || null,
    peso: numeroOuNull(produto.peso_liquido) || numeroOuNull(produto.peso_bruto),
    tipoVariacao: produto.tipoVariacao ?? null,
  };
}

const COMPARAVEL = {
  nome: (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
  preco: (v) => (v == null ? null : Number(v).toFixed(2)),
  ncm: (v) => String(v ?? '').replace(/\D+/g, ''),
  peso: (v) => (v == null ? null : Number(v).toFixed(3)),
};

/** Campos com valor do lado de cá (Shopify, ou a regra no caso do NCM)
 *  que estão diferentes na Olist. */
function camposDiferentes(esperado, tiny) {
  return CAMPOS_OLIST.map((c) => c.chave).filter(
    (chave) => esperado[chave] != null && COMPARAVEL[chave](esperado[chave]) !== COMPARAVEL[chave](tiny?.[chave])
  );
}

/**
 * Uma linha por SKU dos produtos do Shopify, com o lado da Olist.
 *
 * @param {object[]} produtos buscarProdutosParaOlist
 * @param {Record<string, { produto: object|null, duplicados?: number }>} doTiny produtosDoTinyPorCodigo
 */
export function compararProdutos(produtos, doTiny) {
  return produtos.map((produto) => {
    const ncm = ncmDoProduto({ titulo: produto.title, tipo: produto.productType });
    return {
      id: produto.id,
      titulo: produto.title,
      tipo: produto.productType,
      status: produto.status,
      linhas: produto.variants.map((variante) => {
        const sku = String(variante.sku ?? '').trim();
        const shopify = ladoShopify(produto, variante);
        const base = { sku, shopify, ncm, tiny: null, diferencas: [] };
        if (!sku) return { ...base, situacao: 'sem_sku' };

        const achado = doTiny[normalizarCodigo(sku)] ?? { produto: null };
        if (achado.duplicados) return { ...base, situacao: 'duplicado', duplicados: achado.duplicados };
        if (!achado.produto) return { ...base, situacao: 'nao_encontrado' };

        const tiny = ladoTiny(achado.produto);
        const diferencas = camposDiferentes({ ...shopify, ncm }, tiny);
        return { ...base, tiny, situacao: diferencas.length ? 'diferente' : 'igual', diferencas };
      }),
    };
  });
}

/** Campos que vão para o Tiny: os do Shopify mais o NCM da regra (os
 *  vazios ficam de fora). */
function camposDaLinha({ shopify, ncm }) {
  return {
    nome: shopify.nome,
    ...(shopify.preco != null ? { preco: valorMonetario(shopify.preco) } : {}),
    gtin: '',
    ...(ncm ? { ncm } : {}),
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
    ...camposDaLinha(linha),
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
    ...camposDaLinha(linha),
  };
}
