// pagamento.js — a forma de pagamento da nota e, quando é o caso, as parcelas.
//
// Regra de negócio combinada:
//
//   - FRANQUIA pagando com BOLETO: a nota não vai como boleto. Vai como
//     "múltiplas formas de pagamento" (`multiplas`) e leva 3 parcelas, com
//     vencimento em 30, 45 e 60 dias contados da data de emissão.
//   - ATACADO pagando com BOLETO: a nota leva `boleto_bancario`, sem parcelas.
//   - Qualquer outra forma de pagamento (PIX, cartão, transferência...): a
//     nota vai SEM `forma_pagamento`. Só boleto é enviado ao Tiny; o resto
//     fica para ser preenchido lá dentro, e a tela avisa.
//
// A forma de pagamento chega do Shopify como TEXTO LIVRE, no metafield
// `custom.metodo_pagamento` do pedido ("Boleto", "boleto bancário", "PIX",
// "Cartão de crédito"...). O Tiny não aceita texto livre: `forma_pagamento` é
// uma lista fechada de códigos, que segue os meios de pagamento da NFe
// (tPag). Por isso o texto passa pelo de-para abaixo, que continua
// reconhecendo todas as formas — o rótulo traduzido é o que a tela usa para
// dizer o que veio do Shopify. O que vai para o Tiny, porém, é só boleto:
// qualquer outra forma (ou texto que não casar com nenhum código) sai da nota
// SEM forma de pagamento (campo omitido) mais um alerta na tela — mandar um
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
// boleto) e `boleto_bancario` (o resto com boleto). Os demais códigos do
// de-para (pix, cartao_credito...) existem só para o rótulo da tela — se um
// dia passarem a ser enviados, confirmar antes a grafia exata com o time
// fiscal: `multiplas` é o único visto chegando no Tiny em rascunho real.

import { valorMonetario } from '../utils.js';
import { CAMPO_DESCONTO_TINY } from './desconto.js';

/** Código do Tiny para "múltiplas formas de pagamento". */
export const FORMA_MULTIPLAS = 'multiplas';

/** Código do Tiny para boleto bancário (tPag 15). */
export const FORMA_BOLETO = 'boleto_bancario';

/** Categoria financeira combinada — só para exibir na tela; a API não a aceita. */
export const CATEGORIA_PADRAO = 'Compras';

/** Forma de cada parcela, como está cadastrada no Tiny. */
export const FORMA_DA_PARCELA = 'Conta a Receber';

/** Prazos, em dias, das parcelas de franquia com boleto. */
export const PRAZOS_FRANQUIA_BOLETO = [30, 45, 60];

/** "30 45 60" — o texto que o Tiny lê em "Condição de pagamento". */
export const CONDICAO_FRANQUIA_BOLETO = PRAZOS_FRANQUIA_BOLETO.join(' ');

/**
 * De-para do texto livre do Shopify para o código do Tiny. A ordem importa: o
 * primeiro padrão que casar vence, então o mais específico ("cartão de
 * crédito") vem antes do mais genérico ("crédito").
 */
const DE_PARA = [
  [/boleto/, FORMA_BOLETO],
  [/\bpix\b/, 'pix'],
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

/** As 3 parcelas de 30/45/60 dias da franquia com boleto. */
function parcelasFranquiaBoleto(dataBaseIso, total) {
  const valores = dividirEmParcelas(total, PRAZOS_FRANQUIA_BOLETO.length);
  return PRAZOS_FRANQUIA_BOLETO.map((dias, indice) => ({
    parcela: {
      dias,
      data: vencimento(dataBaseIso, dias),
      valor: valores[indice],
      forma_pagamento: FORMA_DA_PARCELA,
    },
  }));
}

/**
 * Monta o pedaço de pagamento da nota.
 *
 * @param {object} opcoes
 * @param {"atacado"|"franquia"|"outro"} opcoes.classificacao
 * @param {string} opcoes.metodoPagamento texto cru do metafield do Shopify
 * @param {string} [opcoes.dataBaseIso] data de emissão (createdAt do pedido)
 * @param {number} [opcoes.total] total dos itens da nota
 * @returns {{ pagamento: object, alertas: string[] }} `pagamento` já pronto
 *   para entrar em `nota_fiscal` — vem vazio sempre que o pagamento não é
 *   boleto, porque só boleto é enviado ao Tiny.
 */
export function montarPagamento({ classificacao, metodoPagamento, dataBaseIso, total = 0 }) {
  const alertas = [];
  const forma = formaDePagamentoTiny(metodoPagamento);

  if (classificacao === 'franquia' && forma === FORMA_BOLETO) {
    alertas.push(
      'Franquia pagando com boleto: a nota vai como múltiplas formas de pagamento, em 3 parcelas ' +
        `(${PRAZOS_FRANQUIA_BOLETO.join('/')} dias).`
    );
    return {
      pagamento: {
        forma_pagamento: FORMA_MULTIPLAS,
        // É a condição que monta a tabela de parcelas no Tiny; as parcelas
        // abaixo vão junto para os valores saírem exatos, já rateados.
        condicao_pagamento: CONDICAO_FRANQUIA_BOLETO,
        parcelas: parcelasFranquiaBoleto(dataBaseIso, total),
      },
      alertas,
    };
  }

  if (forma === FORMA_BOLETO) {
    return { pagamento: { forma_pagamento: FORMA_BOLETO }, alertas };
  }

  // Fora do boleto não vai nada: nem o código traduzido, nem um palpite.
  // Forma não reconhecida não gera alerta.
  if (forma) {
    alertas.push(
      `Pagamento por ${rotuloFormaPagamento(forma)}: só boleto é enviado ao Tiny, então a nota vai ` +
        'sem forma de pagamento. Preencha esse campo dentro do Tiny antes de emitir.'
    );
  }
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
 * `total` é a soma dos itens; o desconto da nota é abatido aqui dentro, para
 * as parcelas somarem o que o cliente vai pagar de fato (ver desconto.js).
 */
export function recalcularParcelas(notaFiscal, total) {
  const parcelas = notaFiscal?.parcelas;
  if (!Array.isArray(parcelas) || parcelas.length === 0) return notaFiscal;

  const desconto = Number(notaFiscal[CAMPO_DESCONTO_TINY] ?? 0) || 0;
  const valores = dividirEmParcelas(Math.max(0, total - desconto), parcelas.length);
  return {
    ...notaFiscal,
    parcelas: parcelas.map((p, indice) => ({
      parcela: { ...p.parcela, valor: valores[indice] },
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
