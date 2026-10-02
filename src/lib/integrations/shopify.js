// Integração real com a Shopify Admin GraphQL API.
//
// Este arquivo é a única porta de entrada para os dados de pedido. As páginas e
// os outros módulos só conhecem `listarPedidosRecentes` e `obterPedidoCompleto`.

import { paraGid } from '../utils.js';

/**
 * POST genérico na Admin GraphQL API. Trata erros de rede, de GraphQL e userErrors.
 */
export async function shopifyGraphQL(query, variables = {}) {
  const dominio = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_API_TOKEN;
  const versao = process.env.SHOPIFY_API_VERSION;

  if (!dominio || !token || !versao) {
    throw new Error('Uma ou mais variáveis de ambiente do Shopify não configuradas.');
  }

  const url = `https://${dominio}/admin/api/${versao}/graphql.json`;

  let resposta;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
      // Sem isso, o Next.js guarda a resposta no Data Cache (em disco,
      // sobrevive a restart) e pedidos novos somem da lista até o cache
      // expirar sozinho — `dynamic = 'force-dynamic'` na rota não é
      // suficiente. Mesmo problema já documentado em lib/db.js.
      cache: 'no-store',
    });
  } catch (erro) {
    throw new Error(`Falha de rede ao chamar o Shopify: ${erro.message}`);
  }

  if (!resposta.ok) {
    throw new Error(`Shopify respondeu ${resposta.status} ${resposta.statusText}.`);
  }

  const dados = await resposta.json();

  if (dados.errors?.length) {
    throw new Error(`Erro de GraphQL no Shopify: ${dados.errors.map((e) => e.message).join('; ')}`);
  }

  // userErrors aparecem dentro de mutations; varremos o primeiro nível.
  for (const valor of Object.values(dados.data ?? {})) {
    if (valor?.userErrors?.length) {
      throw new Error(`Shopify recusou a operação: ${valor.userErrors.map((e) => e.message).join('; ')}`);
    }
  }

  return dados.data;
}

/** Query do pedido completo. `cursor` controla a paginação dos itens. */
export const QUERY_PEDIDO_COMPLETO = `
query PedidoAtacado($id: ID!, $cursor: String) {
  order(id: $id) {
    id name createdAt note
    customAttributes { key value }
    currentShippingPriceSet { shopMoney { amount } }
    customer {
      id displayName email phone
      metafields(first: 20) { nodes { namespace key value } }
    }
    billingAddress  { company address1 address2 city provinceCode zip }
    shippingAddress { company address1 address2 city provinceCode zip }
    discountApplications(first: 5) {
      nodes {
        ... on DiscountCodeApplication { code value { ... on PricingPercentageValue { percentage } } }
        ... on ManualDiscountApplication { title value { ... on PricingPercentageValue { percentage } } }
      }
    }
    lineItems(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        sku title quantity
        originalUnitPriceSet   { shopMoney { amount } }
        discountedUnitPriceSet { shopMoney { amount } }
      }
    }
  }
}`;

export const QUERY_PEDIDOS_RECENTES = `
query PedidosRecentes($limite: Int!, $cursor: String, $busca: String!) {
  orders(first: $limite, after: $cursor, sortKey: CREATED_AT, reverse: true, query: $busca) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt tags
      currentTotalPriceSet { shopMoney { amount } }
      note
      customAttributes { key value }
      customer {
        id displayName email
        metafields(first: 20) { nodes { namespace key value } }
      }
      billingAddress  { company address1 address2 city provinceCode zip }
      shippingAddress { company address1 address2 city provinceCode zip }
    }
  }
}`;

const FILTRO_BASE = 'financial_status:paid';

/** Aspas para a sintaxe de busca do Shopify (termos com espaço, "#", etc.). */
function entreAspas(termo) {
  return `"${String(termo).replace(/["\\]/g, '')}"`;
}

/**
 * Monta o `query` da busca de pedidos. `termos` são textos livres: número
 * curto vira nº do pedido (`name:#1024`); o resto (cliente, e-mail) o
 * Shopify procura nos campos padrão. `nomes`
 * são nºs de pedido exatos (ex.: vindos de uma busca por nº da NF). Qualquer
 * um que casar entra (OR); sem nenhum, só os pagos.
 */
function montarBusca({ termos = [], nomes = [] }) {
  const partes = [
    ...termos.map((t) => (/^#?\d{1,8}$/.test(t) ? `name:${entreAspas(t.startsWith('#') ? t : `#${t}`)}` : entreAspas(t))),
    ...nomes.map((n) => `name:${entreAspas(n)}`),
  ];
  if (partes.length === 0) return FILTRO_BASE;
  return `${FILTRO_BASE} AND (${partes.join(' OR ')})`;
}

/**
 * Uma página da lista de pedidos da tela de atacado, mais recentes primeiro.
 * Paginada por cursor no próprio Shopify: pedir tudo de uma vez (com os
 * metafields de cada cliente) deixava a consulta pesada e a tela lenta.
 */
export async function listarPedidosRecentes({ limite = 50, cursor = null, termos, nomes } = {}) {
  const dados = await shopifyGraphQL(QUERY_PEDIDOS_RECENTES, {
    limite,
    cursor,
    busca: montarBusca({ termos, nomes }),
  });
  const pedidos = dados.orders?.nodes ?? [];

  return {
    pageInfo: dados.orders?.pageInfo ?? { hasNextPage: false, endCursor: null },
    pedidos: pedidos.map((pedido) => ({
      id: pedido.id,
      name: pedido.name,
      createdAt: pedido.createdAt,
      cliente: pedido.customer?.displayName ?? 'Sem cliente',
      total: Number(pedido.currentTotalPriceSet?.shopMoney?.amount ?? 0),
      tags: pedido.tags ?? [],
      // O pedido inteiro vai junto para a classificação rodar sem uma segunda
      // consulta.
      _bruto: pedido,
    })),
  };
}

/**
 * Pedido completo, com TODOS os itens. Pagina `lineItems` até `hasNextPage === false`.
 */
export async function obterPedidoCompleto(orderId) {
  const gid = paraGid(orderId);
  const itens = [];
  let cursor = null;
  let temProximaPagina = true;
  let pedido = null;
  let paginasLidas = 0;

  while (temProximaPagina) {
    const dados = await shopifyGraphQL(QUERY_PEDIDO_COMPLETO, { id: gid, cursor });
    if (!dados.order) throw new Error(`Pedido ${gid} não encontrado no Shopify.`);
    pedido = dados.order;
    itens.push(...pedido.lineItems.nodes);
    temProximaPagina = pedido.lineItems.pageInfo.hasNextPage;
    cursor = pedido.lineItems.pageInfo.endCursor;
    paginasLidas += 1;
  }

  return { ...pedido, lineItems: itens, paginasLidas };
}

/** Ping usado pelo /api/saude. */
export async function verificarShopify() {
  const dados = await shopifyGraphQL(QUERY_PEDIDOS_RECENTES, { limite: 1, busca: FILTRO_BASE });
  const pedidos = dados.orders?.nodes ?? [];

  return {
    servico: 'Shopify',
    ok: true,
    modo: 'real',
    detalhe: `Conectado a ${process.env.SHOPIFY_STORE_DOMAIN}. ${pedidos.length} pedido(s) recente(s) encontrado(s).`,
  };
}
