// tinyContas.js — de qual conta do Tiny sai cada nota de transferência.
//
// Cada loja tem a sua conta no Tiny (Olist). A nota de transferência é emitida
// pela loja de ORIGEM, então vai para a conta dela — pela matriz só sai a
// transferência que parte da própria matriz.
//
// O token de cada conta mora numa variável de ambiente com o nome do local de
// origem no Shopify: TINY_API_TOKEN_<NOME_DA_LOJA> (ver variavelTokenDaLoja).
// Sem a variável da loja de origem, a nota NÃO é criada — cair no token da
// matriz seria justamente o erro fiscal que isto corrige. A exceção são os
// locais da própria matriz (LOCAIS_DA_MATRIZ), que usam TINY_API_TOKEN.
//
// Nada disso é gravado: a conta de uma nota é sempre a da loja de origem da
// transferência, lida de novo no Shopify. As notas criadas antes disto estão
// na conta da matriz — por isso as leituras (DANFE, situação) tentam a conta
// da origem e, se o Tiny não achar a nota lá, a da matriz.

import { obterOrigemTransferencia } from './shopifyTransferencias.js';
import { variavelTokenDaLoja } from './tiny.js';

/**
 * Locais que emitem pela conta da matriz (TINY_API_TOKEN), sem variável
 * própria. Comparados pelo nome normalizado, igual ao da variável — espaço
 * duplo e acento no Shopify não atrapalham.
 */
const LOCAIS_DA_MATRIZ = ['Rowa Centro de Distribuição 1', 'Rowa Centro de Distribuição 2'];
const VARIAVEIS_DA_MATRIZ = new Set(LOCAIS_DA_MATRIZ.map(variavelTokenDaLoja));

/**
 * Conta do Tiny de uma loja, pelo nome do local no Shopify.
 * Devolve { ok: true, conta } ou { ok: false, erro } — nunca lança.
 * `conta.matriz` diz se o token é o mesmo da matriz (TINY_API_TOKEN).
 */
export function contaTinyDaLoja(nomeLoja) {
  const variavel = variavelTokenDaLoja(nomeLoja);
  if (!variavel) {
    return { ok: false, erro: 'A transferência não tem loja de origem — sem ela não dá para saber de qual conta do Tiny a nota sai.' };
  }

  if (VARIAVEIS_DA_MATRIZ.has(variavel)) {
    const token = (process.env.TINY_API_TOKEN ?? '').trim();
    if (!token) return { ok: false, erro: 'TINY_API_TOKEN não configurado. Preencha as variáveis do Vercel.' };
    return { ok: true, conta: { token, variavel: 'TINY_API_TOKEN', matriz: true, nome: nomeLoja } };
  }

  const token = (process.env[variavel] ?? '').trim();
  if (!token) {
    return {
      ok: false,
      erro:
        `A loja de origem "${nomeLoja}" não tem token do Tiny configurado. Crie a variável de ambiente ` +
        `${variavel} (no Vercel) com o token da API da conta Olist dessa loja.`,
    };
  }

  const matriz = token === (process.env.TINY_API_TOKEN ?? '').trim();
  return { ok: true, conta: { token, variavel, matriz, nome: nomeLoja } };
}

/** Conta do Tiny da loja de origem da transferência (lida no Shopify). */
export async function contaTinyDaTransferencia(id) {
  let origem;
  try {
    origem = await obterOrigemTransferencia(id);
  } catch (erro) {
    return { ok: false, erro: `Não foi possível ler a loja de origem no Shopify: ${erro.message}` };
  }
  return contaTinyDaLoja(origem?.name);
}

/**
 * Só para LEITURA de nota já criada: roda `chamada(conta)` na conta da origem
 * e, se falhar, na da matriz — onde estão as notas anteriores às contas por
 * loja. Falhando nas duas, lança o erro da conta da origem.
 */
export async function lerNaContaDaNota(conta, chamada) {
  try {
    return await chamada(conta);
  } catch (erro) {
    if (!conta || conta.matriz) throw erro;
    try {
      return await chamada(null);
    } catch {
      throw erro;
    }
  }
}
