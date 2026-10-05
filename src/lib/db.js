// db.js — histórico no Supabase.
//
// Regra de ouro deste arquivo: falha de persistência não pode derrubar o fluxo
// fiscal nem, pior, esconder que uma nota foi criada no Tiny. Por isso as
// funções devolvem { ok, erro } em vez de lançar exceção.

import { createClient } from '@supabase/supabase-js';
import { somenteDigitos } from './utils.js';

let cliente = null;

/** Cria o cliente sob demanda. Devolve null se o Supabase não estiver configurado. */
function obterCliente() {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) return null;

  // A service role key só pode ser usada no servidor (API Routes) — ela ignora
  // as políticas de RLS.
  cliente = createClient(url, chave, {
    auth: { persistSession: false },
    // O Next.js "sequestra" o fetch global e cacheia GETs por padrão — sem
    // isso, uma consulta feita cedo (ex.: lista ainda vazia) fica presa no
    // cache e nunca reflete escritas seguintes, mesmo com dynamic='force-dynamic'.
    global: { fetch: (url, options) => fetch(url, { ...options, cache: 'no-store' }) },
  });
  return cliente;
}

const SEM_CONFIG = {
  ok: false,
  erro: 'Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes).',
};

/** Grava (ou atualiza) o pedido no status "preview". */
export async function registrarPreview({ orderId, orderName, classificacao, payload }) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { data, error } = await db
    .from('notas_processadas')
    .upsert(
      {
        shopify_order_id: orderId,
        shopify_order_name: orderName,
        classificacao,
        status: 'preview',
        payload_enviado: payload ?? null,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'shopify_order_id' }
    )
    .select()
    .single();

  return error ? { ok: false, erro: error.message } : { ok: true, registro: data };
}

/**
 * Marca o pedido como rascunho criado e guarda a resposta do Tiny.
 * `notasSubstituidas`, quando informado, grava a lista de tiny_nota_id de
 * rascunhos antigos que este novo rascunho substitui (ver editarRascunho em
 * app/api/pedidos/[id]/rascunho/route.js) — omitido, a coluna não é tocada.
 * `reiniciarEmissao` zera nota_emitida e numero_nf: usado quando o novo
 * rascunho substitui uma nota já emitida (reemissão de transferência).
 */
export async function registrarRascunhoCriado({
  orderId,
  orderName,
  classificacao,
  payload,
  tinyNotaId,
  respostaTiny,
  notasSubstituidas,
  reiniciarEmissao = false,
}) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const registro = {
    shopify_order_id: orderId,
    shopify_order_name: orderName,
    classificacao,
    status: 'rascunho_criado',
    tiny_nota_id: tinyNotaId,
    payload_enviado: payload ?? null,
    resposta_tiny: respostaTiny ?? null,
    erro: null,
    atualizado_em: new Date().toISOString(),
    ...(notasSubstituidas ? { tiny_notas_substituidas: notasSubstituidas } : {}),
    ...(reiniciarEmissao ? { nota_emitida: false, numero_nf: null } : {}),
  };

  const { data, error } = await db
    .from('notas_processadas')
    .upsert(registro, { onConflict: 'shopify_order_id' })
    .select()
    .single();

  return error ? { ok: false, erro: error.message } : { ok: true, registro: data };
}

/** Busca o rascunho já criado deste pedido — usado pela tela de edição, que
 *  precisa do payload realmente enviado ao Tiny (não do pedido recalculado a
 *  partir do Shopify). Devolve rascunho: null quando o pedido ainda não tem
 *  rascunho criado. */
export async function obterRascunhoCriado(orderId) {
  const db = obterCliente();
  if (!db) return { ok: false, erro: SEM_CONFIG.erro, rascunho: null };

  const { data, error } = await db
    .from('notas_processadas')
    .select(
      'shopify_order_name, classificacao, status, tiny_nota_id, nota_emitida, payload_enviado, tiny_notas_substituidas'
    )
    .eq('shopify_order_id', orderId)
    .maybeSingle();

  if (error) return { ok: false, erro: error.message, rascunho: null };
  if (!data || data.status !== 'rascunho_criado') return { ok: true, rascunho: null };
  return { ok: true, rascunho: data };
}

/** Guarda o erro para o pedido aparecer na lista como "erro". */
export async function registrarErro({ orderId, orderName, classificacao, payload, mensagem }) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { error } = await db.from('notas_processadas').upsert(
    {
      shopify_order_id: orderId,
      shopify_order_name: orderName,
      classificacao: classificacao ?? 'outro',
      status: 'erro',
      payload_enviado: payload ?? null,
      erro: String(mensagem ?? '').slice(0, 2000),
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'shopify_order_id' }
  );

  return error ? { ok: false, erro: error.message } : { ok: true };
}

/**
 * Trava contra nota duplicada. Só considera processado quando o rascunho
 * realmente foi criado — um preview antigo não bloqueia nova tentativa.
 */
export async function jaProcessado(orderId) {
  const db = obterCliente();
  if (!db) return { processado: false, ...SEM_CONFIG };

  const { data, error } = await db
    .from('notas_processadas')
    .select('status, tiny_nota_id, nota_emitida')
    .eq('shopify_order_id', orderId)
    .maybeSingle();

  if (error) return { processado: false, ok: false, erro: error.message };
  return {
    ok: true,
    processado: data?.status === 'rascunho_criado',
    tinyNotaId: data?.tiny_nota_id ?? null,
    notaEmitida: Boolean(data?.nota_emitida),
    status: data?.status ?? null,
  };
}

/** Atualiza só a flag de emissão fiscal, sem mexer no restante do registro. */
export async function atualizarNotaEmitida(orderId, emitida) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { error } = await db
    .from('notas_processadas')
    .update({ nota_emitida: emitida, atualizado_em: new Date().toISOString() })
    .eq('shopify_order_id', orderId);

  return error ? { ok: false, erro: error.message } : { ok: true };
}

/** Registra os SKUs que precisam de cadastro ou correção no Tiny. */
export async function salvarItensPendentes(orderName, pendencias) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;
  if (!pendencias?.length) return { ok: true, gravados: 0 };

  const linhas = pendencias.map((p) => ({
    shopify_order_name: orderName,
    sku: p.sku,
    quantidade: p.quantidade ?? 0,
    motivo: p.motivo, // nao_encontrado | multiplos_cadastros
  }));

  const { error } = await db.from('itens_pendentes').insert(linhas);
  return error ? { ok: false, erro: error.message } : { ok: true, gravados: linhas.length };
}

// Os ids vão na URL do GET (`.in(...)`): centenas de gids de uma vez estouram
// o limite de tamanho e a consulta inteira falha.
const IDS_POR_CONSULTA = 100;

/**
 * Mapa orderId -> status, usado pela lista de pedidos e pela de transferências.
 * Lança erro se o Supabase falhar: devolver {} faria tudo parecer "não
 * processado" — a lista mentiria e a trava contra duplicidade não valeria.
 */
export async function statusPorPedido(orderIds) {
  const db = obterCliente();
  if (!db) return {};

  // Os lotes vão em paralelo: um atrás do outro, 1000 transferências eram 10
  // idas e voltas ao Supabase antes de a lista aparecer.
  const lotes = [];
  for (let i = 0; i < orderIds.length; i += IDS_POR_CONSULTA) lotes.push(orderIds.slice(i, i + IDS_POR_CONSULTA));
  const respostas = await Promise.all(
    lotes.map((ids) =>
      db
        .from('notas_processadas')
        .select('shopify_order_id, status, tiny_nota_id, nota_emitida, numero_nf, tiny_notas_substituidas')
        .in('shopify_order_id', ids)
    )
  );
  const linhas = respostas.flatMap(({ data, error }) => {
    if (error) throw new Error(`Falha ao ler a situação fiscal no Supabase: ${error.message}`);
    return data ?? [];
  });
  return Object.fromEntries(linhas.map((r) => [r.shopify_order_id, r]));
}

/**
 * Nºs dos pedidos (ex.: "#1024") cujas notas têm um destes nºs de NF ou um
 * destes CNPJs de cliente — para a busca da tela de atacado, já que nenhum
 * dos dois é pesquisável no Shopify. O CNPJ só acha pedido que já tem nota.
 */
export async function pedidosPorNfOuCnpj({ numerosNf = [], cnpjs = [] }) {
  const db = obterCliente();
  if (!db || (numerosNf.length === 0 && cnpjs.length === 0)) return [];

  const condicoes = [
    ...(numerosNf.length ? [`numero_nf.in.(${numerosNf.join(',')})`] : []),
    ...cnpjs.map((c) => `payload_enviado->nota_fiscal->cliente->>cpf_cnpj.eq.${c}`),
  ];
  const { data, error } = await db
    .from('notas_processadas')
    .select('shopify_order_name')
    .or(condicoes.join(','))
    .neq('classificacao', 'transferencia');

  if (error) {
    console.error('[db] Falha ao buscar pedidos por nº da NF ou CNPJ:', error.message);
    return [];
  }
  return [...new Set((data ?? []).map((r) => r.shopify_order_name).filter(Boolean))];
}

/** CNPJs (só dígitos) dos clientes franqueados, para a classificação decidir
 *  atacado x franquia. `ok: false` quando o Supabase não está configurado ou
 *  a consulta falha — quem chama decide o que fazer (ver classificacao.js). */
export async function listarCnpjsFranquia() {
  const db = obterCliente();
  if (!db) return { ok: false, erro: SEM_CONFIG.erro, cnpjs: [] };

  const { data, error } = await db.from('cnpjs_franquia').select('cnpj').eq('ativo', true);

  if (error) return { ok: false, erro: error.message, cnpjs: [] };
  // O cadastro no Supabase deveria ser só dígitos (ver schema.sql), mas quem
  // insere manualmente às vezes cola o CNPJ com máscara — normalizamos aqui
  // para não depender disso, já que a comparação em classificacao.js usa
  // somenteDigitos() no CNPJ extraído do pedido.
  return { ok: true, cnpjs: (data ?? []).map((r) => somenteDigitos(r.cnpj)) };
}

/** Markup cadastrado para a franquia deste CNPJ (coluna `markup` de
 *  cnpjs_franquia). `markup: null` quando a franquia não tem markup próprio,
 *  não está cadastrada ou a consulta falha — quem chama usa o padrão. */
export async function markupDaFranquia(cnpj) {
  const db = obterCliente();
  if (!db) return { ok: false, erro: SEM_CONFIG.erro, markup: null };

  // Mesmo motivo de listarCnpjsFranquia: o cadastro pode ter vindo com
  // máscara, então a comparação é feita em dígitos, do lado de cá.
  const { data, error } = await db.from('cnpjs_franquia').select('cnpj, markup').eq('ativo', true);
  if (error) return { ok: false, erro: error.message, markup: null };

  const linha = (data ?? []).find((r) => somenteDigitos(r.cnpj) === somenteDigitos(cnpj));
  const markup = linha?.markup == null ? null : Number(linha.markup);
  return { ok: true, markup: Number.isFinite(markup) ? markup : null };
}

/** Ping usado pelo /api/saude. */
export async function verificarSupabase() {
  const db = obterCliente();
  if (!db) return { servico: 'Supabase', ok: false, detalhe: SEM_CONFIG.erro };

  const { error } = await db.from('notas_processadas').select('id').limit(1);
  if (error) {
    return {
      servico: 'Supabase',
      ok: false,
      detalhe: `${error.message}. Rode supabase/schema.sql no SQL Editor se as tabelas ainda não existem.`,
    };
  }
  return { servico: 'Supabase', ok: true, detalhe: 'Conectado e tabelas acessíveis.' };
}

/**
 * Marca a nota como emitida e grava o número da NF que o Tiny devolveu para a
 * nota autorizada. Só atualiza: a linha já existe desde a criação do
 * rascunho, e nome, status e payload ficam como estão.
 */
export async function registrarNumeroNf({ orderId, numeroNf }) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { error } = await db
    .from('notas_processadas')
    .update({ nota_emitida: true, numero_nf: String(numeroNf), atualizado_em: new Date().toISOString() })
    .eq('shopify_order_id', orderId);

  return error ? { ok: false, erro: error.message } : { ok: true };
}

/** Cadastro fiscal das lojas, indexado pelo gid do local no Shopify. */
export async function lojasFiscaisPorLocal(locationIds) {
  const db = obterCliente();
  if (!db) return { ok: false, erro: SEM_CONFIG.erro, lojas: {} };

  const ids = locationIds.filter(Boolean);
  if (!ids.length) return { ok: true, lojas: {} };

  const { data, error } = await db.from('lojas_fiscais').select('*').in('shopify_location_id', ids);
  if (error) return { ok: false, erro: error.message, lojas: {} };
  return { ok: true, lojas: Object.fromEntries((data ?? []).map((l) => [l.shopify_location_id, l])) };
}

// ---------------------------------------------------------------------------
// Transportadoras do atacado (tela /pedidos/transportadoras). Cliente com o
// CNPJ anexado a uma transportadora ativa tem a nota com o transporte dela em
// vez dos Correios — ver transporte.js e a rota do preview.
// ---------------------------------------------------------------------------

const CAMPOS_TRANSPORTADORA = ['nome', 'cnpj', 'ie', 'forma_frete', 'endereco', 'cidade', 'uf', 'ativo'];

/** Só os campos editáveis, já normalizados (CNPJ em dígitos, texto aparado,
 *  vazio vira null). Quem valida o conteúdo é a rota. */
function linhaTransportadora(dados) {
  const linha = {};
  for (const campo of CAMPOS_TRANSPORTADORA) {
    if (!(campo in (dados ?? {}))) continue;
    const valor = dados[campo];
    if (campo === 'ativo') linha.ativo = valor !== false;
    else if (campo === 'cnpj') linha.cnpj = somenteDigitos(valor) || null;
    else if (campo === 'uf') linha.uf = String(valor ?? '').trim().toUpperCase() || null;
    else linha[campo] = String(valor ?? '').trim() || null;
  }
  return linha;
}

/** Mensagem legível para as violações de unicidade do Postgres. */
function erroDeGravacao(error, duplicado) {
  return error.code === '23505' ? duplicado : error.message;
}

/** Todas as transportadoras, com quantos clientes cada uma tem anexados. */
export async function listarTransportadoras() {
  const db = obterCliente();
  if (!db) return { ok: false, erro: SEM_CONFIG.erro, transportadoras: [] };

  const { data, error } = await db
    .from('transportadoras')
    .select('*, clientes:clientes_transportadora(count)')
    .order('nome', { ascending: true });

  if (error) return { ok: false, erro: error.message, transportadoras: [] };
  return {
    ok: true,
    transportadoras: (data ?? []).map(({ clientes, ...t }) => ({ ...t, totalClientes: clientes?.[0]?.count ?? 0 })),
  };
}

export async function criarTransportadora(dados) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { data, error } = await db.from('transportadoras').insert(linhaTransportadora(dados)).select().single();
  if (error) return { ok: false, erro: erroDeGravacao(error, 'Já existe uma transportadora com este CNPJ.') };
  return { ok: true, transportadora: data };
}

export async function atualizarTransportadora(id, dados) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { data, error } = await db
    .from('transportadoras')
    .update({ ...linhaTransportadora(dados), atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) return { ok: false, erro: erroDeGravacao(error, 'Já existe outra transportadora com este CNPJ.') };
  if (!data) return { ok: false, erro: 'Transportadora não encontrada.', naoEncontrada: true };
  return { ok: true, transportadora: data };
}

/** Clientes anexados a uma transportadora, por ordem de anexo. */
export async function listarClientesDaTransportadora(transportadoraId) {
  const db = obterCliente();
  if (!db) return { ok: false, erro: SEM_CONFIG.erro, clientes: [] };

  const { data, error } = await db
    .from('clientes_transportadora')
    .select('cnpj, nome, criado_em')
    .eq('transportadora_id', transportadoraId)
    .order('criado_em', { ascending: true });

  if (error) return { ok: false, erro: error.message, clientes: [] };
  return { ok: true, clientes: data ?? [] };
}

/**
 * Anexa o CNPJ à transportadora. O CNPJ é a chave: cada cliente tem uma
 * transportadora só. Se ele já estiver em outra, nada é gravado e volta
 * `emOutra` com ela — a pessoa decide na tela, e só com `mover: true` o anexo
 * troca de transportadora.
 */
export async function anexarClienteTransportadora({ transportadoraId, cnpj, nome, mover = false }) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const chave = somenteDigitos(cnpj);
  const { data: atual, error: erroLeitura } = await db
    .from('clientes_transportadora')
    .select('transportadora_id, transportadora:transportadoras(id, nome)')
    .eq('cnpj', chave)
    .maybeSingle();
  if (erroLeitura) return { ok: false, erro: erroLeitura.message };

  if (atual && String(atual.transportadora_id) === String(transportadoraId)) {
    return { ok: false, erro: 'Este CNPJ já está anexado a esta transportadora.', jaAnexado: true };
  }
  if (atual && !mover) {
    return {
      ok: false,
      erro: `Este CNPJ já está anexado à transportadora ${atual.transportadora?.nome ?? atual.transportadora_id}.`,
      emOutra: atual.transportadora ?? { id: atual.transportadora_id },
    };
  }

  const { data, error } = await db
    .from('clientes_transportadora')
    .upsert(
      {
        cnpj: chave,
        nome: String(nome ?? '').trim() || null,
        transportadora_id: transportadoraId,
        criado_em: new Date().toISOString(),
      },
      { onConflict: 'cnpj' }
    )
    .select('cnpj, nome, criado_em')
    .single();
  if (error) {
    // 23503 = a transportadora não existe (chave estrangeira).
    return { ok: false, erro: error.code === '23503' ? 'Transportadora não encontrada.' : error.message };
  }
  return { ok: true, cliente: data, movido: !!atual };
}

export async function desanexarClienteTransportadora({ transportadoraId, cnpj }) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { error } = await db
    .from('clientes_transportadora')
    .delete()
    .eq('cnpj', somenteDigitos(cnpj))
    .eq('transportadora_id', transportadoraId);
  return error ? { ok: false, erro: error.message } : { ok: true };
}

/** Transportadora anexada ao CNPJ do cliente, ou `transportadora: null` se não
 *  há anexo. Volta também quando ela está inativa — quem chama decide. */
export async function transportadoraDoCliente(cnpj) {
  const db = obterCliente();
  if (!db) return { ok: false, erro: SEM_CONFIG.erro, transportadora: null };

  const chave = somenteDigitos(cnpj);
  if (!chave) return { ok: true, transportadora: null };

  const { data, error } = await db
    .from('clientes_transportadora')
    .select('transportadora:transportadoras(*)')
    .eq('cnpj', chave)
    .maybeSingle();
  if (error) return { ok: false, erro: error.message, transportadora: null };
  return { ok: true, transportadora: data?.transportadora ?? null };
}
