'use client';

import { useEffect, useRef, useState } from 'react';

// Varredura do diagnóstico: lê o Shopify de 20 em 20 produtos ativos e
// compara cada um com a Olist, um por requisição, com uma pausa entre eles.
// Se o Tiny recusar por limite de chamadas (429), espera e tenta o mesmo
// produto de novo. Dá para pausar e continuar de onde parou.
//
// "Corrigir todos" faz o "trazer do Shopify" de cada produto listado, na
// mesma fila, e relê o produto depois: o que ficou igual sai da lista.
const PAUSA_ENTRE_PRODUTOS_MS = 1500;
const ESPERA_LIMITE_S = 60;

// O último diagnóstico fica guardado neste navegador.
const CHAVE_GUARDADA = 'sapf:diagnostico-olist';

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
    id: produto.id,
    titulo: produto.titulo,
    status: produto.status,
    // SKU para abrir o produto no cadastro de produtos.
    sku: produto.linhas.find((l) => l.sku)?.sku ?? null,
    // O que o "corrigir" manda para a Olist.
    enviaveis: produto.linhas.filter((l) => SITUACOES_A_ENVIAR.includes(l.situacao)).map((l) => l.sku),
    problemas,
    detalhes,
  };
}

function lerGuardado() {
  try {
    return JSON.parse(window.localStorage.getItem(CHAVE_GUARDADA) ?? 'null');
  } catch {
    return null;
  }
}

/** /olist/diagnostico — varredura das diferenças de cadastro entre o Shopify e a Olist. */
export function useDiagnosticoOlist() {
  // parado | rodando | pausando | pausado | fim | corrigindo
  const [estado, setEstado] = useState('parado');
  const [lotes, setLotes] = useState(0);
  const [verificados, setVerificados] = useState(0);
  const [iguais, setIguais] = useState(0);
  // Só os produtos com algum problema.
  const [divergentes, setDivergentes] = useState([]);
  // { id, titulo, erro } de quem não deu para comparar
  const [falhas, setFalhas] = useState([]);
  // Produto sendo comparado agora: { titulo, segundos? }
  const [atual, setAtual] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  // Quando a varredura começou (ISO) — mostrado como "último diagnóstico".
  const [inicio, setInicio] = useState(null);
  // id do produto -> { estado: fila|enviando|aguardando|erro, segundos?, erro? } do "corrigir"
  const [correcao, setCorrecao] = useState({});
  // Estado em que a varredura estava antes do "corrigir" — volta a ele no fim.
  const antesDeCorrigir = useRef('fim');
  const [carregado, setCarregado] = useState(false);

  // Produtos do lote atual que ainda faltam, e o cursor do próximo lote.
  const pendentes = useRef([]);
  const proximo = useRef(null);
  const temMais = useRef(true);
  const pausar = useRef(false);

  // Recupera o último diagnóstico; uma varredura que estava rodando volta pausada.
  useEffect(() => {
    const g = lerGuardado();
    if (g) {
      setEstado(g.estado === 'fim' ? 'fim' : 'pausado');
      setLotes(g.lotes ?? 0);
      setVerificados(g.verificados ?? 0);
      setIguais(g.iguais ?? 0);
      setDivergentes(g.divergentes ?? []);
      setFalhas(g.falhas ?? []);
      setInicio(g.inicio ?? null);
      pendentes.current = g.pendentes ?? [];
      proximo.current = g.proximo ?? null;
      temMais.current = g.temMais ?? true;
    }
    setCarregado(true);
  }, []);

  useEffect(() => {
    if (!carregado || estado === 'parado') return;
    const guardado = {
      estado: estado === 'corrigindo' ? antesDeCorrigir.current : estado,
      lotes,
      verificados,
      iguais,
      divergentes,
      falhas,
      inicio,
      pendentes: pendentes.current,
      proximo: proximo.current,
      temMais: temMais.current,
    };
    try {
      window.localStorage.setItem(CHAVE_GUARDADA, JSON.stringify(guardado));
    } catch {
      // Sem localStorage (aba anônima, cota cheia): só não fica lembrado.
    }
  }, [carregado, estado, lotes, verificados, iguais, divergentes, falhas, inicio]);

  function zerar() {
    pendentes.current = [];
    proximo.current = null;
    temMais.current = true;
    setLotes(0);
    setVerificados(0);
    setIguais(0);
    setDivergentes([]);
    setFalhas([]);
    setCorrecao({});
    setAviso(null);
    setInicio(new Date().toISOString());
  }

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
   *  Devolve null se pausaram durante a espera (o produto fica pendente). */
  async function comparar(id, aoEsperar) {
    for (;;) {
      let resposta;
      try {
        resposta = await fetch(`/api/olist/comparar?${new URLSearchParams({ produtoId: id })}`);
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

  async function rodar() {
    pausar.current = false;
    setErro(null);
    setEstado('rodando');
    while (!pausar.current) {
      if (!pendentes.current.length) {
        if (!temMais.current) break;
        try {
          const resposta = await fetch(`/api/olist/diagnostico?${new URLSearchParams(proximo.current ? { cursor: proximo.current } : {})}`);
          const corpo = await resposta.json().catch(() => ({}));
          if (!resposta.ok) throw new Error(corpo.erro ?? 'Falha ao ler o Shopify');
          pendentes.current = corpo.produtos;
          proximo.current = corpo.proximo;
          temMais.current = !!corpo.proximo;
          setLotes((n) => n + 1);
        } catch (e) {
          setErro(e.message);
          setAtual(null);
          setEstado('pausado');
          return;
        }
        continue;
      }

      const item = pendentes.current[0];
      setAtual({ titulo: item.titulo });
      const r = await comparar(item.id, (segundos) => setAtual({ titulo: item.titulo, segundos }));
      if (!r) break;
      pendentes.current = pendentes.current.slice(1);
      setVerificados((n) => n + 1);
      if (r.erro) {
        setFalhas((atual) => [...atual, { id: item.id, titulo: item.titulo, erro: r.erro }]);
      } else {
        const resumo = resumir(r.produto);
        if (resumo.problemas.length) setDivergentes((atual) => [...atual, resumo]);
        else setIguais((n) => n + 1);
      }
      if (pendentes.current.length || temMais.current) await esperar(PAUSA_ENTRE_PRODUTOS_MS);
    }
    setAtual(null);
    setEstado(pausar.current ? 'pausado' : 'fim');
  }

  function iniciar() {
    zerar();
    rodar();
  }

  function pausarVarredura() {
    pausar.current = true;
    if (estado === 'rodando') setEstado('pausando');
  }

  function estadoDaCorrecao(id, valor) {
    setCorrecao((atual) => ({ ...atual, [id]: valor }));
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
   * algo para trazer do Shopify. Depois de gravar, relê: o que ficou igual
   * sai da lista; o que continua diferente fica com o resumo novo.
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
      if (!resumo.problemas.length) {
        corrigidos += 1;
        setDivergentes((atual) => atual.filter((p) => p.id !== item.id));
        setIguais((n) => n + 1);
        estadoDaCorrecao(item.id, undefined);
      } else if (resumo.enviaveis.length) {
        comErro += 1;
        setDivergentes((atual) => atual.map((p) => (p.id === item.id ? resumo : p)));
        estadoDaCorrecao(item.id, {
          estado: 'erro',
          erro: `A Olist respondeu OK, mas ao ler o produto de novo continua diferente (${resumo.detalhes.map((d) => d.texto).join(', ')}).`,
        });
      } else {
        // O que dava para trazer foi; sobrou o que só se corrige na Olist.
        corrigidos += 1;
        setDivergentes((atual) => atual.map((p) => (p.id === item.id ? resumo : p)));
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

  return {
    estado,
    lotes,
    verificados,
    iguais,
    divergentes,
    falhas,
    atual,
    erro,
    aviso,
    setAviso,
    inicio,
    correcao,
    iniciar,
    continuar: rodar,
    pausar: pausarVarredura,
    corrigir,
  };
}
