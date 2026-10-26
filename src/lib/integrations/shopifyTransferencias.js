// shopifyTransferencias.js — transferências de estoque entre lojas (Admin
// GraphQL API, `inventoryTransfers`).
//
// Usa o mesmo token da Admin API dos pedidos (SHOPIFY_API_TOKEN), que precisa
// ter também os escopos read_inventory_transfers, read_locations,
// read_inventory e read_products.

import { shopifyGraphQL } from './shopify.js';

/** Aceita "123" ou o gid completo e sempre devolve o gid da transferência. */
export function paraGidTransferencia(id) {
  const texto = String(id ?? '');
  if (texto.startsWith('gid://')) return texto;
  return `gid://shopify/InventoryTransfer/${texto}`;
}

const QUERY_TRANSFERENCIAS = `
query Transferencias($first: Int!, $after: String, $query: String) {
  inventoryTransfers(first: $first, after: $after, query: $query, reverse: true, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name referenceName dateCreated status totalQuantity receivedQuantity
      origin { name location { id } }
      destination { name location { id } }
    }
  }
}`;

const QUERY_LOCAIS = `
query Locais {
  locations(first: 250, includeInactive: true) { nodes { id name isActive } }
}`;

const QUERY_TRANSFERENCIA_COMPLETA = `
query Transferencia($id: ID!, $cursor: String) {
  inventoryTransfer(id: $id) {
    id name referenceName dateCreated status note totalQuantity receivedQuantity
    origin { name address { address1 address2 city provinceCode zip } location { id } }
    destination { name address { address1 address2 city provinceCode zip } location { id } }
    lineItems(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        title totalQuantity shippedQuantity
        inventoryItem {
          sku
          unitCost { amount }
          variants(first: 1) { nodes { price displayName selectedOptions { value } } }
        }
      }
    }
  }
}`;

const QUERY_ORIGEM = `
query OrigemTransferencia($id: ID!) {
  inventoryTransfer(id: $id) { id name origin { name location { id } } destination { name location { id } } }
}`;

/** Teto de páginas por consulta — 4 x 250 = 1000 transferências. */
const MAX_PAGINAS = 4;

/**
 * Busca do Shopify: rascunhos de fora e, se houver `periodo` (início
 * inclusivo e fim exclusivo, ISO em UTC — ver intervaloDoDia), só as criadas
 * nele.
 */
function montarBusca({ periodo = null }) {
  const termos = ['-status:draft'];
  if (periodo) termos.push(`created_at:>=${periodo.inicio}`, `created_at:<${periodo.fim}`);
  return termos.join(' AND ');
}

/**
 * Lista de transferências para a tela /transferencias, mais recentes primeiro.
 * `aoReceberPagina(nodes)` é chamado a cada página lida — a rota usa para já
 * consultar o Supabase enquanto a próxima página ainda vem do Shopify.
 */
export async function listarTransferencias(filtros = {}, { aoReceberPagina } = {}) {
  const query = montarBusca(filtros);
  const transferencias = [];
  let after = null;
  let paginas = 0;
  let truncado = false;

  while (true) {
    const dados = await shopifyGraphQL(QUERY_TRANSFERENCIAS, { first: 250, after, query });
    const conexao = dados.inventoryTransfers;
    const nodes = conexao?.nodes ?? [];
    transferencias.push(...nodes);
    aoReceberPagina?.(nodes);
    paginas += 1;
    if (!conexao?.pageInfo?.hasNextPage) break;
    if (paginas >= MAX_PAGINAS) {
      truncado = true;
      break;
    }
    after = conexao.pageInfo.endCursor;
  }

  // O filtro `-status:draft` do Shopify é a primeira barreira; esta é a
  // garantia, caso a busca ignore o termo.
  return { transferencias: transferencias.filter((t) => t.status !== 'DRAFT'), truncado };
}

/** Locais (lojas) do Shopify — só o ping do /api/saude usa. */
async function listarLocais() {
  const dados = await shopifyGraphQL(QUERY_LOCAIS, {});
  return dados.locations?.nodes ?? [];
}

/** Transferência completa, com TODOS os itens (pagina `lineItems` até o fim). */
export async function obterTransferenciaCompleta(id) {
  const gid = paraGidTransferencia(id);
  const itens = [];
  let cursor = null;
  let transferencia = null;
  let temProximaPagina = true;

  while (temProximaPagina) {
    const dados = await shopifyGraphQL(QUERY_TRANSFERENCIA_COMPLETA, { id: gid, cursor });
    if (!dados.inventoryTransfer) throw new Error(`Transferência ${gid} não encontrada no Shopify.`);
    transferencia = dados.inventoryTransfer;
    itens.push(...transferencia.lineItems.nodes);
    temProximaPagina = transferencia.lineItems.pageInfo.hasNextPage;
    cursor = transferencia.lineItems.pageInfo.endCursor;
  }

  return { ...transferencia, lineItems: itens };
}

/**
 * Tamanho/cor de cada SKU da transferência, para a troca de produto pai no
 * Tiny (ver trocarProdutosPai em tiny.js).
 */
export function opcoesPorSkuDaTransferencia(transferencia) {
  const mapa = {};
  for (const linha of transferencia?.lineItems ?? []) {
    const sku = linha.inventoryItem?.sku;
    if (!sku) continue;
    mapa[sku] = (linha.inventoryItem.variants?.nodes?.[0]?.selectedOptions ?? [])
      .map((o) => o.value)
      .filter((v) => v && v !== 'Default Title');
  }
  return mapa;
}

/** Só a loja de origem da transferência — sem ler os itens. */
export async function obterOrigemTransferencia(id) {
  return (await obterLojasTransferencia(id)).origem;
}

/** Origem e destino da transferência — { origem, destino }, cada um { name, location } ou null. */
export async function obterLojasTransferencia(id) {
  const gid = paraGidTransferencia(id);
  const dados = await shopifyGraphQL(QUERY_ORIGEM, { id: gid });
  if (!dados.inventoryTransfer) throw new Error(`Transferência ${gid} não encontrada no Shopify.`);
  return { origem: dados.inventoryTransfer.origin ?? null, destino: dados.inventoryTransfer.destination ?? null };
}

/** Ping usado pelo /api/saude. */
export async function verificarShopifyTransferencias() {
  const locais = await listarLocais();
  return {
    servico: 'Shopify (transferências)',
    ok: true,
    detalhe: `Acesso às transferências OK. ${locais.length} local(is) encontrado(s).`,
  };
}
