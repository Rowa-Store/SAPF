// TEMPORÁRIA — carga única da IE dos clientes de atacado em clientes_ie.
// Remover depois de rodar. Protegida por token (só o hash fica no código).
//
// Os pedidos vêm de uma bulk operation do Shopify (ler página por página
// passava do tempo limite da função):
//   GET ?token=...&etapa=iniciar -> dispara a leitura de todos os pedidos pagos
//   GET ?token=...               -> status da leitura; pronta, lista os CNPJs
//                                   sem IE (sem gastar crédito)
//   GET ?token=...&gravar=1      -> consulta o SintegrAPI e grava; se o tempo
//                                   acabar, devolve `continuarApos` — chamar de
//                                   novo com &apos=<continuarApos>.

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

const QUERY_BULK = `{
  orders(query: "financial_status:paid") {
    edges { node {
      id name note createdAt
      customAttributes { key value }
      customer { id displayName metafields { edges { node { namespace key value } } } }
      billingAddress  { company provinceCode }
      shippingAddress { company provinceCode }
    } }
  }
}`;

const MUTATION_INICIAR = `
mutation Iniciar($query: String!) {
  bulkOperationRunQuery(query: $query) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`;

const QUERY_STATUS = `{ currentBulkOperation { id status errorCode objectCount url createdAt } }`;

// Mesma regra de UF de montarNotaAtacado.
function ufDoPedido(p) {
  const prefixo = p.billingAddress ? 'billing' : 'shipping';
  const attr = (p.customAttributes ?? []).find((a) => a.key === `${prefixo}_province`)?.value;
  const endereco = p.billingAddress ?? p.shippingAddress ?? {};
  return String(attr || endereco.provinceCode || '').trim().toUpperCase();
}

/** JSONL da bulk operation -> pedidos no formato que extrairCnpj espera. Os
 *  metafields vêm em linhas próprias, com __parentId = id do cliente. */
function pedidosDoJsonl(texto) {
  const pedidos = [];
  const metafields = new Map();
  for (const linha of texto.split('\n')) {
    if (!linha.trim()) continue;
    const obj = JSON.parse(linha);
    if (obj.__parentId) {
      if (!metafields.has(obj.__parentId)) metafields.set(obj.__parentId, []);
      metafields.get(obj.__parentId).push(obj);
    } else {
      pedidos.push(obj);
    }
  }
  for (const p of pedidos) {
    if (p.customer) p.customer.metafields = { nodes: metafields.get(p.customer.id) ?? [] };
  }
  // Mais recentes primeiro, para a UF sair do último pedido do cliente.
  return pedidos.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function GET(request) {
  const inicio = Date.now();
  const params = new URL(request.url).searchParams;
  const token = params.get('token') ?? '';
  if (createHash('sha256').update(token).digest('hex') !== HASH_TOKEN) return erroJson('Não autorizado.', 401);

  try {
    if (params.get('etapa') === 'iniciar') {
      const dados = await shopifyGraphQL(MUTATION_INICIAR, { query: QUERY_BULK });
      return Response.json({ iniciada: dados.bulkOperationRunQuery.bulkOperation });
    }

    const { currentBulkOperation: op } = await shopifyGraphQL(QUERY_STATUS);
    if (!op) return Response.json({ aviso: 'Nenhuma leitura iniciada. Chame com &etapa=iniciar.' });
    if (op.status !== 'COMPLETED') return Response.json({ leitura: op });

    const gravar = params.get('gravar') === '1';
    const apos = params.get('apos') ?? '';

    const franquia = await listarCnpjsFranquia();
    if (!franquia.ok) return erroJson(`client_exce: ${franquia.erro}`);

    const texto = op.url ? await (await fetch(op.url, { cache: 'no-store' })).text() : '';
    const pedidos = pedidosDoJsonl(texto);

    const clientes = new Map();
    for (const p of pedidos) {
      const { cnpj } = extrairCnpj(p);
      if (!cnpj || franquia.cnpjs.includes(cnpj) || clientes.has(cnpj)) continue;
      clientes.set(cnpj, { nome: p.customer?.displayName ?? '', uf: ufDoPedido(p), pedido: p.name });
    }

    const entradas = [...clientes];
    const salvos = [];
    for (let i = 0; i < entradas.length; i += 20) {
      salvos.push(...(await Promise.all(entradas.slice(i, i + 20).map(([cnpj]) => ieDoCliente(cnpj)))));
    }
    const falha = salvos.find((s) => !s.ok);
    if (falha) return erroJson(`clientes_ie: ${falha.erro}`);
    const pendentes = entradas
      .filter((_, i) => !salvos[i].ie)
      .map(([cnpj, c]) => ({ cnpj, ...c }))
      .sort((a, b) => a.cnpj.localeCompare(b.cnpj));

    const resumo = {
      pedidos: pedidos.length,
      clientesAtacado: clientes.size,
      jaNoBanco: clientes.size - pendentes.length,
      aConsultar: pendentes.length,
      semUf: pendentes.filter((c) => !c.uf).length,
    };
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
  } catch (erro) {
    return erroJson(erro.message);
  }
}
