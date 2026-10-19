'use client';

import { useCallback, useEffect, useState } from 'react';
import { idNumerico } from '@/lib/utils';

// De quanto em quanto tempo a tela confere se algum produto mudou no Shopify.
const INTERVALO_NOTIFICACAO_MS = 2 * 60 * 1000;

// O que o "trazer do Shopify" envia: o resto já está igual ou não dá para enviar.
const SITUACOES_A_ENVIAR = ['diferente', 'nao_encontrado'];

async function lerJson(resposta, padrao) {
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? padrao);
  return corpo;
}

/**
 * /olist — busca um produto, compara Shopify x Olist SKU a SKU e traz do
 * Shopify o que estiver diferente ou faltando. Também acompanha os produtos
 * já enviados que mudaram no Shopify (notificação do topo).
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
  const [notificacoes, setNotificacoes] = useState([]);

  const carregarNotificacoes = useCallback(async () => {
    try {
      const corpo = await lerJson(await fetch('/api/olist/notificacoes'), 'Falha ao ler as notificações');
      setNotificacoes(corpo.atualizados);
    } catch {
      // Sem notificação não impede a tela; tenta de novo no próximo ciclo.
    }
  }, []);

  useEffect(() => {
    carregarNotificacoes();
    const timer = setInterval(carregarNotificacoes, INTERVALO_NOTIFICACAO_MS);
    return () => clearInterval(timer);
  }, [carregarNotificacoes]);

  // A contagem vai também no título da aba, para a notificação aparecer
  // mesmo com a tela em segundo plano.
  const totalNotificacoes = notificacoes.length;
  useEffect(() => {
    if (!totalNotificacoes) return undefined;
    const original = document.title;
    document.title = `(${totalNotificacoes}) ${original}`;
    return () => {
      document.title = original;
    };
  }, [totalNotificacoes]);

  async function comparar(busca, familia) {
    const nova = { busca: busca.trim(), familia };
    if (!nova.busca) return;
    setConsulta(nova);
    setCarregando(true);
    setErro(null);
    setAviso(null);
    setResultados({});
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

  const aEnviar = (produtos ?? [])
    .flatMap((p) => p.linhas)
    .filter((l) => SITUACOES_A_ENVIAR.includes(l.situacao) && !resultados[l.sku]?.ok);

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
      const falhas = corpo.resultados.filter((r) => !r.ok).length;
      const enviados = corpo.resultados.filter((r) => r.ok && r.acao !== 'igual').length;
      setAviso(
        `${enviados} SKU(s) enviados à Olist.` +
          (falhas ? ` ${falhas} com erro — veja na tabela.` : '') +
          (corpo.avisoRegistro ? ` ${corpo.avisoRegistro}` : '')
      );
      setConfirmado(false);
      carregarNotificacoes();
    } catch (e) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  async function dispensar(notificacao) {
    try {
      const parametros = new URLSearchParams({ atualizadoEm: notificacao.atualizadoEm });
      await lerJson(
        await fetch(`/api/olist/notificacoes/${idNumerico(notificacao.id)}?${parametros}`, { method: 'DELETE' }),
        'Falha ao dispensar'
      );
      setNotificacoes((atual) => atual.filter((n) => n.id !== notificacao.id));
    } catch (e) {
      setErro(e.message);
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
    aEnviar,
    confirmado,
    setConfirmado,
    enviando,
    trazerDoShopify,
    resultados,
    notificacoes,
    dispensar,
  };
}
