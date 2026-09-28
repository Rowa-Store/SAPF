'use client';

import { useEffect, useState } from 'react';
import { ITENS_POR_PAGINA } from '@/lib/constants';
import { recalcularParcelas } from '@/lib/fiscal/pagamento';

/**
 * /transferencias/[id]/rascunho/editar — corrige um rascunho já criado no Tiny.
 *
 * A API 2.0 do Tiny não tem endpoint para alterar nem excluir uma nota — só
 * para incluir. Por isso "editar" aqui significa criar um NOVO rascunho com
 * os dados corrigidos; o antigo fica no Tiny e precisa ser cancelado ou
 * excluído manualmente lá dentro.
 *
 * Diferença para useIncluirRascunho: os dados de partida vêm do que foi
 * REALMENTE enviado ao Tiny da última vez (payload_enviado no Supabase), não
 * recalculados a partir do pedido no Shopify.
 *
 * `urlApi` é o endpoint GET/PUT do rascunho (/api/transferencias/[id]/rascunho).
 * Rascunho de pedido de atacado não é editado depois de enviado ao Tiny.
 */
export function useEditarRascunho(urlApi) {
  const [dados, setDados] = useState(null);
  const [erroCarregamento, setErroCarregamento] = useState(null);
  const [pagina, setPagina] = useState(1);

  const [clienteEditado, setClienteEditado] = useState(null);
  const [itensEditados, setItensEditados] = useState(null);
  const [itensOriginais, setItensOriginais] = useState(null);
  const [itensRemovidos, setItensRemovidos] = useState([]);

  const [pedindoConfirmacao, setPedindoConfirmacao] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState(null);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    fetch(urlApi)
      .then(async (r) => {
        const corpo = await r.json();
        if (!r.ok) throw new Error(corpo.erro ?? 'Falha ao carregar o rascunho');
        return corpo;
      })
      .then((corpo) => {
        const itens = (corpo.payload?.nota_fiscal?.itens ?? []).map((i) => ({ ...i.item }));
        setDados(corpo);
        setClienteEditado(corpo.payload?.nota_fiscal?.cliente ?? {});
        setItensEditados(itens);
        setItensOriginais(itens);
      })
      .catch((e) => setErroCarregamento(e.message));
  }, [urlApi]);

  function atualizarCliente(campo, valor) {
    setClienteEditado((atual) => ({ ...atual, [campo]: valor }));
  }

  function atualizarItem(indiceGlobal, campo, valor) {
    setItensEditados((atual) => atual.map((it, idx) => (idx === indiceGlobal ? { ...it, [campo]: valor } : it)));
  }

  function restaurarItens() {
    setItensEditados(itensOriginais);
    setItensRemovidos([]);
  }

  function removerItem(indiceGlobal) {
    const item = itensEditados[indiceGlobal];
    if (!item) return;
    setItensEditados((atual) => atual.filter((_, idx) => idx !== indiceGlobal));
    setItensRemovidos((atual) => [...atual, item]);
  }

  /** Devolve um item removido para a lista de itens da nota. */
  function restaurarItemRemovido(indice) {
    const item = itensRemovidos[indice];
    if (!item) return;
    setItensRemovidos((atual) => atual.filter((_, idx) => idx !== indice));
    setItensEditados((atual) => [...atual, item]);
  }

  async function confirmarRecriacao() {
    setEnviando(true);
    setErroEnvio(null);
    try {
      // Idem à tela de inclusão: parcelas (franquia com boleto) são
      // recalculadas sobre o total corrigido, senão o novo rascunho sairia
      // com os valores do rascunho antigo.
      const payload = {
        nota_fiscal: recalcularParcelas(
          {
            ...dados.payload.nota_fiscal,
            cliente: clienteEditado,
            itens: itensEditados.map((it) => ({
              item: {
                ...it,
                quantidade: Number(it.quantidade || 0),
                valor_unitario: Number(it.valor_unitario || 0).toFixed(2),
              },
            })),
          },
          totalNota
        ),
      };

      const resposta = await fetch(urlApi, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, confirmacaoTeste: true }),
      });

      const corpo = await resposta.json();
      if (!resposta.ok) throw new Error(corpo.erro ?? 'O Tiny recusou a recriação.');
      setResultado(corpo);
      setPedindoConfirmacao(false);
    } catch (e) {
      setErroEnvio(e.message);
    } finally {
      setEnviando(false);
    }
  }

  const carregado = Boolean(dados && itensEditados);
  const totalPaginas = carregado ? Math.max(1, Math.ceil(itensEditados.length / ITENS_POR_PAGINA)) : 1;
  const inicioPagina = (pagina - 1) * ITENS_POR_PAGINA;
  const itensDaPagina = carregado
    ? itensEditados.map((item, indiceGlobal) => ({ item, indiceGlobal })).slice(inicioPagina, inicioPagina + ITENS_POR_PAGINA)
    : [];
  const totalNota = carregado
    ? itensEditados.reduce((soma, it) => soma + Number(it.valor_unitario || 0) * Number(it.quantidade || 0), 0)
    : 0;
  const itensForamEditados = carregado ? JSON.stringify(itensEditados) !== JSON.stringify(itensOriginais) : false;
  const podeSalvar = carregado && !enviando && !resultado && itensEditados.length > 0;

  return {
    dados,
    erroCarregamento,
    pagina,
    setPagina,
    clienteEditado,
    pedindoConfirmacao,
    setPedindoConfirmacao,
    enviando,
    erroEnvio,
    resultado,
    carregado,
    totalPaginas,
    itensDaPagina,
    totalNota,
    itensForamEditados,
    podeSalvar,
    itensRemovidos,
    atualizarCliente,
    atualizarItem,
    removerItem,
    restaurarItemRemovido,
    restaurarItens,
    confirmarRecriacao,
  };
}
