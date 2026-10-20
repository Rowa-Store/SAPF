// chaves.js — como o Tiny compara nome e código, para quem precisa casar
// registros do lado de cá do mesmo jeito: o servidor (tiny.js) e a tela do
// diagnóstico, que casa o catálogo da Olist com os produtos do Shopify.

/** Nome comparável: sem acento, caixa nem espaços nas pontas. */
export function normalizarNome(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Código comparável: o Tiny casa o código sem ligar para caixa nem espaços nas pontas. */
export function normalizarCodigo(codigo) {
  return String(codigo ?? '').trim().toUpperCase();
}
