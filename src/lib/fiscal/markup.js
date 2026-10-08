// markup.js — quanto o atacado e a franquia pagam por item, em relação ao
// preço de varejo do Shopify.
//
// O time comercial pensa em MARKUP, não em percentual de desconto: o preço de
// varejo é o custo do cliente multiplicado pelo markup, então o valor que vai
// na nota é o preço do Shopify DIVIDIDO pelo markup.
//
//   markup 2,0  ->  preço ÷ 2,0  ->  50% de desconto      (atacado, padrão)
//   markup 2,2  ->  preço ÷ 2,2  ->  54,54% de desconto   (franquia, padrão)
//   markup 2,4  ->  preço ÷ 2,4  ->  58,33% de desconto
//
// Nada do markup é arredondado: o percentual e o valor de cada item são
// TRUNCADOS (2,2 dá 54,54%, e não 54,55%; R$ 100,00 dá 45,45).
//
// O markup padrão vem da classificação do pedido. De vez em quando uma nota
// precisa sair com outro markup — a tela do rascunho deixa trocar, e o novo
// markup vale para TODOS os itens da nota (ver useIncluirRascunho).
//
// Por cima do markup a tela do rascunho ainda aceita um DESCONTO EXTRA em
// percentual, para a nota inteira. Ele é calculado sobre o valor que já saiu
// do markup (não sobre o preço do Shopify) e abate o valor unitário de cada
// item — não é o `valor_desconto` do rodapé da nota (esse é o desconto.js).
//
//   R$ 100,00, markup 2,0, desconto 10%  ->  50,00  ->  45,00

/** Markup padrão de cada classificação. "outro" paga o preço cheio. */
export const MARKUP_PADRAO = {
  atacado: 2.0,
  franquia: 2.2,
  outro: 1,
};

// Franquia: o markup depende do PRIMEIRO item do pedido. Vestuário usa o
// markup da franquia (cadastro ou padrão de franquia) e acessório usa 2,0 —
// sempre para o pedido inteiro, mesmo que ele misture os dois. Quem diz o que
// é acessório é o "Tipo de produto" do Shopify; Tênis conta como vestuário.

/** Markup de franquia quando o primeiro item do pedido é acessório. */
export const MARKUP_FRANQUIA_ACESSORIO = 2.0;

/** Tipos de produto do Shopify que são acessório (comparados sem acento e
 *  sem diferenciar maiúsculas). Tipo novo de acessório entra aqui. */
export const TIPOS_ACESSORIO = [
  'bolsa',
  'bone',
  'copo',
  'ecobag',
  'faixa',
  'garrafa',
  'laco',
  'meias',
  'necessaire',
  'oculos',
  'sacola',
];

function normalizarTipo(tipo) {
  return String(tipo ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** true quando o tipo de produto do Shopify é acessório. */
export function ehAcessorio(tipoProduto) {
  return TIPOS_ACESSORIO.includes(normalizarTipo(tipoProduto));
}

/** Atalhos da tela do rascunho; qualquer outro valor pode ser digitado. */
export const MARKUPS_SUGERIDOS = [2.0, 2.2, 2.4];

/** Abaixo de 1 o valor da nota passaria do preço de varejo — não faz sentido. */
export const MARKUP_MINIMO = 1;

/** Acima disso é quase certo que foi erro de digitação. */
export const MARKUP_MAXIMO = 10;

export function markupPadrao(classificacao) {
  return MARKUP_PADRAO[classificacao] ?? MARKUP_PADRAO.outro;
}

/**
 * Lê o markup digitado na tela ("2,4", "2.4", " 2,45 "). Devolve null para
 * vazio, texto sem número ou fora de [MARKUP_MINIMO, MARKUP_MAXIMO] — quem
 * chama não aplica e avisa.
 *
 * @param {string|number} texto
 * @returns {number|null}
 */
export function lerMarkup(texto) {
  const numero =
    typeof texto === 'number' ? texto : Number(String(texto ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(numero) || numero < MARKUP_MINIMO || numero > MARKUP_MAXIMO) return null;
  return numero;
}

/** Desconto extra acima disso é quase certo que foi erro de digitação. */
export const DESCONTO_EXTRA_MAXIMO = 99;

/**
 * Lê o desconto extra digitado na tela ("10", "7,5", " 5% "). Vazio vale 0
 * (sem desconto). Devolve null para texto sem número ou fora de
 * [0, DESCONTO_EXTRA_MAXIMO] — quem chama não aplica e avisa.
 *
 * @param {string|number} texto
 * @returns {number|null}
 */
export function lerDescontoExtra(texto) {
  if (typeof texto !== 'number' && !String(texto ?? '').trim()) return 0;
  const numero =
    typeof texto === 'number' ? texto : Number(String(texto).trim().replace('%', '').trim().replace(',', '.'));
  if (!Number.isFinite(numero) || numero < 0 || numero > DESCONTO_EXTRA_MAXIMO) return null;
  return numero;
}

/** Folga contra ruído de ponto flutuante ao truncar: 110 ÷ 2,2 dá
 *  4999,999… centavos, e sem ela viraria 49,99 em vez de 50,00. */
const FOLGA_TRUNCAMENTO = 1e-6;

/**
 * Valor unitário da nota, com 2 casas, a partir do preço de varejo: preço ÷
 * markup TRUNCADO no centavo, nunca arredondado. O desconto extra
 * (percentual) entra depois do markup, sobre esse valor — é a conta que a
 * pessoa faria à mão olhando a tela.
 */
export function valorComMarkup(precoVarejo, markup, descontoExtra = 0) {
  const preco = Number(precoVarejo);
  if (!Number.isFinite(preco) || !(markup > 0)) return 0;
  const comMarkup = Math.floor(Math.round(preco * 100) / markup + FOLGA_TRUNCAMENTO) / 100;
  if (!(descontoExtra > 0)) return comMarkup;
  // Conta em centavos inteiros para não herdar ruído de ponto flutuante.
  return Math.round((Math.round(comMarkup * 100) * (100 - descontoExtra)) / 100) / 100;
}

/** Percentual de desconto equivalente ao markup, truncado (2,2 -> 54.54). */
export function descontoDoMarkup(markup) {
  if (!(markup > 0)) return 0;
  return Math.floor((1 - 1 / markup) * 10000 + FOLGA_TRUNCAMENTO) / 100;
}

/** "2,2" — como o markup aparece na tela e nos alertas. */
export function formatarMarkup(markup) {
  return Number(markup).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 4 });
}
