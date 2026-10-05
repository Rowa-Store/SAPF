'use client';

import { useEffect, useState } from 'react';
import { ITENS_POR_PAGINA } from '@/lib/constants';
import { lerDescontoExtra, lerMarkup, valorComMarkup } from '@/lib/fiscal/markup';
import { recalcularParcelas } from '@/lib/fiscal/pagamento';

/** O preço de varejo anda junto com o item na tela, mas não vai para o Tiny. */
function semPrecoVarejo({ preco_varejo, ...item }) {
  return item;
}

/** Refaz o valor unitário a partir do preço do Shopify, com o markup e o
 *  desconto extra da nota. Item sem preço de varejo conhecido (valor 0 no
 *  Shopify) fica como está. */
function aplicarMarkupNoItem(item, markup, descontoExtra) {
  if (!(item.preco_varejo > 0)) return item;
  return { ...item, valor_unitario: valorComMarkup(item.preco_varejo, markup, descontoExtra).toFixed(2) };
}

/** /pedidos/[id]/rascunho — grava o rascunho da nota no Tiny pela primeira vez. */
export function useIncluirRascunho(id) {
  const [dados, setDados] = useState(null);
  const [erroCarregamento, setErroCarregamento] = useState(null);
  const [pagina, setPagina] = useState(1);

  // Cópias editáveis do payload — dados/itensOriginais continuam intactos
  // para permitir "restaurar" e para montar o pedido/alertas na tela.
  const [clienteEditado, setClienteEditado] = useState(null);
  const [itensEditados, setItensEditados] = useState(null);
  const [itensOriginais, setItensOriginais] = useState(null);
  const [itensRemovidos, setItensRemovidos] = useState([]);

  // Markup em uso nos itens — começa no padrão da classificação e pode ser
  // trocado para a nota inteira (ver markup.js).
  const [markup, setMarkup] = useState(null);
  const [markupOriginal, setMarkupOriginal] = useState(null);
  // Desconto extra em %, sobre o valor que já saiu do markup — começa em 0
  // e também vale para a nota inteira (ver markup.js).
  const [descontoExtra, setDescontoExtra] = useState(0);

  const [pedindoConfirmacao, setPedindoConfirmacao] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState(null);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    fetch(`/api/pedidos/${id}/preview`)
      .then(async (r) => {
        const corpo = await r.json();
        if (!r.ok) throw new Error(corpo.erro ?? 'Falha ao montar o preview');
        return corpo;
      })
      .then((corpo) => {
        const precos = corpo.precosVarejo ?? [];
        const itens = (corpo.payload?.nota_fiscal?.itens ?? []).map((i, indice) => ({
          ...i.item,
          preco_varejo: precos[indice] ?? 0,
        }));

        setDados(corpo);
        setClienteEditado(corpo.payload?.nota_fiscal?.cliente ?? {});
        setItensEditados(itens);
        setItensOriginais(itens);
        setMarkup(corpo.markup);
        setMarkupOriginal(corpo.markup);
      })
      .catch((e) => setErroCarregamento(e.message));
  }, [id]);

  function atualizarCliente(campo, valor) {
    setClienteEditado((atual) => ({ ...atual, [campo]: valor }));
  }

  function atualizarItem(indiceGlobal, campo, valor) {
    setItensEditados((atual) => atual.map((it, idx) => (idx === indiceGlobal ? { ...it, [campo]: valor } : it)));
  }

  function restaurarItens() {
    setItensEditados(itensOriginais);
    setItensRemovidos([]);
    setMarkup(markupOriginal);
    setDescontoExtra(0);
  }

  /**
   * Troca o markup de TODOS os itens da nota, inclusive os removidos (que
   * voltam com o markup certo se forem restaurados). Valor unitário editado à
   * mão é sobrescrito — o markup vale para a nota inteira. O desconto extra
   * em uso continua valendo por cima do novo markup.
   * Devolve false quando o valor digitado não é um markup válido.
   */
  function alterarMarkup(texto) {
    const novo = lerMarkup(texto);
    if (novo === null) return false;
    setMarkup(novo);
    reaplicarNosItens(novo, descontoExtra);
    return true;
  }

  /**
   * Troca o desconto extra (%) de TODOS os itens, com as mesmas regras do
   * markup: sobrescreve valor editado à mão e alcança os removidos. Vazio
   * zera o desconto. Devolve false quando o valor não é um percentual válido.
   */
  function alterarDescontoExtra(texto) {
    const novo = lerDescontoExtra(texto);
    if (novo === null) return false;
    setDescontoExtra(novo);
    reaplicarNosItens(markup, novo);
    return true;
  }

  function reaplicarNosItens(novoMarkup, novoDesconto) {
    setItensEditados((atual) => atual.map((it) => aplicarMarkupNoItem(it, novoMarkup, novoDesconto)));
    setItensRemovidos((atual) => atual.map((it) => aplicarMarkupNoItem(it, novoMarkup, novoDesconto)));
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

  async function confirmarInclusao() {
    setEnviando(true);
    setErroEnvio(null);
    try {
      // As parcelas (franquia com boleto) foram calculadas sobre o total do
      // pedido original — se itens foram editados ou removidos aqui, os
      // valores precisam ser refeitos antes de enviar.
      const payload = {
        nota_fiscal: recalcularParcelas(
          {
            ...dados.payload.nota_fiscal,
            cliente: clienteEditado,
            itens: itensEditados.map((it) => ({
              item: {
                ...semPrecoVarejo(it),
                quantidade: Number(it.quantidade || 0),
                valor_unitario: Number(it.valor_unitario || 0).toFixed(2),
              },
            })),
          },
          totalNota
        ),
      };

      const resposta = await fetch(`/api/pedidos/${id}/rascunho`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload,
          classificacao: dados.classificacao,
          orderName: dados.pedido.name,
          confirmacaoTeste: true,
        }),
      });

      const corpo = await resposta.json();
      if (!resposta.ok) throw new Error(corpo.erro ?? 'O Tiny recusou a inclusão.');
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
  const podeIncluir = carregado && !dados.jaProcessado && !enviando && !resultado && itensEditados.length > 0;

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
    podeIncluir,
    itensRemovidos,
    markup,
    markupOriginal,
    alterarMarkup,
    descontoExtra,
    alterarDescontoExtra,
    atualizarCliente,
    atualizarItem,
    removerItem,
    restaurarItemRemovido,
    restaurarItens,
    confirmarInclusao,
  };
}
