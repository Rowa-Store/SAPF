'use client';

import { useEffect, useRef, useState } from 'react';
import { normalizarCodigo, normalizarNome } from '@/lib/olist/chaves';

// Varredura do diagnóstico, em três fases:
//
//   1. catálogo — lê o catálogo inteiro da Olist (produtos.pesquisa, 100 por
//      página). Com ele, a comparação de cada produto não pesquisa no Tiny
//      por nome nem por SKU: produto que não está na Olist sai sem nenhuma
//      chamada, e o cadastrado gasta só o produto.obter do pai. Se o Tiny não
//      deixar ler o catálogo, a comparação volta a pesquisar produto a produto.
//   2. shopify — lê o Shopify de 20 em 20, os mais recentes primeiro, e
//      compara cada um. Na varredura completa, todos os ativos; no
//      "atualizar", só os alterados no Shopify desde o último diagnóstico.
//   3. tiny — só no "atualizar": os produtos já conhecidos cujo cadastro na
//      Olist mudou desde o último diagnóstico (diferença entre o catálogo de
//      antes e o de agora: nome, código, preço, situação), mais os que deram
//      erro. NCM e peso não vêm no catálogo — mudança só deles na Olist fica
//      para a varredura completa.
//
// Um produto por requisição, com uma pausa entre eles; se o Tiny recusar por
// limite de chamadas (429), espera e tenta de novo. Dá para pausar e
// continuar de onde parou — o diagnóstico fica guardado neste navegador.
//
// "Corrigir todos" faz o "trazer do Shopify" de cada produto listado, na
// mesma fila, e relê o produto depois: o que ficou igual sai da lista.
const PAUSA_ENTRE_PRODUTOS_MS = 1500;
const ESPERA_LIMITE_S = 60;
const TAMANHO_DO_LOTE = 20;
const SALVAR_A_CADA_MS = 2000;

// Guardados neste navegador: o diagnóstico e o catálogo da Olist do último
// diagnóstico (a base do "atualizar"). O catálogo sendo lido fica só na
// memória — se a página recarregar no meio, a leitura recomeça.
const CHAVE_GUARDADA = 'sapf:diagnostico-olist';
const CHAVE_CATALOGO = 'sapf:diagnostico-olist:catalogo';
const VERSAO = 2;

// Situações de SKU que o "trazer do Shopify" corrige.
const SITUACOES_A_ENVIAR = ['diferente', 'nova'];

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Problemas que a varredura aponta, na ordem da tela. Cada um diz se o
// produto comparado (de /api/olist/comparar) tem o problema. `principal`:
// listado por padrão (desatualizado ou sem cadastro); os outros só com o
// "listar todos os problemas" marcado.
export const PROBLEMAS = [
  { chave: 'nao_cadastrado', rotulo: 'Não está na Olist', classe: 'marca-erro', principal: true, tem: (p) => p.situacao === 'nao_encontrado' },
  { chave: 'duplicado', rotulo: 'Duplicado na Olist', classe: 'marca-erro', tem: (p) => p.situacao === 'duplicado' },
  {
    chave: 'sku_faltando',
    rotulo: 'SKU faltando',
    classe: 'marca-erro',
    principal: true,
    tem: (p) => p.situacao === 'encontrado' && p.linhas.some((l) => l.situacao === 'nova'),
  },
  {
    chave: 'desatualizado',
    rotulo: 'Desatualizado',
    classe: 'marca-acessorio',
    principal: true,
    tem: (p) => p.diferencasPai.length > 0 || p.linhas.some((l) => l.diferencas.length > 0),
  },
  {
    chave: 'sku_em_outro',
    rotulo: 'SKU em outro produto',
    classe: 'marca-erro',
    tem: (p) => p.linhas.some((l) => l.situacao === 'fora_do_pai'),
  },
  { chave: 'sem_sku', rotulo: 'Sem SKU no Shopify', classe: 'marca-erro', tem: (p) => p.linhas.some((l) => l.situacao === 'sem_sku') },
];

const NOME_CAMPO = { nome: 'nome', ncm: 'NCM', peso: 'peso', preco: 'preço' };

/** Resumo enxuto de um produto comparado — a tela guarda só isto, não a
 *  comparação inteira, para a lista não pesar numa varredura longa. */
function resumir(produto) {
  const problemas = PROBLEMAS.filter((p) => p.tem(produto)).map((p) => p.chave);
  const comPreco = produto.linhas.filter((l) => l.diferencas.includes('preco')).length;
  const quantos = (situacao) => produto.linhas.filter((l) => l.situacao === situacao).length;
  // Cada detalhe é ligado ao problema dele: a tela esconde os dos problemas não listados.
  const detalhes = [
    produto.diferencasPai.length > 0 && {
      problema: 'desatualizado',
      texto: `${produto.diferencasPai.map((c) => NOME_CAMPO[c]).join(', ')} do pai`,
    },
    comPreco > 0 && { problema: 'desatualizado', texto: `preço em ${comPreco} SKU(s)` },
    produto.situacao === 'encontrado' && quantos('nova') > 0 && { problema: 'sku_faltando', texto: `${quantos('nova')} SKU(s) faltando` },
    quantos('fora_do_pai') > 0 && { problema: 'sku_em_outro', texto: `${quantos('fora_do_pai')} SKU(s) em outro produto` },
    quantos('sem_sku') > 0 && { problema: 'sem_sku', texto: `${quantos('sem_sku')} variante(s) sem SKU` },
    produto.situacao === 'nao_encontrado' && {
      problema: 'nao_cadastrado',
      texto: `${produto.linhas.filter((l) => l.sku).length} SKU(s) para cadastrar`,
    },
    produto.situacao === 'duplicado' && { problema: 'duplicado', texto: `${produto.duplicados} produtos ativos com este nome` },
  ].filter(Boolean);
  return {
    status: produto.status,
    // SKU para abrir o produto no cadastro de produtos.
    sku: produto.linhas.find((l) => l.sku)?.sku ?? null,
    // O que o "corrigir" manda para a Olist.
    enviaveis: produto.linhas.filter((l) => SITUACOES_A_ENVIAR.includes(l.situacao)).map((l) => l.sku),
    problemas,
    detalhes,
  };
}

// --- Catálogo da Olist -------------------------------------------------------
// Guardado como listas, não objetos: é o maior pedaço do que fica no navegador.
const CAMPOS_CATALOGO = ['id', 'nome', 'codigo', 'tipoVariacao', 'situacao', 'preco'];
const compactar = (item) => CAMPOS_CATALOGO.map((c) => item[c]);
const expandir = (lista) => Object.fromEntries(CAMPOS_CATALOGO.map((c, i) => [c, lista[i]]));

/** O que conta como "o cadastro mudou" de um registro do catálogo. */
const assinatura = (item) => [item.nome, item.codigo, item.tipoVariacao, item.situacao, item.preco].join('|');
// Chaves de casamento, como o Tiny compara: nome do pai e código (SKU).
const chavesDoRegistro = (item) => [`n:${normalizarNome(item.nome)}`, `c:${normalizarCodigo(item.codigo)}`];
const chavesDoProduto = (p) => [`n:${normalizarNome(p.titulo)}`, ...p.skus.map((sku) => `c:${normalizarCodigo(sku)}`)];

/** Índice do catálogo pelas chaves de nome e de código. */
function indexar(catalogo) {
  const indice = new Map();
  for (const item of catalogo) {
    for (const chave of chavesDoRegistro(item)) {
      if (chave === 'n:' || chave === 'c:') continue;
      if (!indice.has(chave)) indice.set(chave, []);
      indice.get(chave).push(item);
    }
  }
  return indice;
}

/** Registros do catálogo que casam com o produto (pelo nome ou por um SKU). */
function candidatos(indice, produto) {
  const achados = new Map();
  for (const chave of chavesDoProduto(produto)) for (const item of indice.get(chave) ?? []) achados.set(item.id, item);
  return [...achados.values()].map(({ id, nome, codigo, tipoVariacao, situacao }) => ({ id, nome, codigo, tipoVariacao, situacao }));
}

/** Chaves (nome e código) de todo registro que entrou, saiu ou mudou entre os dois catálogos. */
function chavesQueMudaram(anterior, atual) {
  const antes = new Map(anterior.map((i) => [i.id, i]));
  const agora = new Map(atual.map((i) => [i.id, i]));
  const chaves = new Set();
  for (const id of new Set([...antes.keys(), ...agora.keys()])) {
    const a = antes.get(id);
    const b = agora.get(id);
    if (a && b && assinatura(a) === assinatura(b)) continue;
    for (const item of [a, b]) if (item) chavesDoRegistro(item).forEach((c) => chaves.add(c));
  }
  return chaves;
}

// --- Guardado no navegador ---------------------------------------------------
function ler(chave) {
  try {
    return JSON.parse(window.localStorage.getItem(chave) ?? 'null');
  } catch {
    return null;
  }
}

function gravar(chave, valor) {
  try {
    if (valor == null) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // Sem localStorage (aba anônima, cota cheia): só não fica lembrado.
  }
}

const maisRecentesPrimeiro = (a, b) => String(b.criado ?? '').localeCompare(String(a.criado ?? ''));

/** /olist/diagnostico — varredura das diferenças de cadastro entre o Shopify e a Olist. */
export function useDiagnosticoOlist() {
  // parado | rodando | pausando | pausado | fim | corrigindo
  const [estado, setEstado] = useState('parado');
  // Produto sendo comparado agora: { titulo, segundos? }
  const [atual, setAtual] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  // id do produto -> { estado: fila|enviando|aguardando|relendo|gravado|erro, segundos?, erro? } do "corrigir"
  const [correcao, setCorrecao] = useState({});
  // A tela redesenha quando isto muda; os dados ficam nas refs abaixo.
  const [, setVersaoDaTela] = useState(0);

  // O diagnóstico: { trabalho, produtos, concluido }
  //   trabalho: a varredura atual ou a última — modo, fase, onde parou;
  //   produtos: id -> { titulo, criado, skus, verificadoEm, resumo|null, erro|null };
  //   concluido: quando começou a última varredura que foi até o fim — o
  //     "atualizar" procura o que mudou depois disso.
  const dados = useRef({ trabalho: null, produtos: {}, concluido: null });
  // Catálogo da Olist: o do último diagnóstico e o que está sendo lido.
  const catalogo = useRef([]);
  const catalogoNovo = useRef([]);
  const indice = useRef(null);
  const pausar = useRef(false);
  const ultimoSalvo = useRef(0);
  // Estado em que a varredura estava antes do "corrigir" — volta a ele no fim.
  const antesDeCorrigir = useRef('fim');

  function salvar(agora = false) {
    if (!agora && Date.now() - ultimoSalvo.current < SALVAR_A_CADA_MS) return;
    ultimoSalvo.current = Date.now();
    gravar(CHAVE_GUARDADA, { versao: VERSAO, ...dados.current });
  }

  function redesenhar(salvarAgora = false) {
    setVersaoDaTela((v) => v + 1);
    salvar(salvarAgora);
  }

  // Recupera o último diagnóstico; uma varredura que estava rodando volta pausada.
  useEffect(() => {
    const g = ler(CHAVE_GUARDADA);
    if (g?.versao !== VERSAO) return;
    dados.current = { trabalho: g.trabalho ?? null, produtos: g.produtos ?? {}, concluido: g.concluido ?? null };
    catalogo.current = (ler(CHAVE_CATALOGO) ?? []).map(expandir);
    const t = dados.current.trabalho;
    // O catálogo que estava sendo lido não foi guardado: a leitura recomeça.
    if (t?.fase === 'catalogo') t.catalogo = { pagina: 1, paginas: null, lidos: 0, indisponivel: null };
    if (t && t.fase !== 'catalogo' && !t.catalogo.indisponivel) indice.current = indexar(catalogo.current);
    setEstado(!t ? 'parado' : t.fase === 'fim' ? 'fim' : 'pausado');
    setVersaoDaTela((v) => v + 1);
  }, []);

  /** Espera o limite do Tiny contando os segundos. false se pausaram no meio. */
  async function esperarLimite(aoContar) {
    for (let s = ESPERA_LIMITE_S; s > 0; s -= 1) {
      if (pausar.current) return false;
      aoContar(s);
      await esperar(1000);
    }
    return true;
  }

  /** Compara um produto, esperando enquanto o Tiny recusar por limite. Com
   *  `doCatalogo`, usa os registros do catálogo em vez de pesquisar no Tiny.
   *  Devolve null se pausaram durante a espera (o produto fica pendente). */
  async function comparar(id, aoEsperar, doCatalogo = null) {
    for (;;) {
      let resposta;
      try {
        resposta = await fetch('/api/olist/comparar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ produtoId: id, catalogo: doCatalogo }),
        });
      } catch (e) {
        return { erro: `Falha de rede: ${e.message}` };
      }
      if (resposta.status === 429) {
        if (!(await esperarLimite(aoEsperar))) return null;
        continue;
      }
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) return { erro: corpo.erro ?? 'Falha na comparação' };
      return { produto: corpo.produtos[0] };
    }
  }

  /** Compara um produto da varredura e guarda o resultado. false se pausaram. */
  async function verificar(item) {
    const t = dados.current.trabalho;
    setAtual({ titulo: item.titulo });
    const r = await comparar(
      item.id,
      (segundos) => setAtual({ titulo: item.titulo, segundos }),
      indice.current ? candidatos(indice.current, item) : null
    );
    if (!r) return false;
    const { id, titulo, criado, skus } = item;
    dados.current.produtos = {
      ...dados.current.produtos,
      [id]: {
        titulo: r.produto?.titulo ?? titulo,
        criado,
        skus: r.produto ? r.produto.linhas.map((l) => l.sku).filter(Boolean) : skus,
        verificadoEm: t.inicio,
        resumo: r.produto ? resumir(r.produto) : null,
        erro: r.erro ?? null,
      },
    };
    t.verificados += 1;
    redesenhar();
    return true;
  }

  /** Fase 1. false se pausaram ou deu erro que não seja do catálogo. */
  async function lerCatalogo() {
    const t = dados.current.trabalho;
    const c = t.catalogo;
    while (c.paginas == null || c.pagina <= c.paginas) {
      if (pausar.current) return false;
      setAtual({ catalogo: true });
      let resposta;
      try {
        resposta = await fetch(`/api/olist/catalogo?${new URLSearchParams({ pagina: String(c.pagina) })}`);
      } catch (e) {
        setErro(`Falha de rede ao ler o catálogo da Olist: ${e.message}`);
        return false;
      }
      if (resposta.status === 429) {
        if (!(await esperarLimite((segundos) => setAtual({ catalogo: true, segundos })))) return false;
        continue;
      }
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        // O Tiny não deixou ler o catálogo: segue comparando produto a produto.
        c.indisponivel = corpo.erro ?? 'Falha ao ler o catálogo';
        break;
      }
      catalogoNovo.current = [...catalogoNovo.current, ...corpo.itens];
      c.paginas = corpo.paginas;
      c.pagina += 1;
      c.lidos = catalogoNovo.current.length;
      redesenhar();
      if (c.pagina <= c.paginas) await esperar(PAUSA_ENTRE_PRODUTOS_MS);
    }

    if (c.indisponivel) {
      indice.current = null;
    } else {
      // No "atualizar": produtos conhecidos cujo cadastro na Olist mudou, e os que deram erro.
      if (t.modo === 'atualizacao') {
        const mudaram = chavesQueMudaram(catalogo.current, catalogoNovo.current);
        t.filaTiny = Object.entries(dados.current.produtos)
          .filter(([, p]) => p.erro || chavesDoProduto(p).some((k) => mudaram.has(k)))
          .sort(([, a], [, b]) => maisRecentesPrimeiro(a, b))
          .map(([id]) => id);
      }
      catalogo.current = catalogoNovo.current;
      indice.current = indexar(catalogo.current);
      gravar(CHAVE_CATALOGO, catalogo.current.map(compactar));
    }
    catalogoNovo.current = [];
    if (t.modo === 'atualizacao' && c.indisponivel) {
      // Sem catálogo não dá para saber o que mudou na Olist: refaz só os que deram erro.
      t.filaTiny = Object.entries(dados.current.produtos).filter(([, p]) => p.erro).map(([id]) => id);
    }
    t.fase = 'shopify';
    redesenhar(true);
    return true;
  }

  /** Fase 2. false se pausaram ou deu erro. */
  async function varrerShopify() {
    const t = dados.current.trabalho;
    while (!pausar.current) {
      if (!t.pendentes.length) {
        if (!t.temMais) {
          t.fase = 'tiny';
          redesenhar(true);
          return true;
        }
        try {
          const parametros = { ...(t.cursor ? { cursor: t.cursor } : {}), ...(t.base ? { desde: t.base } : {}) };
          const resposta = await fetch(`/api/olist/diagnostico?${new URLSearchParams(parametros)}`);
          const corpo = await resposta.json().catch(() => ({}));
          if (!resposta.ok) throw new Error(corpo.erro ?? 'Falha ao ler o Shopify');
          t.pendentes = corpo.produtos;
          t.cursor = corpo.proximo;
          t.temMais = !!corpo.proximo;
          t.lotes += 1;
          redesenhar(true);
        } catch (e) {
          setErro(e.message);
          return false;
        }
        continue;
      }

      const item = t.pendentes[0];
      // No "atualizar" vêm também os que deixaram de estar ativos: saem do diagnóstico.
      if (item.status !== 'ACTIVE') {
        const { [item.id]: _, ...resto } = dados.current.produtos;
        dados.current.produtos = resto;
        t.pendentes = t.pendentes.slice(1);
        redesenhar();
        continue;
      }
      if (!(await verificar(item))) return false;
      t.pendentes = t.pendentes.slice(1);
      redesenhar();
      if (t.pendentes.length || t.temMais) await esperar(PAUSA_ENTRE_PRODUTOS_MS);
    }
    return false;
  }

  /** Fase 3. false se pausaram. */
  async function varrerMudancasDaOlist() {
    const t = dados.current.trabalho;
    while (t.filaTiny.length) {
      if (pausar.current) return false;
      const id = t.filaTiny[0];
      const produto = dados.current.produtos[id];
      // Já visto nesta varredura (alterado também no Shopify) ou saiu do diagnóstico.
      if (produto && produto.verificadoEm !== t.inicio) {
        if (t.feitosNaOlist % TAMANHO_DO_LOTE === 0) t.lotes += 1;
        if (!(await verificar({ id, ...produto }))) return false;
        t.feitosNaOlist += 1;
        await esperar(PAUSA_ENTRE_PRODUTOS_MS);
      }
      t.filaTiny = t.filaTiny.slice(1);
      redesenhar();
    }
    return true;
  }

  async function rodar() {
    pausar.current = false;
    setErro(null);
    setEstado('rodando');
    const t = dados.current.trabalho;
    const terminou =
      (t.fase !== 'catalogo' || (await lerCatalogo())) &&
      (t.fase !== 'shopify' || (await varrerShopify())) &&
      (t.fase !== 'tiny' || (await varrerMudancasDaOlist()));
    setAtual(null);
    if (terminou) {
      t.fase = 'fim';
      t.fim = new Date().toISOString();
      dados.current.concluido = t.inicio;
    }
    redesenhar(true);
    setEstado(terminou ? 'fim' : 'pausado');
  }

  /** Começa uma varredura: `completo` (todos os ativos) ou `atualizacao`
   *  (só o que mudou desde o último diagnóstico concluído). */
  function iniciar(modo = 'completo') {
    const atualizacao = modo === 'atualizacao' && !!dados.current.concluido;
    dados.current = {
      ...dados.current,
      produtos: atualizacao ? dados.current.produtos : {},
      trabalho: {
        modo: atualizacao ? 'atualizacao' : 'completo',
        inicio: new Date().toISOString(),
        base: atualizacao ? dados.current.concluido : null,
        fase: 'catalogo',
        catalogo: { pagina: 1, paginas: null, lidos: 0, indisponivel: null },
        cursor: null,
        temMais: true,
        pendentes: [],
        filaTiny: [],
        feitosNaOlist: 0,
        lotes: 0,
        verificados: 0,
      },
    };
    catalogoNovo.current = [];
    indice.current = null;
    setCorrecao({});
    setAviso(null);
    rodar();
  }

  function pausarVarredura() {
    pausar.current = true;
    if (estado === 'rodando') setEstado('pausando');
  }

  function estadoDaCorrecao(id, valor) {
    setCorrecao((atual) => ({ ...atual, [id]: valor }));
  }

  function trocarResumo(id, resumo) {
    const produto = dados.current.produtos[id];
    if (!produto) return;
    dados.current.produtos = { ...dados.current.produtos, [id]: { ...produto, resumo, erro: null } };
    redesenhar(true);
  }

  /** "Trazer do Shopify" de um produto, esperando enquanto o Tiny recusar por
   *  limite. Devolve null se pararam, ou { erro } / { ok: true }. */
  async function enviar(item) {
    for (;;) {
      estadoDaCorrecao(item.id, { estado: 'enviando' });
      let resposta;
      try {
        resposta = await fetch('/api/olist/trazer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ produtoId: item.id, skus: item.enviaveis }),
        });
      } catch (e) {
        return { erro: `Falha de rede: ${e.message}` };
      }
      if (resposta.status === 429) {
        const seguiu = await esperarLimite((segundos) => estadoDaCorrecao(item.id, { estado: 'aguardando', segundos }));
        if (!seguiu) return null;
        continue;
      }
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) return { erro: corpo.erro ?? 'Falha ao trazer do Shopify' };
      const comErro = (corpo.resultados ?? []).filter((r) => !r.ok);
      return comErro.length ? { erro: comErro.map((r) => `${r.sku}: ${r.erro}`).join('\n') } : { ok: true };
    }
  }

  /**
   * Corrige, um por vez, os produtos dados (os que o filtro mostra) que têm
   * algo para trazer do Shopify. Depois de gravar, relê direto no Tiny (o
   * catálogo já ficou velho): o que ficou igual sai da lista; o que continua
   * diferente fica com o resumo novo.
   */
  async function corrigir(produtos) {
    const itens = produtos.filter((p) => p.enviaveis?.length);
    if (!itens.length) return;

    antesDeCorrigir.current = estado === 'parado' ? 'fim' : estado;
    pausar.current = false;
    setErro(null);
    setAviso(null);
    setEstado('corrigindo');
    setCorrecao(Object.fromEntries(itens.map((p) => [p.id, { estado: 'fila' }])));

    let corrigidos = 0;
    let comErro = 0;
    for (const [i, item] of itens.entries()) {
      if (pausar.current) break;
      if (i > 0) await esperar(PAUSA_ENTRE_PRODUTOS_MS);
      const r = await enviar(item);
      if (!r) break;
      if (r.erro) {
        comErro += 1;
        estadoDaCorrecao(item.id, { estado: 'erro', erro: r.erro });
        continue;
      }

      await esperar(PAUSA_ENTRE_PRODUTOS_MS);
      estadoDaCorrecao(item.id, { estado: 'relendo' });
      const relido = await comparar(item.id, (segundos) => estadoDaCorrecao(item.id, { estado: 'aguardando', segundos }));
      if (!relido || relido.erro) {
        // Gravou, mas não deu para conferir: sai da fila sem mexer no resumo.
        corrigidos += 1;
        estadoDaCorrecao(item.id, { estado: 'gravado' });
        if (!relido) break;
        continue;
      }
      const resumo = resumir(relido.produto);
      trocarResumo(item.id, resumo);
      if (resumo.enviaveis.length) {
        comErro += 1;
        estadoDaCorrecao(item.id, {
          estado: 'erro',
          erro: `A Olist respondeu OK, mas ao ler o produto de novo continua diferente (${resumo.detalhes.map((d) => d.texto).join(', ')}).`,
        });
      } else {
        // Igual agora (sai da lista), ou sobrou só o que se corrige na Olist.
        corrigidos += 1;
        estadoDaCorrecao(item.id, undefined);
      }
    }

    // O que ficou na fila (parou no meio) volta a não ter estado.
    setCorrecao((atual) =>
      Object.fromEntries(Object.entries(atual).filter(([, v]) => v && !['fila', 'enviando', 'aguardando', 'relendo'].includes(v.estado)))
    );
    setAviso(
      `${corrigidos} produto(s) corrigidos na Olist.` + (comErro ? ` ${comErro} com erro — clique no erro para ver.` : '')
    );
    setEstado(antesDeCorrigir.current);
  }

  // Visões para a tela, os mais recentes primeiro.
  const lista = Object.entries(dados.current.produtos)
    .map(([id, p]) => ({ id, ...p }))
    .sort(maisRecentesPrimeiro);
  const divergentes = lista
    .filter((p) => p.resumo?.problemas.length)
    .map((p) => ({ id: p.id, titulo: p.titulo, ...p.resumo }));
  const falhas = lista.filter((p) => p.erro).map((p) => ({ id: p.id, titulo: p.titulo, erro: p.erro }));
  const iguais = lista.filter((p) => p.resumo && !p.resumo.problemas.length).length;

  return {
    estado,
    trabalho: dados.current.trabalho,
    concluido: dados.current.concluido,
    conhecidos: lista.length,
    iguais,
    divergentes,
    falhas,
    atual,
    erro,
    aviso,
    setAviso,
    correcao,
    iniciar,
    continuar: rodar,
    pausar: pausarVarredura,
    corrigir,
  };
}
