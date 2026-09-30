// desconto.js — o desconto em dinheiro do pedido, que abate o total da nota.
//
// Vem do metafield `custom.desconto` do pedido no Shopify, que é TEXTO LIVRE:
// quem preenche digita do jeito que está acostumado — "1200,45", "1200.00",
// "R$ 1.200,45", "1.200". Por isso o texto passa por `valorDoDesconto` antes
// de virar número; o Tiny espera `valor_desconto` como decimal com ponto.
//
// ATENÇÃO à vírgula x ponto: como dinheiro aqui tem 2 casas, um separador
// sozinho seguido de EXATAMENTE 3 dígitos é separador de milhar ("1.200" e
// "1,200" são mil e duzentos), e qualquer outro caso é separador decimal
// ("1200,45", "1200.00", "1200.5"). Quando vêm os dois, o último manda —
// "1.200,45" é mil e duzentos e quarenta e cinco centavos.
//
// O desconto é da NOTA, não do item: o markup de atacado e franquia (ver
// markup.js) continua sendo aplicado no valor unitário dentro de
// montarNota.js. Este aqui entra uma vez só, no rodapé da nota.
//
// `valor_desconto` é campo documentado de nota.fiscal.incluir (API 2.0), no
// mesmo bloco de `valor_frete`, `valor_seguro` e `valor_despesas`, e vai como
// STRING com ponto decimal ("200.00") — é o formato que `valorMonetario` já
// produz. Diferente de "categoria" (ver pagamento.js), este o Tiny aceita.

import { valorMonetario } from '../utils.js';

/** Campo do Tiny que recebe o desconto em dinheiro da nota. */
export const CAMPO_DESCONTO_TINY = 'valor_desconto';

/**
 * Converte o texto do metafield em número. Devolve 0 para vazio, texto sem
 * número ou valor negativo — nunca NaN, porque esse valor entra em conta de
 * total e de parcela.
 *
 * @param {string|number} textoShopify
 * @returns {number}
 */
export function valorDoDesconto(textoShopify) {
  if (typeof textoShopify === 'number') {
    return Number.isFinite(textoShopify) && textoShopify > 0 ? textoShopify : 0;
  }

  // Fora dígitos e separadores não interessa nada: "R$", espaço, "de desconto".
  const limpo = String(textoShopify ?? '').replace(/[^\d.,]/g, '');
  if (!limpo) return 0;

  const ultimoPonto = limpo.lastIndexOf('.');
  const ultimaVirgula = limpo.lastIndexOf(',');
  const separador = Math.max(ultimoPonto, ultimaVirgula);

  let numero;
  if (separador < 0) {
    numero = Number(limpo);
  } else {
    const inteiro = limpo.slice(0, separador).replace(/[.,]/g, '');
    const decimais = limpo.slice(separador + 1);
    // Um separador sozinho com 3 dígitos atrás é milhar ("1.200" = 1200).
    // Com os dois presentes não há dúvida: o último é o decimal.
    const umTipoSo = ultimoPonto < 0 || ultimaVirgula < 0;
    const eMilhar = umTipoSo && decimais.length === 3;
    numero = eMilhar ? Number(inteiro + decimais) : Number(`${inteiro}.${decimais}`);
  }

  return Number.isFinite(numero) && numero > 0 ? numero : 0;
}

/**
 * Monta o pedaço de desconto da nota, já no formato do Tiny.
 *
 * @param {object} opcoes
 * @param {string|number} [opcoes.desconto] texto cru do metafield do Shopify
 * @param {number} [opcoes.total] soma dos itens da nota, para conferir o valor
 * @returns {{ desconto: object, valor: number, alertas: string[] }}
 *   `desconto` já pronto para entrar em `nota_fiscal` — vem vazio quando não
 *   há desconto, para a nota não levar um campo zerado à toa.
 */
export function montarDesconto({ desconto, total = 0 }) {
  const alertas = [];
  const valor = valorDoDesconto(desconto);

  if (!valor) {
    // Texto preenchido que não virou número merece aviso; vazio é o normal.
    if (String(desconto ?? '').trim() && String(desconto).trim() !== 'Não informado') {
      alertas.push(
        `Desconto do Shopify ("${desconto}") não foi entendido como valor — a nota vai sem desconto. ` +
          'Confira antes de emitir.'
      );
    }
    return { desconto: {}, valor: 0, alertas };
  }

  if (total > 0 && valor > total) {
    alertas.push(
      `Desconto (${valorMonetario(valor)}) maior que o total dos itens (${valorMonetario(total)}). ` +
        'O Tiny vai recusar a nota — confira o metafield de desconto no Shopify.'
    );
  }

  return {
    desconto: { [CAMPO_DESCONTO_TINY]: valorMonetario(valor) },
    valor,
    alertas,
  };
}
