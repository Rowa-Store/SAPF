// inscricaoEstadual.js — descobre a inscrição estadual (IE) do cliente de
// atacado a partir do CNPJ do pedido.
//
// Ordem:
//   1. tabela clientes_ie do Supabase (de graça);
//   2. SintegrAPI, na UF do cliente (gasta crédito). A IE achada é gravada em
//      clientes_ie, para o próximo pedido do mesmo cliente parar no passo 1.
//
// Não achar a IE não derruba o preview: a nota sai com o campo vazio e um
// alerta, e a pessoa preenche à mão na tela do rascunho.

import { gravarIeDoCliente, ieDoCliente } from '../db.js';
import { consultarInscricoesEstaduais } from '../integrations/sintegrapi.js';
import { somenteDigitos } from '../utils.js';

const PREENCHA = 'Preencha o campo à mão antes de incluir o rascunho.';

/**
 * @param {{ cnpj: string, uf: string }} cliente UF do endereço da nota
 * @returns {Promise<{ ie: string, origem: 'banco'|'sintegrapi'|null, alertas: string[] }>}
 */
export async function resolverIe({ cnpj, uf }) {
  const alertas = [];
  const doc = somenteDigitos(cnpj);
  if (!doc) return { ie: '', origem: null, alertas };

  // 1. Cache no Supabase. Se a consulta falhar, seguimos para o SintegrAPI.
  const salvo = await ieDoCliente(doc);
  if (salvo.ok && salvo.ie) return { ie: salvo.ie, origem: 'banco', alertas };
  if (!salvo.ok) console.error(`[ie] Falha ao ler a IE do cliente ${doc} no Supabase:`, salvo.erro);

  // 2. SintegrAPI — sem UF a consulta teria que ir em todas (26 créditos).
  const ufCliente = String(uf ?? '').trim().toUpperCase();
  if (!ufCliente) {
    alertas.push(`Inscrição estadual (IE) não consultada: o pedido não tem UF. ${PREENCHA}`);
    return { ie: '', origem: null, alertas };
  }

  let inscricoes;
  try {
    inscricoes = await consultarInscricoesEstaduais(doc, ufCliente);
  } catch (erro) {
    console.error(`[ie] Falha ao consultar a IE do cliente ${doc} no SintegrAPI:`, erro.message);
    alertas.push(`Não foi possível consultar a inscrição estadual (IE) no SintegrAPI: ${erro.message.replace(/\.$/, '')}. ${PREENCHA}`);
    return { ie: '', origem: null, alertas };
  }

  const daUf = inscricoes.filter((i) => String(i.uf ?? '').toUpperCase() === ufCliente);
  const escolhida = daUf.find((i) => i.ativa) ?? null;
  const ie = somenteDigitos(escolhida?.inscricao_estadual);
  if (!ie) {
    alertas.push(
      daUf.length
        ? `O CNPJ tem inscrição estadual em ${ufCliente}, mas nenhuma ativa. ${PREENCHA}`
        : `O SintegrAPI não encontrou inscrição estadual (IE) do CNPJ em ${ufCliente}. ${PREENCHA}`
    );
    return { ie: '', origem: null, alertas };
  }

  if (escolhida.situacao_pj && !/sem restri/i.test(escolhida.situacao_pj)) {
    alertas.push(`Inscrição estadual ${ie} com restrição no Sintegra: "${escolhida.situacao_pj}". Confira antes de emitir.`);
  }

  const gravacao = await gravarIeDoCliente({ cnpj: doc, ie, uf: ufCliente, origem: 'sintegrapi' });
  if (!gravacao.ok) console.error(`[ie] Falha ao gravar a IE do cliente ${doc} no Supabase:`, gravacao.erro);

  return { ie, origem: 'sintegrapi', alertas };
}
