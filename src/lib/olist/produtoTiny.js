// produtoTiny.js — comparação entre o Shopify e a Olist (Tiny), e o payload
// do "trazer do Shopify".
//
// Modelo da Olist: cada cor é um produto PAI sem código ("Calça Cool - Azul
// Marinho"), com os tamanhos como VARIAÇÕES — o SKU fica na variação. No
// Shopify é o mesmo desenho: um produto por cor, uma variante por tamanho.
// Então produto do Shopify <-> pai da Olist, e variante <-> variação.
//
//   - Do pai: nome (título do Shopify), NCM (regra do código, fiscal/ncm.js)
//     e peso.
//   - Da variação: preço. O tamanho (grade) só aparece.
//   - O GTIN aparece do lado do Shopify só para consulta: vai sempre VAZIO.
//
// Campo sem valor do lado de cá (peso vazio, produto sem regra de NCM) não
// é comparado nem apaga o que está na Olist.

import { ncmDoProduto } from '../fiscal/ncm.js';
import { valorMonetario } from '../utils.js';

/** Campos do pai, na ordem da tela. `soOlist`: não existe no Shopify. */
export const CAMPOS_PAI = [
  { chave: 'nome', rotulo: 'Nome' },
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

/** Opções reais da variante ({ Tamanho: 'P' }), sem a "Title" automática. */
function gradeDaVariante(variante) {
  return Object.fromEntries(
    (variante.selectedOptions ?? []).filter((o) => o.name !== 'Title').map((o) => [o.name, o.value])
  );
}

const COMPARAVEL = {
  nome: (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
  preco: (v) => (v == null ? null : Number(v).toFixed(2)),
  ncm: (v) => String(v ?? '').replace(/\D+/g, ''),
  peso: (v) => (v == null ? null : Number(v).toFixed(3)),
};

/** Campos com valor do lado de cá que estão diferentes na Olist. */
function diferentes(chaves, esperado, olist) {
  return chaves.filter(
    (chave) => esperado[chave] != null && COMPARAVEL[chave](esperado[chave]) !== COMPARAVEL[chave](olist?.[chave])
  );
}

/**
 * Comparação de um produto do Shopify com o pai da Olist.
 *
 * @param {object} produto buscarProdutosParaOlist
 * @param {{ pai: object|null, duplicados?: number, foraDoPai: object }} noTiny produtoPaiNoTiny
 * @param {(cadastro: object) => object[]} variacoesDoPai
 */
export function compararProduto(produto, noTiny, variacoesDoPai) {
  const { pai, duplicados, foraDoPai = {} } = noTiny;
  const esperado = {
    nome: produto.title,
    ncm: ncmDoProduto({ titulo: produto.title, tipo: produto.productType }),
    peso: produto.variants.map(pesoEmKg).find((p) => p != null) ?? null,
  };
  const olist = pai && {
    id: String(pai.id),
    nome: pai.nome ?? null,
    ncm: String(pai.ncm ?? '').trim() || null,
    peso: numeroOuNull(pai.peso_liquido) || numeroOuNull(pai.peso_bruto),
    preco: numeroOuNull(pai.preco),
  };
  const diferencasPai = olist ? diferentes(['nome', 'ncm', 'peso'], esperado, olist) : [];
  const variacoes = new Map((pai ? variacoesDoPai(pai) : []).map((v) => [normalizarCodigo(v.codigo), v]));

  const linhas = produto.variants.map((variante) => {
    const sku = String(variante.sku ?? '').trim();
    const shopify = {
      preco: numeroOuNull(variante.price),
      gtin: String(variante.barcode ?? '').trim() || null,
      opcao: variante.title !== 'Default Title' ? variante.title : null,
    };
    const base = { sku, shopify, grade: gradeDaVariante(variante), olist: null, diferencas: [] };
    if (!sku) return { ...base, situacao: 'sem_sku' };
    if (duplicados) return { ...base, situacao: 'bloqueado' };

    const variacao = variacoes.get(normalizarCodigo(sku));
    if (!variacao) {
      const fora = foraDoPai[normalizarCodigo(sku)];
      return fora ? { ...base, situacao: 'fora_do_pai', foraDoPai: fora } : { ...base, situacao: 'nova' };
    }

    // Variação sem preço próprio vale o preço do pai.
    const precoOlist = numeroOuNull(variacao.preco) || olist.preco;
    const daOlist = { id: variacao.id, preco: precoOlist, grade: variacao.grade };
    const diferencas = diferentes(['preco'], shopify, daOlist);
    // O pai é gravado junto com as variações: pai diferente torna a variação enviável.
    const situacao = diferencas.length || diferencasPai.length ? 'diferente' : 'igual';
    return { ...base, olist: daOlist, diferencas, situacao };
  });

  return {
    id: produto.id,
    titulo: produto.title,
    tipo: produto.productType,
    status: produto.status,
    situacao: duplicados ? 'duplicado' : pai ? 'encontrado' : 'nao_encontrado',
    duplicados: duplicados ?? null,
    esperado,
    olist,
    diferencasPai,
    linhas,
  };
}

/** Campos do pai que vêm do lado de cá (os vazios ficam de fora). */
function camposDoPai(esperado) {
  return {
    nome: esperado.nome,
    ...(esperado.ncm ? { ncm: esperado.ncm } : {}),
    ...(esperado.peso != null ? { peso_liquido: esperado.peso, peso_bruto: esperado.peso } : {}),
  };
}

function variacaoNova(linha, grade = linha.grade) {
  return { variacao: { codigo: linha.sku, preco: valorMonetario(linha.shopify.preco), gtin: '', grade } };
}

// Nome de opção do Shopify em inglês -> atributo da grade na Olist.
const SINONIMOS_GRADE = { size: 'tamanho', color: 'cor', colour: 'cor' };

function chaveDaGrade(nome) {
  const n = String(nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  return SINONIMOS_GRADE[n] ?? n;
}

/** Atributos da grade do pai: o conjunto mais comum entre as variações atuais (null sem variações). */
function atributosDoPai(variacoesAtuais) {
  const contagem = new Map();
  for (const v of variacoesAtuais) {
    const chaves = Object.keys(v.grade ?? {});
    if (!chaves.length) continue;
    const id = JSON.stringify(chaves);
    contagem.set(id, (contagem.get(id) ?? 0) + 1);
  }
  const [maisComum] = [...contagem].sort((a, b) => b[1] - a[1])[0] ?? [];
  return maisComum ? JSON.parse(maisComum) : null;
}

/**
 * Grade da variação com os mesmos atributos do pai — o Tiny recusa a
 * alteração inteira com "Grade da variação com quantidade de níveis
 * diferente do pai" quando uma variação tem atributos a mais ou a menos
 * (ex.: Shopify com Cor + Tamanho e a Olist só com Tamanho).
 *
 * Cada atributo do pai vem da opção do Shopify de mesmo nome (Size =
 * Tamanho); se não há, de um atributo que tem o mesmo valor em todas as
 * variações do pai (a cor, num pai por cor); se ainda sobra um atributo e
 * uma opção sem par, um vai no outro. Opção do Shopify que o pai não tem
 * fica de fora.
 */
function gradeNoPadraoDoPai(sku, grade, atributos, variacoesAtuais) {
  if (!atributos) return grade;
  const doShopify = new Map(Object.entries(grade ?? {}).map(([k, v]) => [chaveDaGrade(k), v]));
  const usadas = new Set();
  const resultado = {};
  for (const atributo of atributos) {
    const chave = chaveDaGrade(atributo);
    if (doShopify.has(chave)) {
      resultado[atributo] = doShopify.get(chave);
      usadas.add(chave);
      continue;
    }
    const valores = new Set(variacoesAtuais.map((v) => v.grade?.[atributo]).filter(Boolean));
    if (valores.size === 1) resultado[atributo] = [...valores][0];
  }

  const semValor = atributos.filter((a) => !resultado[a]);
  const sobras = [...doShopify].filter(([k]) => !usadas.has(k));
  if (semValor.length === 1 && sobras.length === 1) resultado[semValor[0]] = sobras[0][1];

  const faltando = atributos.filter((a) => !resultado[a]);
  if (faltando.length) {
    throw new Error(
      `Grade de ${sku} não bate com a do pai na Olist (atributos do pai: ${atributos.join(', ')}; ` +
        `no Shopify: ${Object.keys(grade ?? {}).join(', ') || 'nenhum'}). Faltou: ${faltando.join(', ')}.`
    );
  }
  return resultado;
}

/** Menor preço entre as variantes do Shopify — o preço que a Olist mostra no pai. */
function precoDoPai(comparado) {
  const precos = comparado.linhas.map((l) => l.shopify.preco).filter((p) => p != null);
  return precos.length ? valorMonetario(Math.min(...precos)) : undefined;
}

/** Payload de produto.incluir: pai sem código com as variações escolhidas. */
export function paiParaIncluir(comparado, linhas) {
  return {
    codigo: '',
    unidade: 'UN',
    preco: precoDoPai(comparado),
    origem: ORIGEM_PADRAO,
    situacao: 'A',
    tipo: 'P',
    classe_produto: 'V',
    gtin: '',
    ...camposDoPai(comparado.esperado),
    variacoes: linhas.map(variacaoNova),
  };
}

/**
 * Payload de produto.alterar do pai. O que não vem do Shopify (código,
 * unidade, origem, situação...) é repetido do cadastro atual. Vão TODAS as
 * variações que o pai já tem, com o id — as não escolhidas com o preço de
 * hoje —, para a alteração não apagar nem duplicar nenhuma; as escolhidas
 * levam o preço do Shopify, e as que faltam entram sem id (são incluídas).
 *
 * @param {object[]} variacoesAtuais variacoesDoPai(cadastro)
 */
export function paiParaAlterar(comparado, cadastro, variacoesAtuais, linhas) {
  const escolhidas = new Map(linhas.map((l) => [normalizarCodigo(l.sku), l]));
  const doShopify = new Map(comparado.linhas.map((l) => [normalizarCodigo(l.sku), l]));
  const atributos = atributosDoPai(variacoesAtuais);
  const mesmosAtributos = (grade) => JSON.stringify(Object.keys(grade ?? {})) === JSON.stringify(atributos);

  const existentes = variacoesAtuais.map((v) => {
    const linha = escolhidas.get(normalizarCodigo(v.codigo));
    // Variação atual fora do padrão do pai (grade vazia ou com outro
    // número de níveis) é refeita pela variante do Shopify, se houver.
    const variante = doShopify.get(normalizarCodigo(v.codigo));
    const grade =
      !atributos || mesmosAtributos(v.grade) || !variante
        ? v.grade
        : gradeNoPadraoDoPai(v.codigo, variante.grade, atributos, variacoesAtuais);
    return {
      variacao: {
        id: v.id,
        codigo: v.codigo,
        preco: linha ? valorMonetario(linha.shopify.preco) : v.preco,
        // Variação não escolhida fica como está.
        ...(linha ? { gtin: '' } : {}),
        grade,
      },
    };
  });
  const novas = linhas
    .filter((l) => l.situacao === 'nova')
    .map((l) => variacaoNova(l, gradeNoPadraoDoPai(l.sku, l.grade, atributos, variacoesAtuais)));

  return {
    codigo: cadastro.codigo ?? '',
    unidade: cadastro.unidade || 'UN',
    preco: precoDoPai(comparado) ?? cadastro.preco,
    origem: cadastro.origem ?? ORIGEM_PADRAO,
    situacao: cadastro.situacao || 'A',
    tipo: cadastro.tipo || 'P',
    classe_produto: 'V',
    gtin: '',
    ...(cadastro.ncm ? { ncm: cadastro.ncm } : {}),
    ...camposDoPai(comparado.esperado),
    variacoes: [...existentes, ...novas],
  };
}
