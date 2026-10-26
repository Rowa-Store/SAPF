'use client';

import { useEffect, useRef, useState } from 'react';

// Varredura do diagnóstico: lê o Shopify de 50 em 50, os mais recentes
// primeiro, e compara cada um com a Olist. Na varredura completa, todos os
// ativos; no "atualizar", só os alterados no Shopify desde o último
// diagnóstico, mais os que deram erro — mudança feita só na Olist fica para a
// varredura completa.
//
// Um produto por requisição, com uma pausa entre eles; se o Tiny recusar por
// limite de chamadas (429), espera e tenta de novo. Dá para pausar e
// continuar de onde parou — o diagnóstico fica guardado neste navegador.
//
// Varredura com FOCO (ver FOCOS): procura só um problema, com a comparação
// leve — sem ler o cadastro completo de cada SKU no Tiny, metade das chamadas.
//
// "Corrigir todos" faz o "trazer do Shopify" de cada produto listado, na
// mesma fila; a rota devolve como o produto ficou: o que ficou igual sai da lista.
//
// "Baixar planilha" monta a planilha de importação do Tiny com os SKUs sem
// cadastro dos produtos listados (/api/olist/planilha) — cadastro sem a API.
const PAUSA_ENTRE_PRODUTOS_MS = 1500;
const ESPERA_LIMITE_S = 60;
const TAMANHO_DO_LOTE = 50;
const SALVAR_A_CADA_MS = 2000;

// O último diagnóstico fica guardado neste navegador.
const CHAVE_GUARDADA = 'sapf:diagnostico-olist';
// Guardado por uma versão anterior, que lia o catálogo inteiro da Olist.
const CHAVE_CATALOGO_ANTIGA = 'sapf:diagnostico-olist:catalogo';
const VERSAO = 3;

// Situações de SKU que o "trazer do Shopify" corrige.
const SITUACOES_A_ENVIAR = ['diferente', 'nova'];

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Problemas que a varredura aponta, na ordem da tela. Cada um diz se o
// produto comparado (de /api/olist/comparar) tem o problema. `principal`:
// listado por padrão (desatualizado ou sem cadastro); os outros só com o
// "listar todos os problemas" marcado.
export const PROBLEMAS = [
  { chave: 'nao_cadastrado', rotulo: 'Não está na Olist', classe: 'marca-erro', principal: true, tem: (p) => p.situacao === 'nao_encontrado' },
  {
    chave: 'duplicado',
    rotulo: 'Código duplicado na Olist',
    classe: 'marca-erro',
    tem: (p) => p.linhas.some((l) => l.situacao === 'bloqueado'),
  },
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
    // Nome, NCM, peso ou situação; o preço tem o filtro dele.
    tem: (p) =>
      p.linhas.some((l) => l.situacao === 'diferente' && (!l.diferencas.length || l.diferencas.some((c) => c !== 'preco'))),
  },
  {
    chave: 'preco',
    rotulo: 'Preço desatualizado',
    classe: 'marca-acessorio',
    principal: true,
    tem: (p) => p.linhas.some((l) => l.diferencas.includes('preco')),
  },
  {
    chave: 'sku_em_pai',
    rotulo: 'SKU em produto pai',
    classe: 'marca-erro',
    tem: (p) => p.linhas.some((l) => l.situacao === 'em_pai'),
  },
  { chave: 'sem_sku', rotulo: 'Sem SKU no Shopify', classe: 'marca-erro', tem: (p) => p.linhas.some((l) => l.situacao === 'sem_sku') },
];

// Varreduras que procuram só um problema: a comparação leve basta (o Tiny
// traz nome, preço e situação na pesquisa). `problemas`: o que a varredura
// aponta; `enviavel`: os SKUs que o "corrigir" manda.
export const FOCOS = {
  nao_cadastrado: {
    rotulo: 'Não está na Olist',
    // SKU em produto pai: está na Olist no modelo antigo — não vai na
    // planilha, mas aparece para excluir a variação lá antes de cadastrar.
    problemas: ['nao_cadastrado', 'sku_faltando', 'sku_em_pai'],
    enviavel: (l) => l.situacao === 'nova',
  },
  preco: {
    rotulo: 'Preço desatualizado',
    problemas: ['preco'],
    enviavel: (l) => l.situacao === 'diferente' && l.diferencas.includes('preco'),
  },
};

/** Resumo enxuto de um produto comparado — a tela guarda só isto, não a
 *  comparação inteira, para a lista não pesar numa varredura longa. Com
 *  `foco` (chave de FOCOS), só os problemas dele. */
function resumir(produto, foco = null) {
  const doFoco = FOCOS[foco] ?? null;
  const problemas = PROBLEMAS.filter((p) => (!doFoco || doFoco.problemas.includes(p.chave)) && p.tem(produto)).map(
    (p) => p.chave
  );
  const comPreco = produto.linhas.filter((l) => l.diferencas.includes('preco')).length;
  // Diferente em algo além do preço (ou só inativo na Olist).
  const comOutros = produto.linhas.filter(
    (l) => l.situacao === 'diferente' && (!l.diferencas.length || l.diferencas.some((c) => c !== 'preco'))
  ).length;
  const quantos = (situacao) => produto.linhas.filter((l) => l.situacao === situacao).length;
  // Cada detalhe é ligado ao problema dele: a tela esconde os dos problemas não listados.
  const detalhes = [
    comOutros > 0 && { problema: 'desatualizado', texto: `nome, NCM, peso ou situação em ${comOutros} SKU(s)` },
    comPreco > 0 && { problema: 'preco', texto: `preço em ${comPreco} SKU(s)` },
    produto.situacao === 'encontrado' && quantos('nova') > 0 && { problema: 'sku_faltando', texto: `${quantos('nova')} SKU(s) faltando` },
    quantos('em_pai') > 0 && { problema: 'sku_em_pai', texto: `${quantos('em_pai')} SKU(s) como variação de produto pai` },
    quantos('sem_sku') > 0 && { problema: 'sem_sku', texto: `${quantos('sem_sku')} variante(s) sem SKU` },
    produto.situacao === 'nao_encontrado' && {
      problema: 'nao_cadastrado',
      texto: `${produto.linhas.filter((l) => l.sku).length} SKU(s) para cadastrar`,
    },
    quantos('bloqueado') > 0 && { problema: 'duplicado', texto: `${quantos('bloqueado')} SKU(s) com código duplicado` },
  ].filter((d) => d && problemas.includes(d.problema));
  return {
    status: produto.status,
    // SKU para abrir o produto no cadastro de produtos.
    sku: produto.linhas.find((l) => l.sku)?.sku ?? null,
    // SKUs que não existem na Olist — os da planilha de importação.
    novos: produto.linhas.filter((l) => l.situacao === 'nova').map((l) => l.sku),
    // O que o "corrigir" manda para a Olist.
    enviaveis: produto.linhas
      .filter(doFoco ? doFoco.enviavel : (l) => SITUACOES_A_ENVIAR.includes(l.situacao))
      .map((l) => l.sku),
    problemas,
    detalhes,
  };
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
  const [gerandoPlanilha, setGerandoPlanilha] = useState(false);
  // id do produto -> { estado: fila|enviando|aguardando|gravado|erro, segundos?, erro? } do "corrigir"
  const [correcao, setCorrecao] = useState({});
  // A tela redesenha quando isto muda; os dados ficam nas refs abaixo.
  const [, setVersaoDaTela] = useState(0);

  // O diagnóstico: { trabalho, produtos, concluido }
  //   trabalho: a varredura atual ou a última — modo, fase, onde parou;
  //   produtos: id -> { titulo, criado, skus, verificadoEm, resumo|null, erro|null };
  //   concluido: quando começou a última varredura que foi até o fim — o
  //     "atualizar" procura o que mudou depois disso.
  const dados = useRef({ trabalho: null, produtos: {}, concluido: null });
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
    gravar(CHAVE_CATALOGO_ANTIGA, null);
    const t = dados.current.trabalho;
    // Varredura da versão que lia o catálogo: segue pelo Shopify, e o que
    // ela tinha posto na fila é refeito no fim.
    if (t?.fase === 'catalogo') t.fase = 'shopify';
    if (t?.fase === 'tiny') t.fase = 'erros';
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

  /** Compara um produto, esperando enquanto o Tiny recusar por limite.
   *  `leve`: só nome, preço e situação (varredura com foco).
   *  Devolve null se pausaram durante a espera (o produto fica pendente). */
  async function comparar(id, aoEsperar, { leve = false } = {}) {
    for (;;) {
      let resposta;
      try {
        resposta = await fetch(`/api/olist/comparar?${new URLSearchParams({ produtoId: id, ...(leve ? { leve: '1' } : {}) })}`);
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
    const r = await comparar(item.id, (segundos) => setAtual({ titulo: item.titulo, segundos }), { leve: !!t.foco });
    if (!r) return false;
    const { id, titulo, criado, skus } = item;
    dados.current.produtos = {
      ...dados.current.produtos,
      [id]: {
        titulo: r.produto?.titulo ?? titulo,
        criado,
        skus: r.produto ? r.produto.linhas.map((l) => l.sku).filter(Boolean) : skus,
        verificadoEm: t.inicio,
        resumo: r.produto ? resumir(r.produto, t.foco) : null,
        erro: r.erro ?? null,
      },
    };
    t.verificados += 1;
    redesenhar();
    return true;
  }

  /** Lê o Shopify de 50 em 50 e compara cada um. false se pausaram ou deu erro. */
  async function varrerShopify() {
    const t = dados.current.trabalho;
    while (!pausar.current) {
      if (!t.pendentes.length) {
        if (!t.temMais) {
          t.fase = 'erros';
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

  /** No "atualizar": refaz os que deram erro no último diagnóstico. false se pausaram. */
  async function refazerErros() {
    const t = dados.current.trabalho;
    while (t.refazer.length) {
      if (pausar.current) return false;
      const id = t.refazer[0];
      const produto = dados.current.produtos[id];
      // Já visto nesta varredura (alterado no Shopify) ou saiu do diagnóstico.
      if (produto && produto.verificadoEm !== t.inicio) {
        if (!(await verificar({ id, ...produto }))) return false;
        await esperar(PAUSA_ENTRE_PRODUTOS_MS);
      }
      t.refazer = t.refazer.slice(1);
      redesenhar();
    }
    return true;
  }

  async function rodar() {
    pausar.current = false;
    setErro(null);
    setEstado('rodando');
    const t = dados.current.trabalho;
    t.refazer ??= t.filaTiny ?? [];
    const terminou =
      (t.fase !== 'shopify' || (await varrerShopify())) && (t.fase !== 'erros' || (await refazerErros()));
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
   *  (só o que mudou desde o último diagnóstico concluído, com o mesmo foco).
   *  `foco` (chave de FOCOS, só no completo): procura só aquele problema. */
  function iniciar(modo = 'completo', foco = null) {
    const atualizacao = modo === 'atualizacao' && !!dados.current.concluido;
    dados.current = {
      ...dados.current,
      produtos: atualizacao ? dados.current.produtos : {},
      trabalho: {
        modo: atualizacao ? 'atualizacao' : 'completo',
        inicio: new Date().toISOString(),
        base: atualizacao ? dados.current.concluido : null,
        foco: atualizacao ? (dados.current.trabalho?.foco ?? null) : FOCOS[foco] ? foco : null,
        fase: 'shopify',
        cursor: null,
        temMais: true,
        pendentes: [],
        // No "atualizar", os que deram erro no último diagnóstico são refeitos no fim.
        refazer: atualizacao
          ? Object.entries(dados.current.produtos)
              .filter(([, p]) => p.erro)
              .sort(([, a], [, b]) => maisRecentesPrimeiro(a, b))
              .map(([id]) => id)
          : [],
        lotes: 0,
        verificados: 0,
      },
    };
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
   *  limite. Devolve null se pararam, ou { erro } / { ok: true }, com o
   *  `produto` como ficou quando a rota respondeu. */
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
      // `produto`: a comparação depois de gravar, montada pela rota.
      return {
        produto: corpo.produto ?? null,
        ...(comErro.length ? { erro: comErro.map((r) => `${r.sku}: ${r.erro}`).join('\n') } : { ok: true }),
      };
    }
  }

  /**
   * Corrige, um por vez, os produtos dados (os que o filtro mostra) que têm
   * algo para trazer do Shopify. O resumo passa a ser o do produto como a
   * rota diz que ficou — sem reler o Tiny: o que ficou igual sai da lista.
   */
  async function corrigir(produtos) {
    const itens = produtos.filter((p) => p.enviaveis?.length);
    if (!itens.length) return;
    const foco = dados.current.trabalho?.foco ?? null;

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
      if (r.produto) trocarResumo(item.id, resumir(r.produto, foco));
      if (r.erro) {
        comErro += 1;
        estadoDaCorrecao(item.id, { estado: 'erro', erro: r.erro });
        continue;
      }
      // Igual agora (sai da lista), ou sobrou só o que se corrige na Olist.
      corrigidos += 1;
      estadoDaCorrecao(item.id, r.produto ? undefined : { estado: 'gravado' });
    }

    // O que ficou na fila (parou no meio) volta a não ter estado.
    setCorrecao((atual) =>
      Object.fromEntries(Object.entries(atual).filter(([, v]) => v && !['fila', 'enviando', 'aguardando'].includes(v.estado)))
    );
    setAviso(
      `${corrigidos} produto(s) corrigidos na Olist.` + (comErro ? ` ${comErro} com erro — clique no erro para ver.` : '')
    );
    setEstado(antesDeCorrigir.current);
  }

  /** Baixa a planilha de importação do Tiny com os SKUs sem cadastro dos
   *  produtos dados (os que o filtro mostra). Só lê o Shopify. */
  async function baixarPlanilha(produtos) {
    const itens = produtos.filter((p) => p.novos?.length).map((p) => ({ produtoId: p.id, skus: p.novos }));
    if (!itens.length) return;
    setGerandoPlanilha(true);
    setErro(null);
    setAviso(null);
    try {
      const resposta = await fetch('/api/olist/planilha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens }),
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        throw new Error(corpo.erro ?? 'Falha ao gerar a planilha');
      }
      const nome = /filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') ?? '')?.[1] ?? 'produtos-tiny.xls';
      const url = URL.createObjectURL(await resposta.blob());
      const link = Object.assign(document.createElement('a'), { href: url, download: nome });
      link.click();
      URL.revokeObjectURL(url);
      const skus = itens.reduce((n, i) => n + i.skus.length, 0);
      setAviso(
        `Planilha com ${skus} SKU(s) de ${itens.length} produto(s). Depois de importar no Tiny, ` +
          'varra de novo “Não está na Olist” para tirá-los da lista.'
      );
    } catch (e) {
      setErro(e.message);
    } finally {
      setGerandoPlanilha(false);
    }
  }

  // Visões para a tela, os mais recentes primeiro.
  const lista = Object.entries(dados.current.produtos)
    .map(([id, p]) => ({ id, ...p }))
    .sort(maisRecentesPrimeiro);
  const divergentes = lista
    .filter((p) => p.resumo?.problemas.length)
    .map((p) => ({
      id: p.id,
      titulo: p.titulo,
      ...p.resumo,
      // Resumo de antes de `novos` existir: produto sem cadastro tem todos os SKUs novos.
      novos: p.resumo.novos ?? (p.resumo.problemas.includes('nao_cadastrado') ? p.skus : []),
    }));
  const falhas = lista.filter((p) => p.erro).map((p) => ({ id: p.id, titulo: p.titulo, erro: p.erro }));
  const iguais = lista.filter((p) => p.resumo && !p.resumo.problemas.length).length;

  return {
    estado,
    trabalho: dados.current.trabalho,
    foco: dados.current.trabalho?.foco ?? null,
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
    gerandoPlanilha,
    baixarPlanilha,
  };
}
