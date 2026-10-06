// sintegrapi.js — consulta de inscrição estadual (IE) pelo CNPJ no SintegrAPI
// (https://docs.sintegrapi.com.br/sintegra).
//
// Cada consulta gasta crédito: 1 por UF, 26 com `uf=BR` (todas). Por isso a
// consulta vai sempre com a UF do cliente, e quem chama guarda o resultado no
// Supabase (tabela clientes_ie) para não consultar o mesmo CNPJ de novo. Erros
// 4xx/5xx não gastam crédito.

import { somenteDigitos } from '../utils.js';

const BASE = 'https://api.sintegrapi.com.br';
const TEMPO_LIMITE_MS = 20000;

/**
 * Inscrições estaduais do CNPJ na UF informada, como o SintegrAPI devolve:
 * `[{ inscricao_estadual, uf, ativa, tipo_ie, situacao_pj }]`. Lista vazia
 * quando o CNPJ não tem IE nessa UF. Lança exceção em falha de rede, chave
 * ausente ou erro da API.
 */
export async function consultarInscricoesEstaduais(cnpj, uf) {
  const chave = (process.env.SINTEGRAPI_API_KEY ?? '').trim();
  if (!chave) throw new Error('SintegrAPI não configurado (SINTEGRAPI_API_KEY ausente).');

  const url = new URL(`${BASE}/consultas/v2/sintegra/${somenteDigitos(cnpj)}`);
  url.searchParams.set('uf', uf);

  const resposta = await fetch(url, {
    headers: { 'x-api-key': chave },
    cache: 'no-store',
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  });

  // 404: CNPJ válido, mas sem registro na fonte oficial — ou seja, sem IE.
  if (resposta.status === 404) return [];

  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok || !corpo?.success) {
    throw new Error(`SintegrAPI respondeu ${resposta.status}: ${corpo?.message ?? 'sem detalhes'}`);
  }
  return corpo.inscricoes_estaduais ?? [];
}
