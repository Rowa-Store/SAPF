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

// A resposta de erro do Tiny pode listar vários campos; 2000 cortava no meio.
const TAMANHO_MAXIMO_ERRO = 10000;

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
      erro: String(mensagem ?? '').slice(0, TAMANHO_MAXIMO_ERRO),
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'shopify_order_id' }
  );

  return error ? { ok: false, erro: error.message } : { ok: true };
}

/**
 * Guarda o erro de uma operação que falhou sem mudar o status — ex.: a
 * emissão de um rascunho que continua emitível. É o que o botão "Ver erro" da
 * linha mostra depois. Não cria registro: sem linha no Supabase, não grava.
 */
export async function anotarErro(orderId, mensagem) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { error } = await db
    .from('notas_processadas')
    .update({ erro: String(mensagem ?? '').slice(0, TAMANHO_MAXIMO_ERRO), atualizado_em: new Date().toISOString() })
    .eq('shopify_order_id', orderId);
  if (error) console.error(`[db] Falha ao guardar o erro de ${orderId}:`, error.message);
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
    // Emitiu: o erro de uma tentativa anterior não vale mais.
    .update({ nota_emitida: emitida, ...(emitida ? { erro: null } : {}), atualizado_em: new Date().toISOString() })
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
        .select(
          'shopify_order_id, status, tiny_nota_id, nota_emitida, numero_nf, tiny_notas_substituidas, erro, atualizado_em, ' +
            // Só as parcelas do payload, não ele inteiro: a tela de boletos
            // compara quantas são com os títulos achados na CAIXA.
            'parcelas:payload_enviado->nota_fiscal->parcelas'
        )
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

// Cadastro dos clientes franqueados (tela /pedidos/clientes). Era
// cnpjs_franquia — ver supabase/client-exce.sql.
const TABELA_FRANQUIAS = 'client_exce';

/** CNPJs (só dígitos) dos clientes franqueados, para a classificação decidir
 *  atacado x franquia. `ok: false` quando o Supabase não está configurado ou
 *  a consulta falha — quem chama decide o que fazer (ver classificacao.js). */
export async function listarCnpjsFranquia() {
  const db = obterCliente();
  if (!db) return { ok: false, erro: SEM_CONFIG.erro, cnpjs: [] };

  const { data, error } = await db.from(TABELA_FRANQUIAS).select('cnpj').eq('ativo', true);

  if (error) return { ok: false, erro: error.message, cnpjs: [] };
  // O cadastro no Supabase deveria ser só dígitos (ver schema.sql), mas quem
  // insere manualmente às vezes cola o CNPJ com máscara — normalizamos aqui
  // para não depender disso, já que a comparação em classificacao.js usa
  // somenteDigitos() no CNPJ extraído do pedido.
  return { ok: true, cnpjs: (data ?? []).map((r) => somenteDigitos(r.cnpj)) };
}

/** Markup cadastrado para a franquia deste CNPJ (coluna `markup` de
 *  client_exce). `markup: null` quando a franquia não tem markup próprio,
 *  não está cadastrada ou a consulta falha — quem chama usa o padrão. */
export async function markupDaFranquia(cnpj) {
  const db = obterCliente();
  if (!db) return { ok: false, erro: SEM_CONFIG.erro, markup: null };

  // Mesmo motivo de listarCnpjsFranquia: o cadastro pode ter vindo com
  // máscara, então a comparação é feita em dígitos, do lado de cá.
  const { data, error } = await db.from(TABELA_FRANQUIAS).select('cnpj, markup').eq('ativo', true);
  if (error) return { ok: false, erro: error.message, markup: null };

  const linha = (data ?? []).find((r) => somenteDigitos(r.cnpj) === somenteDigitos(cnpj));
  const markup = linha?.markup == null ? null : Number(linha.markup);
  return { ok: true, markup: Number.isFinite(markup) ? markup : null };
}

const CAMPOS_FRANQUIA = [
  'apelido',
  'razao_social',
  'contato',
  'email',
  'telefone',
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
  'observacoes',
  'markup',
  'ativo',
];

/** Só os campos editáveis que vieram, já normalizados (texto aparado, vazio
 *  vira null). Quem valida o conteúdo é a rota. */
function linhaFranquia(dados) {
  const linha = {};
  for (const campo of CAMPOS_FRANQUIA) {
    if (!(campo in (dados ?? {}))) continue;
    const valor = dados[campo];
    if (campo === 'ativo') linha.ativo = valor !== false;
    else if (campo === 'markup') linha.markup = valor ?? null;
    else if (campo === 'cep') linha.cep = somenteDigitos(valor) || null;
    else if (campo === 'uf') linha.uf = String(valor ?? '').trim().toUpperCase() || null;
    else linha[campo] = String(valor ?? '').trim() || null;
  }
  return linha;
}

/**
 * Todos os clientes franqueados, ativos ou não, por nome — cada um com a
 * transportadora anexada (`transportadora: { id, nome, ativo } | null`) e a
 * IE gravada em clientes_ie (`ie: string | null`). O casamento é feito em
 * dígitos, do lado de cá: o CNPJ de client_exce pode ter vindo com máscara.
 */
export async function listarFranquias() {
  const db = obterCliente();
  if (!db) return { ok: false, erro: SEM_CONFIG.erro, franquias: [] };

  const { data, error } = await db
    .from(TABELA_FRANQUIAS)
    .select('*')
    .order('apelido', { ascending: true, nullsFirst: false });
  if (error) return { ok: false, erro: error.message, franquias: [] };

  const chaves = [...new Set((data ?? []).map((f) => somenteDigitos(f.cnpj)).filter(Boolean))];
  const [anexos, ies] = chaves.length
    ? await Promise.all([
        db.from('clientes_transportadora').select('cnpj, transportadora:transportadoras(id, nome, ativo)').in('cnpj', chaves),
        db.from('clientes_ie').select('cnpj, ie').in('cnpj', chaves),
      ])
    : [{ data: [] }, { data: [] }];
  const erroExtra = anexos.error ?? ies.error;
  if (erroExtra) return { ok: false, erro: erroExtra.message, franquias: [] };

  const transportadoraPorCnpj = new Map((anexos.data ?? []).map((a) => [a.cnpj, a.transportadora ?? null]));
  const iePorCnpj = new Map((ies.data ?? []).map((i) => [i.cnpj, i.ie || null]));
  return {
    ok: true,
    franquias: (data ?? []).map((f) => {
      const chave = somenteDigitos(f.cnpj);
      return { ...f, transportadora: transportadoraPorCnpj.get(chave) ?? null, ie: iePorCnpj.get(chave) ?? null };
    }),
  };
}

/** Inclui o cliente na lista de franquias. Quem valida o conteúdo é a rota. */
export async function criarFranquia({ cnpj, ...dados }) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { data, error } = await db
    .from(TABELA_FRANQUIAS)
    .insert({ ...linhaFranquia(dados), cnpj: somenteDigitos(cnpj) })
    .select()
    .single();
  if (error) return { ok: false, erro: erroDeGravacao(error, 'Este CNPJ já está cadastrado como franquia.') };
  return { ok: true, franquia: data };
}

/** Edita o cadastro. `cnpj` é a chave exatamente como está gravada (pode ter
 *  máscara); ele não muda. Os campos que não vierem ficam como estão. */
export async function atualizarFranquia(cnpj, dados) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { data, error } = await db
    .from(TABELA_FRANQUIAS)
    .update({ ...linhaFranquia(dados), atualizado_em: new Date().toISOString() })
    .eq('cnpj', cnpj)
    .select()
    .maybeSingle();
  if (error) return { ok: false, erro: error.message };
  if (!data) return { ok: false, erro: 'Cliente não encontrado.', naoEncontrada: true };
  return { ok: true, franquia: data };
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

// ---------------------------------------------------------------------------
// Inscrição estadual dos clientes — cache da consulta ao SintegrAPI
// (ver src/lib/fiscal/inscricaoEstadual.js).
// ---------------------------------------------------------------------------

/** IE gravada para este CNPJ, ou `ie: null` quando não há. */
export async function ieDoCliente(cnpj) {
  const db = obterCliente();
  if (!db) return { ok: false, erro: SEM_CONFIG.erro, ie: null };

  const chave = somenteDigitos(cnpj);
  if (!chave) return { ok: true, ie: null };

  const { data, error } = await db.from('clientes_ie').select('ie, uf').eq('cnpj', chave).maybeSingle();
  if (error) return { ok: false, erro: error.message, ie: null };
  return { ok: true, ie: data?.ie || null, uf: data?.uf ?? null };
}

/** Grava (ou atualiza) a IE do CNPJ. */
export async function gravarIeDoCliente({ cnpj, ie, uf, origem }) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { error } = await db.from('clientes_ie').upsert(
    {
      cnpj: somenteDigitos(cnpj),
      ie: somenteDigitos(ie),
      uf: uf || null,
      origem,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'cnpj' }
  );
  return error ? { ok: false, erro: error.message } : { ok: true };
}

/** Apaga a IE gravada do CNPJ — o próximo pedido volta a consultar o SintegrAPI. */
export async function removerIeDoCliente(cnpj) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { error } = await db.from('clientes_ie').delete().eq('cnpj', somenteDigitos(cnpj));
  return error ? { ok: false, erro: error.message } : { ok: true };
}

// ---------------------------------------------------------------------------
// Boletos (tela /boletos): status emitido/pendente marcado à mão, o nº da NF
// quando corrigido na tela e, se o pedido acabou pago com cartão ou PIX, a
// forma (pago_com). Sem linha, o boleto está pendente e o nº é o da nota em
// notas_processadas.
// ---------------------------------------------------------------------------

const COLUNAS_BOLETO = 'shopify_order_id, emitido, numero_nf, pago_com';

/** Formas aceitas em boletos.pago_com (null = boleto). */
export const FORMAS_PAGO_COM = ['cartao', 'pix'];

/** [{ id, nome, tipo }] -> { pdfs, comprovantes }, sem o tipo. */
function separarArquivos(lista) {
  const separados = { pdfs: [], comprovantes: [] };
  for (const { id, nome, tipo } of lista) separados[tipo === 'comprovante' ? 'comprovantes' : 'pdfs'].push({ id, nome });
  return separados;
}

/** Mapa orderId -> { emitido, numero_nf, pago_com, pdfs, comprovantes }, os
 *  dois últimos [{ id, nome }] na ordem de envio. Lança erro se o Supabase
 *  falhar, pelo mesmo motivo de statusPorPedido: {} faria todo boleto parecer
 *  pendente. */
export async function boletosPorPedido(orderIds) {
  const db = obterCliente();
  if (!db || orderIds.length === 0) return {};

  const lotes = [];
  for (let i = 0; i < orderIds.length; i += IDS_POR_CONSULTA) lotes.push(orderIds.slice(i, i + IDS_POR_CONSULTA));
  const lerTudo = (respostas) =>
    respostas.flatMap(({ data, error }) => {
      if (error) throw new Error(`Falha ao ler os boletos no Supabase: ${error.message}`);
      return data ?? [];
    });
  const [linhas, pdfs] = await Promise.all([
    Promise.all(lotes.map((ids) => db.from('boletos').select(COLUNAS_BOLETO).in('shopify_order_id', ids))).then(lerTudo),
    Promise.all(
      lotes.map((ids) =>
        db
          .from('boletos_pdfs')
          .select('id, shopify_order_id, nome, tipo')
          .in('shopify_order_id', ids)
          .order('criado_em', { ascending: true })
      )
    ).then(lerTudo),
  ]);

  return Object.fromEntries(
    linhas.map((r) => [
      r.shopify_order_id,
      { ...r, ...separarArquivos(pdfs.filter((p) => p.shopify_order_id === r.shopify_order_id)) },
    ])
  );
}

/** Grava o status, o nº da NF e/ou a forma em que foi pago (`pagoCom`:
 *  'cartao', 'pix' ou null = boleto). Campo ausente fica como está;
 *  `numeroNf` vazio volta a valer o nº da nota no Tiny. */
export async function salvarBoleto({ orderId, orderName, emitido, numeroNf, pagoCom }) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const linha = {
    shopify_order_id: orderId,
    ...(orderName ? { shopify_order_name: orderName } : {}),
    ...(emitido !== undefined ? { emitido: !!emitido } : {}),
    ...(numeroNf !== undefined ? { numero_nf: String(numeroNf ?? '').trim() || null } : {}),
    ...(pagoCom !== undefined ? { pago_com: pagoCom || null } : {}),
    atualizado_em: new Date().toISOString(),
  };
  const { data, error } = await db
    .from('boletos')
    .upsert(linha, { onConflict: 'shopify_order_id' })
    .select(COLUNAS_BOLETO)
    .single();
  return error ? { ok: false, erro: error.message } : { ok: true, boleto: data };
}

// Arquivos do boleto: um pedido pode ter vários PDFs de boleto (um por
// parcela, por exemplo) e, se foi pago com cartão/PIX, os comprovantes (PDF
// ou imagem). Ficam no bucket privado BUCKET_BOLETOS do Supabase Storage, em
// <id numérico do pedido>/<uuid>.<extensão>, com uma linha em boletos_pdfs
// cada; `tipo` diz se é boleto ou comprovante.
const BUCKET_BOLETOS = 'boletos';

/** Sobe mais um arquivo do boleto. PDF de boleto marca o boleto como
 *  emitido; comprovante (`tipo: 'comprovante'`) não mexe no status. */
export async function salvarPdfBoleto({
  orderId,
  orderName,
  nome,
  bytes,
  tipo = 'boleto',
  contentType = 'application/pdf',
  extensao = 'pdf',
}) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const caminho = `${orderId.split('/').pop()}/${crypto.randomUUID()}.${extensao}`;
  const { error: erroUpload } = await db.storage.from(BUCKET_BOLETOS).upload(caminho, bytes, { contentType });
  if (erroUpload) return { ok: false, erro: `upload do arquivo: ${erroUpload.message}` };

  // A linha em boletos precisa existir (chave estrangeira de boletos_pdfs).
  const { data: boleto, error } = await db
    .from('boletos')
    .upsert(
      {
        shopify_order_id: orderId,
        ...(orderName ? { shopify_order_name: orderName } : {}),
        ...(tipo === 'boleto' ? { emitido: true } : {}),
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'shopify_order_id' }
    )
    .select(COLUNAS_BOLETO)
    .single();
  const { data: pdf, error: erroPdf } = error
    ? { data: null, error }
    : await db
        .from('boletos_pdfs')
        .insert({ shopify_order_id: orderId, nome, path: caminho, tipo })
        .select('id, nome')
        .single();
  if (erroPdf) {
    // Sem a linha o arquivo fica órfão no bucket: remove.
    await db.storage.from(BUCKET_BOLETOS).remove([caminho]);
    return { ok: false, erro: erroPdf.message };
  }
  return { ok: true, boleto, pdf };
}

/** Arquivos do boleto, na ordem de envio: { pdfs, comprovantes }, cada um
 *  [{ id, nome }]. */
export async function listarPdfsBoleto(orderId) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { data, error } = await db
    .from('boletos_pdfs')
    .select('id, nome, tipo')
    .eq('shopify_order_id', orderId)
    .order('criado_em', { ascending: true });
  return error ? { ok: false, erro: error.message } : { ok: true, ...separarArquivos(data ?? []) };
}

/** Link temporário (5 min) para abrir um arquivo do boleto (PDF ou
 *  comprovante) — `pdfId`, ou o primeiro PDF de boleto se ele faltar. */
export async function linkPdfBoleto(orderId, pdfId) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  let consulta = db.from('boletos_pdfs').select('path, nome').eq('shopify_order_id', orderId);
  if (!pdfId) consulta = consulta.eq('tipo', 'boleto');
  consulta = pdfId ? consulta.eq('id', pdfId) : consulta.order('criado_em', { ascending: true }).limit(1);
  const { data: linha, error } = await consulta.maybeSingle();
  if (error) return { ok: false, erro: error.message };
  if (!linha) return { ok: false, erro: pdfId ? 'PDF não encontrado neste boleto.' : 'Este boleto ainda não tem PDF.', semPdf: true };

  const { data, error: erroLink } = await db.storage.from(BUCKET_BOLETOS).createSignedUrl(linha.path, 300);
  return erroLink ? { ok: false, erro: erroLink.message } : { ok: true, url: data.signedUrl, nome: linha.nome };
}

/** Remove um arquivo do boleto (linha e arquivo). O status fica como está. */
export async function removerPdfBoleto(orderId, pdfId) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { data: linha, error } = await db
    .from('boletos_pdfs')
    .delete()
    .eq('shopify_order_id', orderId)
    .eq('id', pdfId)
    .select('path')
    .maybeSingle();
  if (error) return { ok: false, erro: error.message };
  if (!linha) return { ok: false, erro: 'PDF não encontrado neste boleto.', semPdf: true };

  const { error: erroStorage } = await db.storage.from(BUCKET_BOLETOS).remove([linha.path]);
  // A linha já saiu: o arquivo que sobrar no bucket não aparece em lugar nenhum.
  if (erroStorage) console.error(`[boletos] PDF ${linha.path} removido da lista, mas não do Storage:`, erroStorage.message);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Títulos da CAIXA (tabela boletos_caixa), por nº da NF. Ver
// supabase/boletos-caixa.sql e src/lib/caixa/.
// ---------------------------------------------------------------------------

const COLUNAS_TITULO = 'nosso_numero, nf_numero, parcela, valor, vencimento, situacao, data_liquidacao, pdf_path, origem';

/** Mapa nº da NF -> títulos da CAIXA, por parcela. Lança erro se o Supabase
 *  falhar, como boletosPorPedido: {} faria toda NF parecer sem boleto. */
export async function titulosCaixaPorNf(numerosNf) {
  const db = obterCliente();
  const nfs = [...new Set(numerosNf.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!db || nfs.length === 0) return {};

  const { data, error } = await db
    .from('boletos_caixa')
    .select(COLUNAS_TITULO)
    .in('nf_numero', nfs)
    .order('parcela', { ascending: true });
  if (error) throw new Error(`Falha ao ler os títulos da CAIXA no Supabase: ${error.message}`);

  const mapa = {};
  for (const t of data ?? []) (mapa[t.nf_numero] ??= []).push(t);
  return mapa;
}

/** Grava um título achado na CAIXA e, se vier, o PDF dele no Storage. */
export async function salvarTituloCaixa({ nossoNumero, nf, parcela, valor, vencimento, bytes, origem }) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  let pdfPath;
  if (bytes) {
    pdfPath = `caixa/${nossoNumero}.pdf`;
    const { error } = await db.storage
      .from(BUCKET_BOLETOS)
      .upload(pdfPath, bytes, { contentType: 'application/pdf', upsert: true });
    if (error) return { ok: false, erro: `upload do PDF: ${error.message}` };
  }

  const { data, error } = await db
    .from('boletos_caixa')
    .upsert(
      {
        nosso_numero: nossoNumero,
        nf_numero: nf,
        parcela,
        valor,
        vencimento,
        origem,
        ...(pdfPath ? { pdf_path: pdfPath } : {}),
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'nosso_numero' }
    )
    .select(COLUNAS_TITULO)
    .single();
  return error ? { ok: false, erro: error.message } : { ok: true, titulo: data };
}

/** Link temporário (5 min) da cópia do PDF guardada no Storage. `semPdf`
 *  quando o título não existe ou ainda não tem cópia. */
export async function linkPdfTituloCaixa(nossoNumero) {
  const db = obterCliente();
  if (!db) return SEM_CONFIG;

  const { data: linha, error } = await db
    .from('boletos_caixa')
    .select('pdf_path')
    .eq('nosso_numero', nossoNumero)
    .maybeSingle();
  if (error) return { ok: false, erro: error.message };
  if (!linha?.pdf_path) return { ok: false, erro: 'Título sem cópia do PDF.', semPdf: true };

  const { data, error: erroLink } = await db.storage.from(BUCKET_BOLETOS).createSignedUrl(linha.pdf_path, 300);
  return erroLink ? { ok: false, erro: erroLink.message } : { ok: true, url: data.signedUrl };
}
