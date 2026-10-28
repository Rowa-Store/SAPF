// pagamento.js — a forma de pagamento da nota e, quando é o caso, as parcelas.
//
// Regra de negócio combinada:
//
//   - FRANQUIA pagando com BOLETO: a nota não vai como boleto. Vai como
//     "múltiplas formas de pagamento" (`multiplas`) e leva 3 parcelas, com
//     vencimento em 30, 45 e 60 dias contados da data de emissão.
//   - ATACADO pagando com BOLETO: a nota leva `boleto_bancario`, sem parcelas.
//   - PIX (atacado ou franquia): a nota leva `pix`, sem parcelas.
//   - BOLETO + PIX DO FRETE ("Boleto + Pix (frete)"), atacado ou franquia: os
//     boletos cobram só a mercadoria e o frete é pago à parte, por PIX. A nota
//     vai como `multiplas` com uma parcela a mais, de dia 0, só com o frete
//     (marcada na `obs`), antes das parcelas de boleto — as 3 de 30/45/60 da
//     franquia, ou a única de ATACADO_PRAZO_BOLETO dias do atacado.
//
// As parcelas têm que somar o TOTAL DA NOTA (itens − desconto + frete).
// Quando não somam, o Tiny joga fora os valores enviados e refaz as parcelas
// pela "condição de pagamento" sobre o total — foi o que aconteceu na NF
// 24807, cujos boletos saíram com o frete dentro. Por isso, no boleto sem PIX
// o frete entra nas parcelas de boleto.
//   - Qualquer outra forma de pagamento (cartão, transferência...), forma
//     misturada ("Cartão + Pix") ou metafield vazio: a nota vai SEM
//     `forma_pagamento`, para ser preenchida lá dentro do Tiny.
//
// A forma de pagamento chega do Shopify como TEXTO LIVRE, no metafield
// `custom.metodo_pagamento` do pedido ("Boleto", "boleto bancário", "PIX",
// "Cartão de crédito"...). O Tiny não aceita texto livre: `forma_pagamento` é
// uma lista fechada de códigos, que segue os meios de pagamento da NFe
// (tPag). Por isso o texto passa pelo de-para abaixo, que continua
// reconhecendo todas as formas — o rótulo traduzido é o que a tela usa para
// dizer o que veio do Shopify. O que vai para o Tiny, porém, é só boleto e
// PIX: qualquer outra forma (ou texto que não casar com nenhum código) sai da
// nota SEM forma de pagamento (campo omitido) — mandar um
// código inválido faria o Tiny recusar a nota inteira, e chutar um código
// parecido iria para a NFe sem ninguém ver.
//
// O QUE A TELA DE PAGAMENTO DO TINY ESPERA (conferido em rascunho real):
//
//   - "Forma de recebimento"   -> `forma_pagamento`. Código, não rótulo: o
//     `multiplas` que mandamos aparece na tela como "Múltiplas".
//   - "Condição de pagamento"  -> `condicao_pagamento`. É ESTE campo que
//     monta a tabela de parcelas ("30 45 60" vira 3 linhas, é o mesmo texto
//     do botão "atualizar parcelas" da tela). Sem ele a nota chega com a
//     forma de recebimento certa e NENHUMA parcela — foi o que aconteceu no
//     primeiro rascunho, antes de este campo existir aqui.
//   - "Forma" de cada parcela  -> `forma_pagamento` dentro da parcela, sempre
//     "Conta a Receber".
//
// "Categoria" (sempre "Compras") NÃO tem como ser enviada: não é campo de
// nota fiscal na API 2.0 — não aparece em nota.fiscal.incluir nem volta em
// nota.fiscal.obter, e o Tiny ignora em silêncio quando mandamos (foi o que
// aconteceu no rascunho de teste). Categoria é campo do lançamento financeiro
// (contas a receber), não da nota. Por isso ela não entra no payload: fica
// como aviso na tela do rascunho, para ser escolhida dentro do Tiny ou
// configurada como categoria padrão da conta.
//
// Os únicos códigos que saem daqui para o Tiny são `multiplas` (franquia com
// boleto), `boleto_bancario` (o resto com boleto) e `pix`. Os demais códigos
// do de-para (cartao_credito...) existem só para o rótulo da tela — se um
// dia passarem a ser enviados, confirmar antes a grafia exata com o time
// fiscal.

import { valorMonetario } from '../utils.js';
import { CAMPO_DESCONTO_TINY } from './desconto.js';

/** Código do Tiny para "múltiplas formas de pagamento". */
export const FORMA_MULTIPLAS = 'multiplas';

/** Código do Tiny para boleto bancário (tPag 15). */
export const FORMA_BOLETO = 'boleto_bancario';

/** Código do Tiny para PIX (tPag 17). */
export const FORMA_PIX = 'pix';

/** Categoria financeira combinada — só para exibir na tela; a API não a aceita. */
export const CATEGORIA_PADRAO = 'Compras';

/** Forma de cada parcela, como está cadastrada no Tiny. */
export const FORMA_DA_PARCELA = 'Conta a Receber';

/** Prazos, em dias, das parcelas de franquia com boleto. */
export const PRAZOS_FRANQUIA_BOLETO = [30, 45, 60];

/** Prazo, em dias, do boleto de atacado quando o frete vai por PIX. */
export const ATACADO_PRAZO_BOLETO = 30;

/** `obs` da parcela do frete pago por PIX — é por ela que se sabe que não é boleto. */
export const OBS_PARCELA_FRETE_PIX = 'Frete via PIX';

/** A parcela é a do frete pago por PIX (não vira boleto). */
export function ehParcelaDoFretePix(item) {
  return item?.parcela?.obs === OBS_PARCELA_FRETE_PIX;
}

/**
 * De-para do texto livre do Shopify para o código do Tiny. A ordem importa: o
 * primeiro padrão que casar vence, então o mais específico ("cartão de
 * crédito") vem antes do mais genérico ("crédito").
 */
const DE_PARA = [
  [/boleto/, FORMA_BOLETO],
  [/\bpix\b/, FORMA_PIX],
  [/cart[ao]+.*credito|credito.*cart[ao]+/, 'cartao_credito'],
  [/cart[ao]+.*debito|debito.*cart[ao]+/, 'cartao_debito'],
  [/credito.*loja|loja.*credito/, 'credito_loja'],
  [/transferencia|\bted\b|\bdoc\b/, 'transferencia_bancaria'],
  [/deposito/, 'deposito_bancario'],
  [/dinheiro|especie/, 'dinheiro'],
  [/cheque/, 'cheque'],
  [/duplicata/, 'duplicata_mercantil'],
  [/credito/, 'cartao_credito'],
  [/debito/, 'cartao_debito'],
];

/** Minúsculas e sem acento, para o de-para não depender de como foi digitado. */
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Traduz o texto do metafield do Shopify para o código do Tiny.
 * Devolve '' quando não reconhece — quem chama avisa em vez de chutar.
 */
export function formaDePagamentoTiny(textoShopify) {
  const texto = normalizar(textoShopify);
  if (!texto || texto === 'nao informado') return '';
  for (const [padrao, codigo] of DE_PARA) {
    if (padrao.test(texto)) return codigo;
  }
  return '';
}

/**
 * PIX só vai para a nota quando é a única forma do texto: "Cartão + Pix" é
 * pagamento misturado e fica para ser preenchido no Tiny.
 */
function soPix(textoShopify) {
  const resto = normalizar(textoShopify).replace(/\bpix\b/g, ' ');
  // "cartão" sozinho não casa no de-para (só com crédito/débito), por isso
  // é conferido à parte.
  return formaDePagamentoTiny(resto) === '' && !/cart[ao]+/.test(resto);
}

/** "Boleto + Pix (frete)": boleto e PIX no mesmo texto. */
function boletoComPix(textoShopify) {
  const texto = normalizar(textoShopify);
  return /boleto/.test(texto) && /\bpix\b/.test(texto);
}

/** dd/mm/aaaa de `dias` dias depois da data base (ISO do pedido, ou hoje). */
function vencimento(baseIso, dias) {
  const data = baseIso ? new Date(baseIso) : new Date();
  data.setDate(data.getDate() + dias);
  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${data.getFullYear()}`;
}

/**
 * Divide o total em `quantidade` valores de 2 casas. As primeiras parcelas
 * levam o valor arredondado para baixo e a última absorve a sobra, para a
 * soma das parcelas bater exatamente com o total da nota — centavo faltando
 * ou sobrando é motivo de rejeição na NFe.
 */
function dividirEmParcelas(total, quantidade) {
  const centavos = Math.round(Number(total || 0) * 100);
  const base = Math.floor(centavos / quantidade);
  return Array.from({ length: quantidade }, (_, i) =>
    valorMonetario((i === quantidade - 1 ? centavos - base * (quantidade - 1) : base) / 100)
  );
}

/**
 * As parcelas da nota: o PIX do frete (dia 0), quando há, seguido dos boletos
 * nos `prazos`, que dividem `totalBoletos` entre si.
 */
function montarParcelas({ prazos, dataBaseIso, totalBoletos, fretePix = 0 }) {
  const valores = dividirEmParcelas(totalBoletos, prazos.length);
  const boletos = prazos.map((dias, indice) => ({
    parcela: {
      dias,
      data: vencimento(dataBaseIso, dias),
      valor: valores[indice],
      forma_pagamento: FORMA_DA_PARCELA,
    },
  }));
  if (!(fretePix > 0)) return boletos;
  return [
    {
      parcela: {
        dias: 0,
        data: vencimento(dataBaseIso, 0),
        valor: valorMonetario(fretePix),
        obs: OBS_PARCELA_FRETE_PIX,
        forma_pagamento: FORMA_DA_PARCELA,
      },
    },
    ...boletos,
  ];
}

/** Forma, condição e parcelas da nota — a condição lista os mesmos prazos das parcelas. */
function pagamentoParcelado(parcelas) {
  return {
    forma_pagamento: FORMA_MULTIPLAS,
    condicao_pagamento: parcelas.map(({ parcela }) => parcela.dias).join(' '),
    parcelas,
  };
}

/**
 * Monta o pedaço de pagamento da nota.
 *
 * @param {object} opcoes
 * @param {"atacado"|"franquia"|"outro"} opcoes.classificacao
 * @param {string} opcoes.metodoPagamento texto cru do metafield do Shopify
 * @param {string} [opcoes.dataBaseIso] data de emissão (createdAt do pedido)
 * @param {number} [opcoes.total] total dos itens da nota, já sem o desconto
 * @param {number} [opcoes.frete] valor do frete da nota
 * @returns {{ pagamento: object, alertas: string[] }} `pagamento` já pronto
 *   para entrar em `nota_fiscal` — vem vazio sempre que o pagamento não é
 *   boleto nem PIX, porque só esses dois são enviados ao Tiny.
 */
export function montarPagamento({ classificacao, metodoPagamento, dataBaseIso, total = 0, frete = 0 }) {
  const alertas = [];
  const forma = formaDePagamentoTiny(metodoPagamento);
  const fretePix = forma === FORMA_BOLETO && boletoComPix(metodoPagamento) && frete > 0 ? frete : 0;

  if (forma === FORMA_BOLETO && boletoComPix(metodoPagamento) && !fretePix) {
    alertas.push('Boleto + PIX sem frete no pedido: a nota vai só com os boletos.');
  }

  if (fretePix && classificacao !== 'franquia') {
    alertas.push(
      `Boleto + PIX do frete: a nota vai como múltiplas formas de pagamento — o frete numa parcela de dia 0 ` +
        `e a mercadoria num boleto de ${ATACADO_PRAZO_BOLETO} dias.`
    );
    return {
      pagamento: pagamentoParcelado(
        montarParcelas({ prazos: [ATACADO_PRAZO_BOLETO], dataBaseIso, totalBoletos: total, fretePix })
      ),
      alertas,
    };
  }

  if (classificacao === 'franquia' && forma === FORMA_BOLETO) {
    alertas.push(
      'Franquia pagando com boleto: a nota vai como múltiplas formas de pagamento, em 3 parcelas ' +
        `(${PRAZOS_FRANQUIA_BOLETO.join('/')} dias)` +
        (fretePix ? ', mais o frete numa parcela de dia 0, por PIX.' : '.')
    );
    // A condição monta a tabela de parcelas no Tiny; as parcelas vão junto
    // para os valores saírem exatos, já rateados. Sem PIX, o frete entra nos
    // boletos (ver o topo do arquivo).
    return {
      pagamento: pagamentoParcelado(
        montarParcelas({
          prazos: PRAZOS_FRANQUIA_BOLETO,
          dataBaseIso,
          totalBoletos: fretePix ? total : total + frete,
          fretePix,
        })
      ),
      alertas,
    };
  }

  if (forma === FORMA_BOLETO) {
    return { pagamento: { forma_pagamento: FORMA_BOLETO }, alertas };
  }

  if (forma === FORMA_PIX && soPix(metodoPagamento)) {
    return { pagamento: { forma_pagamento: FORMA_PIX }, alertas };
  }

  // Fora do boleto e do PIX não vai nada: nem o código traduzido, nem um palpite.
  return { pagamento: {}, alertas };
}

/**
 * Reescreve os valores das parcelas a partir do total atual da nota.
 *
 * Existe porque a tela do rascunho deixa editar e remover itens depois que o
 * payload foi montado: sem isso, as parcelas iriam para o Tiny com o valor do
 * pedido original. Mexe só no `valor` — prazos e datas continuam os que foram
 * calculados na montagem.
 *
 * `total` é a soma dos itens; o desconto da nota é abatido e o frete somado
 * aqui dentro, para as parcelas fecharem no total da nota (ver o topo do
 * arquivo). A parcela do PIX do frete fica com o frete; os boletos dividem o
 * resto.
 */
export function recalcularParcelas(notaFiscal, total) {
  const parcelas = notaFiscal?.parcelas;
  if (!Array.isArray(parcelas) || parcelas.length === 0) return notaFiscal;

  const desconto = Number(notaFiscal[CAMPO_DESCONTO_TINY] ?? 0) || 0;
  const frete = Number(notaFiscal.valor_frete ?? 0) || 0;
  const fretePix = parcelas.some(ehParcelaDoFretePix);
  const totalBoletos = Math.max(0, total - desconto) + (fretePix ? 0 : frete);
  const valores = dividirEmParcelas(totalBoletos, parcelas.length - (fretePix ? 1 : 0));
  let proximo = 0;
  return {
    ...notaFiscal,
    parcelas: parcelas.map((p) => ({
      parcela: { ...p.parcela, valor: ehParcelaDoFretePix(p) ? valorMonetario(frete) : valores[proximo++] },
    })),
  };
}

/** Rótulos para a tela de conferência — o que a pessoa vê tem que ser o que vai. */
const ROTULOS = {
  multiplas: 'Múltiplas formas de pagamento',
  boleto_bancario: 'Boleto bancário',
  pix: 'PIX',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  credito_loja: 'Crédito loja',
  transferencia_bancaria: 'Transferência bancária',
  deposito_bancario: 'Depósito bancário',
  dinheiro: 'Dinheiro',
  cheque: 'Cheque',
  duplicata_mercantil: 'Duplicata mercantil',
};

/** Como a forma de pagamento da nota aparece na tela. */
export function rotuloFormaPagamento(codigo) {
  if (!codigo) return 'não enviada (preencher no Tiny)';
  return ROTULOS[codigo] ?? codigo;
}
