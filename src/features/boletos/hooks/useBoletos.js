'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

/** Nº da NF da linha: o digitado na tela vale sobre o do Tiny. */
export function nfDaLinha(b) {
  const nf = Number(b.numeroNfEditado ?? b.numeroNfTiny);
  return Number.isInteger(nf) && nf > 0 ? nf : null;
}

// Limite do POST /api/boletos/caixa por requisição.
const NFS_POR_CONSULTA = 10;

/**
 * /boletos — pedidos pagos com boleto, com o status do boleto (emitido ou
 * pendente, marcado à mão) e o nº da NF de cada um.
 *
 * Navegação igual à do atacado (useAtacado): a lista vem POR DIA, abrindo em
 * hoje; uma busca não se prende a dia e vem paginada por cursor.
 *
 * O nº da NF da linha é o digitado na tela, se houver; senão o da nota no
 * Tiny (gravado em notas_processadas).
 *
 * Depois de cada carga, procura na CAIXA os boletos das NFs da lista
 * (sincronizarCaixa) e atualiza os títulos de cada linha.
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
  const [consultandoCaixa, setConsultandoCaixa] = useState(false);
  const [erroCaixa, setErroCaixa] = useState(null);
  // Resumo da última importação do arquivo da CAIXA (ver importarConsultaCaixa).
  const [resumoImportacao, setResumoImportacao] = useState(null);
  const [importando, setImportando] = useState(false);
  // Cada carga ganha um nº: resposta da CAIXA de uma carga antiga é ignorada.
  const geracao = useRef(0);

  /** Procura na CAIXA os boletos destas NFs e põe os títulos nas linhas. */
  const sincronizarCaixa = useCallback(async (nfs) => {
    const minha = geracao.current;
    const pendentes = [...new Set(nfs.filter(Boolean))];
    if (pendentes.length === 0) return;
    setConsultandoCaixa(true);
    const falhas = [];
    try {
      for (let i = 0; i < pendentes.length; i += NFS_POR_CONSULTA) {
        const corpo = await lerJson(
          await fetch('/api/boletos/caixa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nfs: pendentes.slice(i, i + NFS_POR_CONSULTA) }),
          }),
          'Não foi possível consultar a CAIXA.'
        );
        if (geracao.current !== minha) return;
        falhas.push(...Object.keys(corpo.erros ?? {}));
        setBoletos((atual) =>
          atual?.map((b) => {
            const titulos = corpo.titulos[nfDaLinha(b)];
            return titulos ? { ...b, titulosCaixa: titulos } : b;
          })
        );
      }
      setErroCaixa(falhas.length ? `Não foi possível consultar a CAIXA para a(s) NF(s) ${falhas.join(', ')}.` : null);
    } catch (e) {
      if (geracao.current === minha) setErroCaixa(e.message);
    } finally {
      if (geracao.current === minha) setConsultandoCaixa(false);
    }
  }, []);

  const carregar = useCallback(async ({ cursor = null, busca = '', dia: diaPedido = null } = {}) => {
    geracao.current++;
    setConsultandoCaixa(false);
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
      setErroCaixa(corpo.erroCaixa ? `Não foi possível ler os boletos da CAIXA: ${corpo.erroCaixa}` : null);
      if (!corpo.erroCaixa) sincronizarCaixa(corpo.boletos.map(nfDaLinha));
      return true;
    } catch (e) {
      setErro(e.message);
      return false;
    } finally {
      setCarregando(false);
    }
  }, [sincronizarCaixa]);

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

  /** Recarrega a lista que está na tela (mesmo dia, ou mesma busca e página). */
  function recarregar() {
    return dia ? carregar({ dia }) : carregar({ cursor: cursores[cursores.length - 1], busca: buscaAplicada });
  }

  /**
   * Importa o arquivo da Consulta de Títulos do e-Cobrança (situação, valor,
   * vencimento de cada título) e recarrega a lista com os dados novos.
   */
  async function importarConsultaCaixa(arquivo) {
    setImportando(true);
    setResumoImportacao(null);
    try {
      const form = new FormData();
      form.append('arquivo', arquivo);
      const corpo = await lerJson(
        await fetch('/api/boletos/caixa/importar', { method: 'POST', body: form }),
        'Não foi possível importar o arquivo.'
      );
      setResumoImportacao({ arquivo: arquivo.name, ...corpo });
      await recarregar();
    } catch (e) {
      setResumoImportacao({ arquivo: arquivo.name, erro: e.message });
    } finally {
      setImportando(false);
    }
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
    if (campos.numeroNf !== undefined) {
      // NF trocada: os títulos da NF antiga não valem mais.
      const nf = nfDaLinha({ ...b, numeroNfEditado: corpo.numeroNfEditado });
      atualizarLinha(b.id, { titulosCaixa: [] });
      sincronizarCaixa([nf]);
    }
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

  /**
   * Sobe os PDFs do boleto, um por requisição (limite de corpo da Vercel); o
   * servidor já marca como emitido. A linha é atualizada a cada arquivo, então
   * um erro no meio não perde os que já subiram.
   */
  async function enviarPdfs(b, arquivos) {
    definirErroLinha(b.id, null);
    for (const arquivo of arquivos) {
      const form = new FormData();
      form.append('arquivo', arquivo);
      form.append('orderName', b.name);
      try {
        const corpo = await lerJson(
          await fetch(`/api/boletos/${b.id}/pdf`, { method: 'POST', body: form }),
          `Não foi possível enviar "${arquivo.name}".`
        );
        atualizarLinha(b.id, {
          emitido: corpo.emitido,
          numeroNfEditado: corpo.numeroNfEditado,
          pdfs: corpo.pdfs,
          temPdf: corpo.temPdf,
        });
      } catch (e) {
        definirErroLinha(b.id, e.message);
        return;
      }
    }
  }

  /** Remove um PDF do boleto; o status fica como está. */
  async function removerPdf(b, pdf) {
    definirErroLinha(b.id, null);
    try {
      const corpo = await lerJson(
        await fetch(`/api/boletos/${b.id}/pdf?pdf=${pdf.id}`, { method: 'DELETE' }),
        `Não foi possível remover "${pdf.nome}".`
      );
      atualizarLinha(b.id, { pdfs: corpo.pdfs, temPdf: corpo.temPdf });
    } catch (e) {
      definirErroLinha(b.id, e.message);
    }
  }

  // Pendente: nem marcado à mão, nem com título achado na CAIXA.
  const visiveis = (boletos ?? []).filter((b) => !filtros.soPendentes || (!b.emitido && b.titulosCaixa.length === 0));

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
    enviarPdfs,
    removerPdf,
    consultandoCaixa,
    erroCaixa,
    sincronizarCaixa,
    importando,
    importarConsultaCaixa,
    resumoImportacao,
    fecharResumoImportacao: () => setResumoImportacao(null),
  };
}
