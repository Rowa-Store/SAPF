'use client';

import { useState } from 'react';

// O que o "trazer do Shopify" envia: o resto já está igual ou não dá para enviar.
const SITUACOES_A_ENVIAR = ['diferente', 'nova'];

// Fila do "trazer do Shopify": um produto por requisição, com uma pausa
// entre eles; se o Tiny recusar por limite de chamadas (429), espera e tenta
// o mesmo produto de novo.
const PAUSA_ENTRE_PRODUTOS_MS = 1500;
const ESPERA_LIMITE_S = 60;
const MAXIMO_TENTATIVAS = 5;

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Filtros da lista: só mudam o que aparece, sem consultar de novo. Seleção,
// "marcar todos" e envio valem só para o que o filtro mostra.
export const FILTROS = [
  { chave: 'todos', rotulo: 'Todos', mostra: () => true },
  { chave: 'nao_cadastrados', rotulo: 'Não cadastrados', mostra: (l) => l.situacao === 'nova' },
  { chave: 'desatualizados', rotulo: 'Desatualizados', mostra: (l) => l.situacao === 'diferente' },
];

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
  const [enviando, setEnviando] = useState(false);
  // sku -> { ok, acao, erro } do último "trazer do Shopify"
  const [resultados, setResultados] = useState({});
  const [aviso, setAviso] = useState(null);
  // SKUs marcados para o "trazer do Shopify" — começa vazio a cada busca.
  const [selecionados, setSelecionados] = useState(() => new Set());
  // id do produto -> { estado: fila|enviando|aguardando|ok|erro, segundos? }
  const [fila, setFila] = useState({});
  const [filtro, setFiltro] = useState('todos');

  async function comparar(busca, familia) {
    const nova = { busca: busca.trim(), familia };
    if (!nova.busca) return;
    setConsulta(nova);
    setCarregando(true);
    setErro(null);
    setAviso(null);
    setResultados({});
    setSelecionados(new Set());
    setFila({});
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
  // Nos filtros (fora o "Todos"), o SKU já gravado com sucesso sai da lista
  // e da contagem: não está mais "desatualizado" nem "não cadastrado".
  const noFiltro = (f) => (l) => f.mostra(l) && (f.chave === 'todos' || !resultados[l.sku]?.ok);
  const mostra = noFiltro(FILTROS.find((f) => f.chave === filtro));
  const visiveis = (produtos ?? [])
    .map((p) => ({ ...p, linhas: p.linhas.filter(mostra) }))
    .filter((p) => p.linhas.length);
  const contagens = Object.fromEntries(
    FILTROS.map((f) => [f.chave, (produtos ?? []).flatMap((p) => p.linhas).filter(noFiltro(f)).length])
  );
  const enviaveis = visiveis.flatMap((p) => p.linhas).filter(enviavel);
  const aEnviar = enviaveis.filter((l) => selecionados.has(l.sku));

  /** Troca o filtro e desmarca o que ele deixa de mostrar. */
  function trocarFiltro(chave) {
    const novoMostra = noFiltro(FILTROS.find((f) => f.chave === chave));
    const continuam = new Set((produtos ?? []).flatMap((p) => p.linhas).filter(novoMostra).map((l) => l.sku));
    setFiltro(chave);
    setSelecionados((atual) => new Set([...atual].filter((sku) => continuam.has(sku))));
  }

  /** Marca ou desmarca os SKUs (um só, ou todos os de um produto). */
  function marcar(skus, marcado) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      for (const sku of skus) (marcado ? novo.add(sku) : novo.delete(sku));
      return novo;
    });
  }

  function estadoNaFila(produtoId, estado) {
    setFila((atual) => ({ ...atual, [produtoId]: estado }));
  }

  /** Envia um produto, esperando e repetindo enquanto o Tiny recusar por
   *  limite. Devolve os resultados por SKU. */
  async function enviarProduto({ id, skus }) {
    for (let tentativa = 1; ; tentativa += 1) {
      estadoNaFila(id, { estado: 'enviando' });
      let resposta;
      try {
        resposta = await fetch('/api/olist/trazer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ produtoId: id, skus }),
        });
      } catch (e) {
        return skus.map((sku) => ({ sku, ok: false, erro: `Falha de rede: ${e.message}` }));
      }

      if (resposta.status === 429 && tentativa < MAXIMO_TENTATIVAS) {
        for (let s = ESPERA_LIMITE_S; s > 0; s -= 1) {
          estadoNaFila(id, { estado: 'aguardando', segundos: s });
          await esperar(1000);
        }
        continue;
      }

      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) return skus.map((sku) => ({ sku, ok: false, erro: corpo.erro ?? 'Falha ao trazer do Shopify' }));
      return corpo.resultados;
    }
  }

  /**
   * Relê o produto depois de gravado e troca na tela. SKU que o Tiny disse
   * ter gravado mas que continua diferente vira erro — a gravação não pegou.
   * Se a releitura falhar (ex.: limite), fica o que o Tiny respondeu.
   */
  async function releerProduto(id, resultadosDoProduto) {
    let atualizado;
    try {
      const corpo = await lerJson(
        await fetch(`/api/olist/comparar?${new URLSearchParams({ produtoId: id })}`),
        'Falha ao reler'
      );
      atualizado = corpo.produtos[0];
    } catch {
      return resultadosDoProduto;
    }
    setProdutos((atual) => atual.map((p) => (p.id === id ? atualizado : p)));
    return resultadosDoProduto.map((r) => {
      const linha = atualizado.linhas.find((l) => l.sku === r.sku);
      if (!r.ok || !linha || linha.situacao === 'igual') return r;
      const campos = [...atualizado.diferencasPai, ...linha.diferencas].join(', ') || linha.situacao;
      return {
        sku: r.sku,
        ok: false,
        erro: `A Olist respondeu OK, mas ao ler o produto de novo o SKU continua diferente (${campos}).`,
      };
    });
  }

  async function trazerDoShopify() {
    const itens = visiveis
      .map((p) => ({ id: p.id, skus: p.linhas.filter((l) => enviavel(l) && selecionados.has(l.sku)).map((l) => l.sku) }))
      .filter((item) => item.skus.length);
    if (!itens.length) return;

    setEnviando(true);
    setErro(null);
    setAviso(null);
    setFila(Object.fromEntries(itens.map((item) => [item.id, { estado: 'fila' }])));

    let enviados = 0;
    let falhas = 0;
    for (const [i, item] of itens.entries()) {
      if (i > 0) await esperar(PAUSA_ENTRE_PRODUTOS_MS);
      let resultadosDoProduto = await enviarProduto(item);
      if (resultadosDoProduto.some((r) => r.ok)) {
        await esperar(PAUSA_ENTRE_PRODUTOS_MS);
        resultadosDoProduto = await releerProduto(item.id, resultadosDoProduto);
      }
      setResultados((atual) => ({ ...atual, ...Object.fromEntries(resultadosDoProduto.map((r) => [r.sku, r])) }));
      // O que foi enviado sai da seleção; o que deu erro fica marcado para tentar de novo.
      marcar(resultadosDoProduto.filter((r) => r.ok).map((r) => r.sku), false);
      enviados += resultadosDoProduto.filter((r) => r.ok && r.acao !== 'igual').length;
      falhas += resultadosDoProduto.filter((r) => !r.ok).length;
      estadoNaFila(item.id, { estado: resultadosDoProduto.every((r) => r.ok) ? 'ok' : 'erro' });
    }

    setAviso(`${enviados} SKU(s) enviados à Olist.` + (falhas ? ` ${falhas} com erro — clique no erro para ver.` : ''));
    setEnviando(false);
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
    visiveis,
    contagens,
    filtro,
    trocarFiltro,
    selecionados,
    marcar,
    enviando,
    trazerDoShopify,
    resultados,
    fila,
  };
}
