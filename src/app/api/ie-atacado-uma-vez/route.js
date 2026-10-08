// TEMPORÁRIA — carga única da IE dos clientes de atacado em clientes_ie.
// Remover depois de rodar. Protegida por token (só o hash fica no código).
//   GET ?token=...            -> só lista (sem gastar crédito)
//   GET ?token=...&gravar=1   -> consulta o SintegrAPI e grava; se o tempo
//                                acabar, devolve `restantes` e `continuarApos` —
//                                chamar de novo com &apos=<continuarApos>.

import { createHash } from 'node:crypto';
import { shopifyGraphQL } from '@/lib/integrations/shopify';
import { extrairCnpj } from '@/lib/fiscal/classificacao';
import { listarCnpjsFranquia, ieDoCliente } from '@/lib/db';
import { resolverIe } from '@/lib/fiscal/inscricaoEstadual';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const HASH_TOKEN = 'b73398dca6847f30e35e66ebb2561b03b4e37f552a5f156e6a7a6cf683550f0c';
const ORCAMENTO_MS = 240000;

const QUERY = `
query Todos($cursor: String) {
  orders(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: true, query: "financial_status:paid") {
    pageInfo { hasNextPage endCursor }
    nodes {
      name note
      customAttributes { key value }
      customer { displayName metafields(first: 10) { nodes { namespace key value } } }
      billingAddress  { company provinceCode }
      shippingAddress { company provinceCode }
    }
  }
}`;

// Mesma regra de UF de montarNotaAtacado.
function ufDoPedido(p) {
  const prefixo = p.billingAddress ? 'billing' : 'shipping';
  const attr = (p.customAttributes ?? []).find((a) => a.key === `${prefixo}_province`)?.value;
  const endereco = p.billingAddress ?? p.shippingAddress ?? {};
  return String(attr || endereco.provinceCode || '').trim().toUpperCase();
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export async function GET(request) {
  const inicio = Date.now();
  const params = new URL(request.url).searchParams;
  const token = params.get('token') ?? '';
  if (createHash('sha256').update(token).digest('hex') !== HASH_TOKEN) return erroJson('Não autorizado.', 401);
  const gravar = params.get('gravar') === '1';
  const apos = params.get('apos') ?? '';

  const franquia = await listarCnpjsFranquia();
  if (!franquia.ok) return erroJson(`client_exce: ${franquia.erro}`);

  const clientes = new Map();
  let cursor = null;
  let pedidos = 0;
  do {
    let dados;
    for (let t = 0; ; t++) {
      try {
        dados = await shopifyGraphQL(QUERY, { cursor });
        break;
      } catch (erro) {
        if (t >= 5 || !/throttl/i.test(erro.message)) return erroJson(erro.message);
        await espera(3000);
      }
    }
    for (const p of dados.orders.nodes) {
      pedidos++;
      const { cnpj } = extrairCnpj(p);
      if (!cnpj || franquia.cnpjs.includes(cnpj) || clientes.has(cnpj)) continue;
      clientes.set(cnpj, { nome: p.customer?.displayName ?? '', uf: ufDoPedido(p), pedido: p.name });
    }
    cursor = dados.orders.pageInfo.hasNextPage ? dados.orders.pageInfo.endCursor : null;
  } while (cursor);

  const pendentes = [];
  for (const [cnpj, c] of clientes) {
    const salvo = await ieDoCliente(cnpj);
    if (!salvo.ok) return erroJson(`clientes_ie: ${salvo.erro}`);
    if (!salvo.ie) pendentes.push({ cnpj, ...c });
  }
  pendentes.sort((a, b) => a.cnpj.localeCompare(b.cnpj));

  const resumo = { pedidos, clientesAtacado: clientes.size, jaNoBanco: clientes.size - pendentes.length, aConsultar: pendentes.length };
  if (!gravar) return Response.json({ ...resumo, pendentes });

  // CNPJ sem IE não é gravado: `apos` evita consultá-lo de novo na chamada seguinte.
  const fila = pendentes.filter((c) => c.cnpj > apos);
  const resultado = [];
  for (const c of fila) {
    if (Date.now() - inicio > ORCAMENTO_MS) break;
    const r = await resolverIe({ cnpj: c.cnpj, uf: c.uf });
    resultado.push({ ...c, ie: r.ie || null, alertas: r.alertas });
  }
  return Response.json({
    ...resumo,
    consultados: resultado.length,
    gravados: resultado.filter((r) => r.ie).length,
    restantes: fila.length - resultado.length,
    continuarApos: fila.length > resultado.length ? resultado.at(-1)?.cnpj ?? apos : null,
    resultado,
  });
}
