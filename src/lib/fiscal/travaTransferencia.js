// travaTransferencia.js — transferências que não podem ter nota fiscal.
//
// O Centro de Distribuição 1 e o 2 não emitem nota um para o outro, em
// nenhum sentido. A trava vale no servidor (rascunho e emissão) e na tela
// (os botões somem e a linha não entra em lote). Sem dependências de servidor:
// a tela importa este arquivo também.

const CENTROS_DE_DISTRIBUICAO = ['Rowa Centro de Distribuição 1', 'Rowa Centro de Distribuição 2'];

/** Compara nomes de loja sem ligar para caixa, acento, espaço e pontuação. */
function chave(nome) {
  return String(nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const CHAVES_CDS = new Set(CENTROS_DE_DISTRIBUICAO.map(chave));

/**
 * Motivo de a transferência não poder ter nota, ou null quando pode.
 * @param {string} origem nome do local de origem no Shopify
 * @param {string} destino nome do local de destino no Shopify
 */
export function bloqueioDaTransferencia(origem, destino) {
  const deCd = CHAVES_CDS.has(chave(origem));
  const paraCd = CHAVES_CDS.has(chave(destino));
  if (deCd && paraCd && chave(origem) !== chave(destino)) {
    return 'Transferência entre o Centro de Distribuição 1 e o 2 não tem nota fiscal — a emissão está travada.';
  }
  return null;
}
