// corrigirNcm.js — a correção geral de NCM da Olist (tela /olist/ncm): grava
// em cada produto o NCM da regra do código (fiscal/ncm.js), pelo nome do
// produto na Olist. ESCREVE NA CONTA DE PRODUÇÃO.
//
// Cada variação tem o NCM no próprio cadastro (o produto.obter do pai não
// traz o das variações), então cada produto da lista — simples, pai ou
// variação — é lido e conferido pelo próprio id. Produto sem regra não é
// tocado. O payload sai de cadastroParaAlterar.js.

import { ncmDoProduto } from '../fiscal/ncm.js';
import { alterarProduto, erroDeLimite, obterProduto } from '../integrations/tiny.js';
import { cadastroParaAlterar, temValor, variacaoParaAlterar } from './cadastroParaAlterar.js';

/** NCM que o produto da Olist deve ter, pelo nome (e pelo Tipo de produto do
 *  Shopify, quando se sabe); null quando nenhuma regra casa. */
export function ncmEsperado(nome, tipo = '') {
  return ncmDoProduto({ titulo: nome, tipo });
}

const digitos = (ncm) => String(ncm ?? '').replace(/\D+/g, '');
const ncmDe = (cadastro) => String(cadastro?.ncm ?? '').trim();

/**
 * Corrige o NCM do produto `id`. Simples ou pai: pelo próprio cadastro (o pai
 * vai com as variações, sem mexer no NCM delas — elas estão na fila também).
 * Variação: tenta pelo id dela; se o NCM continuar errado, pelo pai. Relê
 * depois de gravar para conferir.
 *
 * @returns {Promise<{ alvo: string, nome: string, acao: 'corrigido'|'ja_certo'|'sem_regra',
 *   de: string, para: string|null, restante: string|null, conferido: boolean, via?: string, erros?: string[] }>}
 *   de: o NCM que estava; restante: o NCM lido depois, se continuou errado.
 */
export async function corrigirNcmDoProduto(id) {
  const cadastro = await obterProduto(id);
  if (!cadastro) throw new Error(`Produto ${id} não encontrado na Olist.`);

  const alvo = String(cadastro.id);
  const nome = cadastro.nome ?? '';
  const para = ncmEsperado(nome);
  const de = ncmDe(cadastro);
  const base = { alvo, nome, de, para };
  if (!para) return { ...base, acao: 'sem_regra', restante: null, conferido: true };
  if (digitos(de) === digitos(para)) return { ...base, acao: 'ja_certo', restante: null, conferido: true };

  const variacao = temValor(cadastro.idProdutoPai) && String(cadastro.idProdutoPai) !== '0';
  const tentativas = variacao
    ? [
        ['variação', () => alterarProduto(alvo, variacaoParaAlterar(cadastro, { ncm: para }))],
        ['pai', async () => {
          const pai = await obterProduto(cadastro.idProdutoPai);
          if (!pai) throw new Error(`Pai da variação ${alvo} não encontrado na Olist.`);
          await alterarProduto(String(pai.id), cadastroParaAlterar(pai, { ncm: para }));
        }],
      ]
    : [['produto', () => alterarProduto(alvo, cadastroParaAlterar(cadastro, { ncm: para }))]];

  const erros = [];
  let restante = de;
  for (const [via, alterar] of tentativas) {
    try {
      await alterar();
    } catch (e) {
      // Limite: sobe para a tela esperar e repetir — repetir é seguro.
      if (erroDeLimite(e.message)) throw e;
      erros.push(`pelo(a) ${via}: ${e.message}`);
      continue;
    }
    // Gravou; a conferência é bônus — se a releitura falhar, não desfaz nada.
    let depois;
    try {
      depois = await obterProduto(alvo);
    } catch {
      return { ...base, acao: 'corrigido', via, restante: null, conferido: false };
    }
    restante = ncmDe(depois);
    if (digitos(restante) === digitos(para)) return { ...base, acao: 'corrigido', via, restante: null, conferido: true };
  }
  if (erros.length === tentativas.length) throw new Error(`Olist recusou a correção — ${erros.join(' | ')}`);
  return { ...base, acao: 'corrigido', restante: restante || '(vazio)', conferido: true, erros };
}
