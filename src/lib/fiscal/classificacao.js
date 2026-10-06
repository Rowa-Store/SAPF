// classificacao.js — decide se um pedido do Shopify é de atacado, de franquia
// ou nenhum dos dois. A regra de negócio é: quem tem CNPJ é atacado; se o CNPJ
// estiver na lista de franquias, é franquia.

import { pareceCnpj, somenteDigitos } from '../utils.js';
import { listarCnpjsFranquia } from '../db.js';

// Não existe mais lista fixa de CNPJs no código — a fonte de verdade é a
// tabela client_exce no Supabase (ver supabase/schema.sql e
// listarCnpjsFranquia em src/lib/db.js). Se a consulta falhar, tratamos como
// "nenhum franqueado conhecido" (ver classificarPedido) em vez de arriscar
// classificar errado.

// TODO: confirmar onde o CNPJ é armazenado no Shopify (metafield do cliente,
// company do endereço de cobrança, note_attributes ou B2B)
// Enquanto não há confirmação, lemos todos os candidatos abaixo, na ordem, e
// usamos o primeiro que existir. A ordem vai do mais estruturado para o mais
// improvisado, porque campo estruturado erra menos.
export function extrairCnpj(pedido) {
  if (!pedido) return { cnpj: '', origem: null };

  const candidatos = [];

  // 1. Metafields do cliente (ex.: namespace "custom", key "cnpj").
  const metafields = pedido?.customer?.metafields?.nodes ?? [];
  for (const mf of metafields) {
    if (/cnpj|documento|cpf_cnpj/i.test(`${mf.namespace}.${mf.key}`)) {
      candidatos.push({ valor: mf.value, origem: `metafield ${mf.namespace}.${mf.key}` });
    }
  }

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

  // O "company" pode conter só a razão social, sem número nenhum — por isso
  // só aceitamos o candidato cujo conteúdo realmente tem 14 dígitos.
  for (const candidato of candidatos) {
    if (pareceCnpj(candidato.valor)) {
      return { cnpj: somenteDigitos(candidato.valor), origem: candidato.origem };
    }
  }

  return { cnpj: '', origem: null };
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
