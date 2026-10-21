'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Scan de GTIN duplicado: lê todos os produtos do Shopify (qualquer status),
// 100 por página, os mais recentes primeiro, e junta as variantes pelo
// barcode. Só lê — nada é gravado no Shopify nem na Olist.
//
// O que já foi lido fica guardado neste navegador junto com o cursor da
// próxima página: dá para pausar, fechar a tela e continuar de onde parou.
// Se o Shopify recusar por limite de custo (429), espera e tenta de novo.
const PAUSA_ENTRE_PAGINAS_MS = 500;
const ESPERA_LIMITE_S = 10;

const CHAVE_GUARDADA = 'sapf:scan-gtin';
const VERSAO = 1;

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

function ler() {
  try {
    return JSON.parse(window.localStorage.getItem(CHAVE_GUARDADA) ?? 'null');
  } catch {
    return null;
  }
}

function gravar(valor) {
  try {
    window.localStorage.setItem(CHAVE_GUARDADA, JSON.stringify(valor));
  } catch {
    // Sem localStorage (aba anônima, cota cheia): só não fica lembrado.
  }
}

/** Chave de comparação do GTIN: sem espaços e, se for só número, sem os
 *  zeros à esquerda ("07891..." de 14 dígitos é o mesmo "7891..." de 13). */
export function chaveDoGtin(gtin) {
  const texto = String(gtin ?? '').replace(/\s+/g, '');
  return /^\d+$/.test(texto) ? texto.replace(/^0+(?=\d)/, '') : texto;
}

/** Guarda do produto só o que a tela usa, e só as variantes com GTIN. */
function resumir(p) {
  return {
    titulo: p.titulo,
    status: p.status,
    tipo: p.tipo,
    criado: p.criado,
    admin: p.admin,
    totalVariantes: p.variantes.length,
    variantes: p.variantes.filter((v) => v.gtin).map(({ sku, opcao, preco, gtin }) => ({ sku, opcao, preco, gtin })),
  };
}

/**
 * Conflitos: cada grupo de produtos que divide pelo menos um GTIN. Produtos
 * que dividem vários GTINs (um produto copiado de outro) viram um conflito
 * só, com uma linha por GTIN. Os produtos vão do mais antigo (o "Produto 1",
 * em geral o original) para o mais novo; os conflitos, os mais recentes primeiro.
 */
function montarConflitos(produtos, soAtivos) {
  const porGtin = new Map();
  for (const [id, p] of Object.entries(produtos)) {
    if (soAtivos && p.status !== 'ACTIVE') continue;
    for (const v of p.variantes) {
      const chave = chaveDoGtin(v.gtin);
      if (!porGtin.has(chave)) porGtin.set(chave, []);
      porGtin.get(chave).push({ id, variante: v });
    }
  }

  const conflitos = new Map();
  for (const [gtin, ocorrencias] of porGtin) {
    if (ocorrencias.length < 2) continue;
    const ids = [...new Set(ocorrencias.map((o) => o.id))].sort(
      (a, b) => String(produtos[a].criado).localeCompare(String(produtos[b].criado)) || a.localeCompare(b)
    );
    const chave = ids.join('|');
    if (!conflitos.has(chave)) conflitos.set(chave, { chave, ids, gtins: [] });
    conflitos.get(chave).gtins.push({
      gtin: ocorrencias[0].variante.gtin,
      porProduto: ids.map((id) => ocorrencias.filter((o) => o.id === id).map((o) => o.variante)),
    });
  }

  return [...conflitos.values()]
    .map((c) => ({
      chave: c.chave,
      produtos: c.ids.map((id) => ({ id, ...produtos[id] })),
      gtins: c.gtins.sort((a, b) => a.gtin.localeCompare(b.gtin)),
      maisRecente: c.ids.reduce((m, id) => (String(produtos[id].criado) > m ? String(produtos[id].criado) : m), ''),
    }))
    .sort((a, b) => b.maisRecente.localeCompare(a.maisRecente));
}

/** /olist/scan-gtin — GTINs repetidos entre as variantes do Shopify. */
export function useScanGtin() {
  // parado | rodando | pausando | pausado | fim
  const [estado, setEstado] = useState('parado');
  const [erro, setErro] = useState(null);
  // Segundos até tentar de novo, enquanto o Shopify recusa por limite.
  const [espera, setEspera] = useState(null);
  const [soAtivos, setSoAtivos] = useState(false);
  // A tela redesenha quando isto muda; os dados ficam na ref abaixo.
  const [versaoDaTela, setVersaoDaTela] = useState(0);

  // { trabalho: { inicio, fim, cursor, temMais, paginas, lidos }, produtos: id -> resumo }
  const dados = useRef({ trabalho: null, produtos: {} });
  const pausar = useRef(false);

  function salvarERedesenhar() {
    gravar({ versao: VERSAO, ...dados.current });
    setVersaoDaTela((v) => v + 1);
  }

  // Recupera o último scan; um que estava rodando volta pausado.
  useEffect(() => {
    const g = ler();
    if (g?.versao !== VERSAO || !g.trabalho) return;
    dados.current = { trabalho: g.trabalho, produtos: g.produtos ?? {} };
    setEstado(g.trabalho.temMais ? 'pausado' : 'fim');
    setVersaoDaTela((v) => v + 1);
  }, []);

  /** Uma página do Shopify, esperando enquanto ele recusar por limite.
   *  null se pausaram durante a espera. */
  async function lerPagina(cursor) {
    for (;;) {
      const resposta = await fetch(`/api/olist/scan-gtin?${new URLSearchParams(cursor ? { cursor } : {})}`);
      if (resposta.status === 429) {
        for (let s = ESPERA_LIMITE_S; s > 0; s -= 1) {
          if (pausar.current) return null;
          setEspera(s);
          await esperar(1000);
        }
        setEspera(null);
        continue;
      }
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro ?? 'Falha ao ler o Shopify');
      return corpo;
    }
  }

  async function rodar() {
    pausar.current = false;
    setErro(null);
    setEstado('rodando');
    const t = dados.current.trabalho;
    try {
      while (t.temMais && !pausar.current) {
        const pagina = await lerPagina(t.cursor);
        if (!pagina) break;
        // Só os produtos com algum GTIN ficam guardados.
        const novos = Object.fromEntries(
          pagina.produtos.filter((p) => p.variantes.some((v) => v.gtin)).map((p) => [p.id, resumir(p)])
        );
        dados.current.produtos = { ...dados.current.produtos, ...novos };
        t.cursor = pagina.proximo;
        t.temMais = !!pagina.proximo;
        t.paginas += 1;
        t.lidos += pagina.produtos.length;
        if (!t.temMais) t.fim = new Date().toISOString();
        salvarERedesenhar();
        if (t.temMais) await esperar(PAUSA_ENTRE_PAGINAS_MS);
      }
    } catch (e) {
      setErro(e.message.startsWith('Failed to fetch') ? `Falha de rede: ${e.message}` : e.message);
    }
    setEspera(null);
    setEstado(t.temMais ? 'pausado' : 'fim');
  }

  /** Começa um scan do zero — esquece o que o anterior encontrou. */
  function iniciar() {
    dados.current = {
      trabalho: { inicio: new Date().toISOString(), fim: null, cursor: null, temMais: true, paginas: 0, lidos: 0 },
      produtos: {},
    };
    salvarERedesenhar();
    rodar();
  }

  function pausarScan() {
    pausar.current = true;
    if (estado === 'rodando') setEstado('pausando');
  }

  const conflitos = useMemo(
    () => montarConflitos(dados.current.produtos, soAtivos),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [versaoDaTela, soAtivos]
  );
  const gtinsDuplicados = conflitos.reduce((n, c) => n + c.gtins.length, 0);
  const comGtin = Object.keys(dados.current.produtos).length;

  return {
    estado,
    trabalho: dados.current.trabalho,
    comGtin,
    conflitos,
    gtinsDuplicados,
    erro,
    espera,
    soAtivos,
    setSoAtivos,
    iniciar,
    continuar: rodar,
    pausar: pausarScan,
  };
}
