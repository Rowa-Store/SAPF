'use client';

import { useState } from 'react';

// O que o "trazer do Shopify" envia: o resto já está igual ou não dá para enviar.
const SITUACOES_A_ENVIAR = ['diferente', 'nao_encontrado'];

async function lerJson(resposta, padrao) {
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? padrao);
  return corpo;
}

/**
 * /olist — busca um produto, compara Shopify x Olist SKU a SKU e traz do
 * Shopify os SKUs marcados (diferentes ou faltando na Olist).
 */
export function useProdutosOlist() {
  // Última busca feita: { busca, familia } — é ela que o "trazer" repete.
  const [consulta, setConsulta] = useState(null);
  const [produtos, setProdutos] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [confirmado, setConfirmado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // sku -> { ok, acao, erro } do último "trazer do Shopify"
  const [resultados, setResultados] = useState({});
  const [aviso, setAviso] = useState(null);
  // SKUs marcados para o "trazer do Shopify" — começa vazio a cada busca.
  const [selecionados, setSelecionados] = useState(() => new Set());

  async function comparar(busca, familia) {
    const nova = { busca: busca.trim(), familia };
    if (!nova.busca) return;
    setConsulta(nova);
    setCarregando(true);
    setErro(null);
    setAviso(null);
    setResultados({});
    setSelecionados(new Set());
    setConfirmado(false);
    try {
      const parametros = new URLSearchParams({ busca: nova.busca, ...(familia ? { familia: '1' } : {}) });
      const corpo = await lerJson(await fetch(`/api/olist/comparar?${parametros}`), 'Falha na comparação');
      setProdutos(corpo.produtos);
    } catch (e) {
      setProdutos(null);
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  /** true quando o SKU pode ir para a Olist (e ainda não foi). */
  const enviavel = (linha) => SITUACOES_A_ENVIAR.includes(linha.situacao) && !resultados[linha.sku]?.ok;
  const enviaveis = (produtos ?? []).flatMap((p) => p.linhas).filter(enviavel);
  const aEnviar = enviaveis.filter((l) => selecionados.has(l.sku));

  /** Marca ou desmarca os SKUs (um só, ou todos os de um produto). */
  function marcar(skus, marcado) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      for (const sku of skus) (marcado ? novo.add(sku) : novo.delete(sku));
      return novo;
    });
  }

  async function trazerDoShopify() {
    setEnviando(true);
    setErro(null);
    try {
      const corpo = await lerJson(
        await fetch('/api/olist/trazer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...consulta, skus: aEnviar.map((l) => l.sku), confirmacao: confirmado }),
        }),
        'Falha ao trazer do Shopify'
      );
      setResultados((atual) => ({ ...atual, ...Object.fromEntries(corpo.resultados.map((r) => [r.sku, r])) }));
      // O que foi enviado sai da seleção; o que deu erro fica marcado para tentar de novo.
      marcar(corpo.resultados.filter((r) => r.ok).map((r) => r.sku), false);
      const falhas = corpo.resultados.filter((r) => !r.ok).length;
      const enviados = corpo.resultados.filter((r) => r.ok && r.acao !== 'igual').length;
      setAviso(
        `${enviados} SKU(s) enviados à Olist.` +
          (falhas ? ` ${falhas} com erro — veja na tabela.` : '')
      );
      setConfirmado(false);
    } catch (e) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return {
    consulta,
    produtos,
    carregando,
    erro,
    aviso,
    setAviso,
    comparar,
    enviavel,
    enviaveis,
    aEnviar,
    selecionados,
    marcar,
    confirmado,
    setConfirmado,
    enviando,
    trazerDoShopify,
    resultados,
  };
}
