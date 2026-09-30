// shopifyTransferencias.js — transferências de estoque entre lojas (Admin
// GraphQL API, `inventoryTransfers`).
//
// Usa o mesmo token da Admin API dos pedidos (SHOPIFY_API_TOKEN), que precisa
// ter também os escopos read_inventory_transfers, read_locations,
// read_inventory e read_products.

import { idNumerico } from '../utils.js';
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
          variants(first: 1) { nodes { price barcode displayName } }
        }
      }
    }
  }
}`;

const QUERY_ORIGEM = `
query OrigemTransferencia($id: ID!) {
  inventoryTransfer(id: $id) { id name origin { name location { id } } }
}`;

/** Teto de páginas por consulta — 4 x 250 = 1000 transferências. */
const MAX_PAGINAS = 4;

/**
 * Monta a busca do Shopify a partir dos filtros da tela. O que o Shopify sabe
 * filtrar vai para cá; "excluir loja", nº da NF e "só não emitidas" dependem
 * do Supabase e ficam para a rota.
 */
function montarBusca({ origemId, destinoId, dataInicial, dataFinal, mostrarRascunhos }) {
  const termos = [];
  if (origemId) termos.push(`origin_id:${idNumerico(origemId)}`);
  if (destinoId) termos.push(`destination_id:${idNumerico(destinoId)}`);
  if (dataInicial) termos.push(`created_at:>=${dataInicial}`);
  // `<=` com só a data corta o dia no meio-dia UTC; "menor que o dia seguinte" pega o dia inteiro.
  if (dataFinal) {
    const seguinte = new Date(`${dataFinal}T00:00:00Z`);
    seguinte.setUTCDate(seguinte.getUTCDate() + 1);
    termos.push(`created_at:<${seguinte.toISOString().slice(0, 10)}`);
  }
  if (!mostrarRascunhos) termos.push('-status:draft');
  return termos.join(' AND ') || null;
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
  const lista = filtros.mostrarRascunhos ? transferencias : transferencias.filter((t) => t.status !== 'DRAFT');

  return { transferencias: lista, truncado };
}

// Lojas quase nunca mudam, e a lista era pedida ao Shopify a cada carga da
// tela — na abertura, antes das transferências (para achar o CD pelo nome).
// Fica guardada em memória por alguns minutos.
const LOCAIS_VALIDOS_MS = 10 * 60 * 1000;
let locaisEmCache = null;

/** Locais (lojas) do Shopify, para os filtros de origem/destino/exclusão. */
export async function listarLocais({ ignorarCache = false } = {}) {
  if (!ignorarCache && locaisEmCache && Date.now() - locaisEmCache.em < LOCAIS_VALIDOS_MS) {
    return locaisEmCache.promessa;
  }
  const promessa = shopifyGraphQL(QUERY_LOCAIS, {}).then((dados) =>
    (dados.locations?.nodes ?? []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  );
  locaisEmCache = { em: Date.now(), promessa };
  // Falha não fica guardada: a próxima carga tenta de novo.
  promessa.catch(() => {
    if (locaisEmCache?.promessa === promessa) locaisEmCache = null;
  });
  return promessa;
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

/** Só a loja de origem da transferência — sem ler os itens. */
export async function obterOrigemTransferencia(id) {
  const gid = paraGidTransferencia(id);
  const dados = await shopifyGraphQL(QUERY_ORIGEM, { id: gid });
  if (!dados.inventoryTransfer) throw new Error(`Transferência ${gid} não encontrada no Shopify.`);
  return dados.inventoryTransfer.origin ?? null;
}

/** Ping usado pelo /api/saude. */
export async function verificarShopifyTransferencias() {
  const locais = await listarLocais({ ignorarCache: true });
  return {
    servico: 'Shopify (transferências)',
    ok: true,
    detalhe: `Acesso às transferências OK. ${locais.length} local(is) encontrado(s).`,
  };
}
