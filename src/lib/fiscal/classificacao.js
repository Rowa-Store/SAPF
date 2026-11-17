// classificacao.js — decide se um pedido do Shopify é de atacado, de franquia
// ou nenhum dos dois. A regra de negócio é: quem tem CNPJ é atacado; se o CNPJ
// estiver na lista de franquias, é franquia.

import { cnpjValido, pareceCnpj, somenteDigitos } from '../utils.js';
import { listarCnpjsFranquia } from '../db.js';

// Não existe mais lista fixa de CNPJs no código — a fonte de verdade é a
// tabela client_exce no Supabase (ver supabase/schema.sql e
// listarCnpjsFranquia em src/lib/db.js). Se a consulta falhar, tratamos como
// "nenhum franqueado conhecido" (ver classificarPedido) em vez de arriscar
// classificar errado.

// O CNPJ vem do CADASTRO do cliente na Shopify (metafield custom.cnpj),
// não do pedido: o que o checkout grava no pedido pode estar desatualizado ou
// ser de outra empresa. Só quando o cadastro está em branco caímos para os
// dados do próprio pedido (ver candidatosDeDocumento), para não travar o
// pedido de quem ainda não tem o CNPJ cadastrado.
export function extrairCnpj(pedido) {
  // O "company" pode conter só a razão social, sem número nenhum — por isso
  // só aceitamos o candidato cujo conteúdo realmente tem 14 dígitos.
  const achado = candidatosDeDocumento(pedido).find((c) => pareceCnpj(c.valor));
  return achado ? { cnpj: somenteDigitos(achado.valor), origem: achado.origem } : { cnpj: '', origem: null };
}

/**
 * CPF ou CNPJ do cliente do varejo (loja online), só dígitos. Os mesmos
 * candidatos do CNPJ (cadastro do cliente primeiro), aceitando também os 11
 * dígitos do CPF — que o checkout grava em `info_document`.
 */
export function extrairDocumento(pedido) {
  const achado = candidatosDeDocumento(pedido).find((c) => [11, 14].includes(somenteDigitos(c.valor).length));
  return achado
    ? { documento: somenteDigitos(achado.valor), origem: achado.origem }
    : { documento: '', origem: null };
}

/** Onde o documento do cliente pode estar, do mais estruturado para o mais improvisado. */
function candidatosDeDocumento(pedido) {
  const candidatos = [];

  // 1. Cadastro do cliente — a fonte de verdade.
  const doCadastro = cnpjDoCadastro(pedido?.customer?.cnpj?.value);
  if (doCadastro) candidatos.push({ valor: doCadastro, origem: 'cadastro do cliente (custom.cnpj)' });

  // 2 a 4: dados do pedido — só valem quando o cadastro está em branco.
  // 2. Campo "company" dos endereços (comum em contas B2B do Shopify).
  if (pedido?.billingAddress?.company) {
    candidatos.push({ valor: pedido.billingAddress.company, origem: 'billingAddress.company' });
  }
  if (pedido?.shippingAddress?.company) {
    candidatos.push({ valor: pedido.shippingAddress.company, origem: 'shippingAddress.company' });
  }

  // 3. customAttributes (equivale aos note_attributes da API REST).
  // Confirmado em pedidos reais: o checkout grava o CNPJ na chave
  // "info_document" (em inglês, sem o "o" final de "documento") — por isso o
  // regex casa com "document" e não só com a grafia em português.
  for (const attr of pedido?.customAttributes ?? []) {
    if (/cnpj|document|cpf_cnpj/i.test(attr.key ?? '')) {
      candidatos.push({ valor: attr.value, origem: `customAttributes.${attr.key}` });
    }
  }

  // 4. Último recurso: um CNPJ escrito na observação do pedido.
  if (pedido?.note) {
    const achado = String(pedido.note).match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/);
    if (achado) candidatos.push({ valor: achado[0], origem: 'note' });
  }

  return candidatos;
}

/**
 * CNPJ do metafield custom.cnpj do cliente, só dígitos, ou '' se não houver.
 * O metafield é do tipo número inteiro, então a Shopify devolve o CNPJ sem os
 * zeros à esquerda (03746514000189 vira 3746514000189): completamos até 14
 * dígitos e, só nesse caso, conferimos os dígitos verificadores para não
 * inventar um CNPJ a partir de um número qualquer.
 */
export function cnpjDoCadastro(valor) {
  const digitos = somenteDigitos(valor ?? '');
  if (!digitos || digitos.length > 14) return '';
  if (digitos.length === 14) return digitos;
  const completo = digitos.padStart(14, '0');
  return cnpjValido(completo) ? completo : '';
}

/** Igual a classificarPedido, mas recebe a lista de CNPJs de franquia já
 *  pronta — usado por quem precisa classificar vários pedidos de uma vez
 *  (ver /api/pedidos) sem repetir a consulta ao Supabase para cada um. */
export function classificarComListaFranquia(pedido, cnpjsFranquia) {
  const { cnpj } = extrairCnpj(pedido);
  if (!cnpj) return 'outro';
  return cnpjsFranquia.includes(cnpj) ? 'franquia' : 'atacado';
}

/** Retorna "atacado", "franquia" ou "outro". Busca a lista de franqueados no
 *  Supabase a cada chamada; se a consulta falhar, trata como se nenhum CNPJ
 *  fosse de franquia (nunca classifica errado como franquia por falta de
 *  dado — na dúvida, cai para "atacado" ou "outro"). */
export async function classificarPedido(pedido) {
  const { ok, cnpjs, erro } = await listarCnpjsFranquia();
  if (!ok) {
    console.error('[classificacao] Falha ao buscar client_exce no Supabase, classificando sem a lista de franquia:', erro);
  }
  return classificarComListaFranquia(pedido, ok ? cnpjs : []);
}
