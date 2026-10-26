'use client';

import { useCallback, useEffect, useState } from 'react';
import { somarDias } from '@/lib/datas';

export const FILTROS_VAZIOS = {
  soPendentes: false,
  busca: '',
};

async function lerJson(resposta, mensagemPadrao) {
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? mensagemPadrao);
  return corpo;
}

/**
 * /boletos — pedidos pagos com boleto, com o status do boleto (emitido ou
 * pendente, marcado à mão) e o nº da NF de cada um.
 *
 * Navegação igual à do atacado (useAtacado): a lista vem POR DIA, abrindo em
 * hoje; uma busca não se prende a dia e vem paginada por cursor.
 *
 * O nº da NF da linha é o digitado na tela, se houver; senão o da nota no
 * Tiny. Na edição, "buscar de novo" confere a nota no Tiny
 * (/api/pedidos/[id]/situacao) e põe o nº no campo, para a pessoa salvar.
 */
export function useBoletos() {
  const [boletos, setBoletos] = useState(null);
  const [erro, setErro] = useState(null);
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [carregando, setCarregando] = useState(false);
  const [cursores, setCursores] = useState([null]);
  const [proximoCursor, setProximoCursor] = useState(null);
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [dia, setDia] = useState(null);
  const [diaDeHoje, setDiaDeHoje] = useState(null);
  const [diaCompleto, setDiaCompleto] = useState(true);
  // { [id]: mensagem } — erro da última gravação de cada linha.
  const [errosLinha, setErrosLinha] = useState({});

  const carregar = useCallback(async ({ cursor = null, busca = '', dia: diaPedido = null } = {}) => {
    setCarregando(true);
    setErro(null);
    try {
      const query = new URLSearchParams();
      if (cursor) query.set('cursor', cursor);
      if (busca.trim()) query.set('busca', busca.trim());
      else if (diaPedido) query.set('dia', diaPedido);
      const corpo = await lerJson(await fetch(`/api/boletos?${query}`), 'Falha ao carregar');
      setBoletos(corpo.boletos);
      setProximoCursor(corpo.proximoCursor);
      setDia(corpo.dia ?? null);
      setDiaDeHoje(corpo.hoje ?? null);
      setDiaCompleto(corpo.diaCompleto !== false);
      setErrosLinha({});
      return true;
    } catch (e) {
      setErro(e.message);
      return false;
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function atualizarFiltro(campo, valor) {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  }

  async function buscar(busca = filtros.busca) {
    if (await carregar({ busca })) {
      setCursores([null]);
      setBuscaAplicada(busca);
    }
  }

  function limparFiltros() {
    setFiltros(FILTROS_VAZIOS);
    if (buscaAplicada) buscar('');
  }

  const pagina = cursores.length;

  async function proximaPagina() {
    if (!proximoCursor || carregando) return;
    const cursor = proximoCursor;
    if (await carregar({ cursor, busca: buscaAplicada })) {
      setCursores((atual) => [...atual, cursor]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function paginaAnterior() {
    if (cursores.length <= 1 || carregando) return;
    const anteriores = cursores.slice(0, -1);
    if (await carregar({ cursor: anteriores[anteriores.length - 1], busca: buscaAplicada })) {
      setCursores(anteriores);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  async function irParaDia(novo) {
    if (!novo || carregando || (diaDeHoje && novo > diaDeHoje)) return;
    if (await carregar({ dia: novo })) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const diaAnterior = () => dia && irParaDia(somarDias(dia, -1));
  const diaSeguinte = () => dia && irParaDia(somarDias(dia, 1));

  const filtrosAlterados = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VAZIOS);

  function atualizarLinha(id, mudanca) {
    setBoletos((atual) => atual.map((b) => (b.id === id ? { ...b, ...mudanca } : b)));
  }

  function definirErroLinha(id, mensagem) {
    setErrosLinha((atual) => {
      const { [id]: _remover, ...resto } = atual;
      return mensagem ? { ...resto, [id]: mensagem } : resto;
    });
  }

  async function gravar(b, campos) {
    definirErroLinha(b.id, null);
    const corpo = await lerJson(
      await fetch(`/api/boletos/${b.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderName: b.name, ...campos }),
      }),
      'Não foi possível salvar o boleto.'
    );
    atualizarLinha(b.id, { emitido: corpo.emitido, numeroNfEditado: corpo.numeroNfEditado });
  }

  /** Troca o status já na tela e volta atrás se o servidor recusar. */
  async function alterarStatus(b, emitido) {
    if (b.emitido === emitido) return;
    atualizarLinha(b.id, { emitido });
    try {
      await gravar(b, { emitido });
    } catch (e) {
      atualizarLinha(b.id, { emitido: b.emitido });
      definirErroLinha(b.id, e.message);
    }
  }

  /** Grava o nº digitado; lança o erro para a edição continuar aberta. */
  async function salvarNumeroNf(b, numeroNf) {
    try {
      await gravar(b, { numeroNf });
    } catch (e) {
      definirErroLinha(b.id, e.message);
      throw e;
    }
  }

  /** Nº da NF conferido agora no Tiny (null se a nota não tem número ainda). */
  async function buscarNumeroNoTiny(b) {
    definirErroLinha(b.id, null);
    try {
      const corpo = await lerJson(await fetch(`/api/pedidos/${b.id}/situacao`), 'Falha ao consultar a nota no Tiny.');
      if (corpo.numeroNf) atualizarLinha(b.id, { numeroNfTiny: corpo.numeroNf, notaEmitida: corpo.notaEmitida });
      return corpo.numeroNf ?? null;
    } catch (e) {
      definirErroLinha(b.id, e.message);
      return null;
    }
  }

  const visiveis = (boletos ?? []).filter((b) => !filtros.soPendentes || !b.emitido);

  return {
    boletos,
    erro,
    errosLinha,
    definirErroLinha,
    filtros,
    atualizarFiltro,
    limparFiltros,
    filtrosAlterados,
    buscar,
    buscaAplicada,
    carregando,
    visiveis,
    pagina,
    dia,
    diaDeHoje,
    diaCompleto,
    irParaDia,
    diaAnterior,
    diaSeguinte,
    temProxima: !!proximoCursor,
    proximaPagina,
    paginaAnterior,
    alterarStatus,
    salvarNumeroNf,
    buscarNumeroNoTiny,
  };
}
