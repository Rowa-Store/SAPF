'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatarDia, somarDias } from '@/lib/datas';
import { montarNossoNumero } from '@/lib/caixa/nossoNumero';
import { baixarPelaExtensao, extensaoInstalada } from '../extensaoCaixa';

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

// Busca dos boletos na CAIXA: parcelas 1, 2, 3… de cada NF, parando depois de
// MAX_FALTAS seguidas sem boleto (o nº de parcelas não é fixo). Uma consulta
// por vez, com pausa, para não martelar o site da CAIXA.
const MAX_PARCELAS = 12;
const MAX_FALTAS = 2;
const PAUSA_MS = 250;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export const SEM_EXTENSAO =
  'Para consultar os boletos, instale a extensão "SAPF — Boletos CAIXA" no Chrome (veja "Como instalar" ao lado do botão) e recarregue a página.';

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
 * "Consultar boletos" (sincronizarCaixa) procura na CAIXA, pela extensão do
 * Chrome, os boletos das NFs da lista e sobe os PDFs achados para o SAPF;
 * "Consultar boletos do mês" (consultarMes) faz o mesmo com o mês inteiro.
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
  // { feitas, total } NFs, durante a consulta.
  const [progressoCaixa, setProgressoCaixa] = useState(null);
  const [caixaCedente, setCaixaCedente] = useState(null);
  const [erroCaixa, setErroCaixa] = useState(null);
  // Cada carga ganha um nº: resposta da CAIXA de uma carga antiga é ignorada.
  const geracao = useRef(0);

  /** Põe os títulos de uma NF em todas as linhas com essa NF. */
  function definirTitulos(nf, titulos) {
    setBoletos((atual) => atual?.map((b) => (nfDaLinha(b) === nf ? { ...b, titulosCaixa: titulos } : b)));
  }

  /**
   * Procura na CAIXA, pela extensão, as parcelas que faltam das NFs destas
   * linhas e sobe cada PDF achado (POST /api/boletos/caixa).
   */
  const sincronizarCaixa = useCallback(
    async (linhas) => {
      const minha = geracao.current;
      const porNf = new Map();
      for (const b of linhas) if (nfDaLinha(b) && nfDaLinha(b) <= 99999) porNf.set(nfDaLinha(b), b.titulosCaixa);
      if (porNf.size === 0) return;
      if (!caixaCedente) return setErroCaixa('CAIXA_CEDENTE não configurado no servidor.');
      if (!(await extensaoInstalada())) return setErroCaixa(SEM_EXTENSAO);

      setConsultandoCaixa(true);
      setErroCaixa(null);
      setProgressoCaixa({ feitas: 0, total: porNf.size, unidade: 'NFs' });
      const falhas = [];
      try {
        let feitas = 0;
        for (const [nf, conhecidos] of porNf) {
          const titulos = [...conhecidos];
          const jaTem = new Set(conhecidos.map((t) => t.nosso_numero));
          try {
            let faltas = 0;
            for (let parcela = 1; parcela <= MAX_PARCELAS && faltas < MAX_FALTAS; parcela++) {
              const nossoNumero = montarNossoNumero(nf, parcela);
              if (jaTem.has(nossoNumero)) {
                faltas = 0;
                continue;
              }
              await esperar(PAUSA_MS);
              if (geracao.current !== minha) return;
              const boleto = await baixarPelaExtensao(caixaCedente, nossoNumero);
              if (!boleto.encontrado) {
                faltas++;
                continue;
              }
              faltas = 0;
              const form = new FormData();
              form.append('arquivo', boleto.pdf, `${nossoNumero}.pdf`);
              form.append('nf', String(nf));
              form.append('parcela', String(parcela));
              const corpo = await lerJson(
                await fetch('/api/boletos/caixa', { method: 'POST', body: form }),
                `Não foi possível gravar a parcela ${parcela}.`
              );
              titulos.push(corpo.titulo);
              titulos.sort((a, b) => (a.parcela ?? 99) - (b.parcela ?? 99));
              if (geracao.current === minha) definirTitulos(nf, [...titulos]);
            }
          } catch (e) {
            falhas.push(`NF ${nf}: ${e.message}`);
          }
          if (geracao.current !== minha) return;
          setProgressoCaixa({ feitas: ++feitas, total: porNf.size, unidade: 'NFs' });
        }
        setErroCaixa(falhas.length ? `Não foi possível consultar a CAIXA:\n${falhas.join('\n')}` : null);
      } finally {
        if (geracao.current === minha) {
          setConsultandoCaixa(false);
          setProgressoCaixa(null);
        }
      }
    },
    [caixaCedente]
  );

  const carregar = useCallback(async ({ cursor = null, busca = '', dia: diaPedido = null } = {}) => {
    geracao.current++;
    setConsultandoCaixa(false);
    setProgressoCaixa(null);
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
      setCaixaCedente(corpo.caixaCedente ?? null);
      setErroCaixa(corpo.erroCaixa ? `Não foi possível ler os boletos da CAIXA: ${corpo.erroCaixa}` : null);
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

  /**
   * "Consultar boletos do mês": junta os pedidos de cada dia do mês do dia na
   * tela (ou do mês atual, numa busca), até hoje, e consulta a CAIXA para
   * todos. Um dia por vez, pela mesma rota da lista (limite do Tiny).
   */
  async function consultarMes() {
    const base = dia ?? diaDeHoje;
    if (!base || consultandoCaixa) return;
    if (!caixaCedente) return setErroCaixa('CAIXA_CEDENTE não configurado no servidor.');
    if (!(await extensaoInstalada())) return setErroCaixa(SEM_EXTENSAO);

    const minha = geracao.current;
    const dias = [];
    for (let d = `${base.slice(0, 8)}01`; d.slice(0, 7) === base.slice(0, 7) && d <= diaDeHoje; d = somarDias(d, 1)) {
      dias.push(d);
    }
    setConsultandoCaixa(true);
    setErroCaixa(null);
    const linhas = [];
    const cortados = [];
    try {
      for (const [i, d] of dias.entries()) {
        setProgressoCaixa({ feitas: i, total: dias.length, unidade: 'dias' });
        const corpo = await lerJson(
          await fetch(`/api/boletos?dia=${d}`),
          `Não foi possível carregar os pedidos de ${formatarDia(d)}.`
        );
        if (geracao.current !== minha) return;
        linhas.push(...corpo.boletos);
        if (corpo.diaCompleto === false) cortados.push(formatarDia(d));
      }
    } catch (e) {
      if (geracao.current === minha) {
        setErroCaixa(e.message);
        setConsultandoCaixa(false);
        setProgressoCaixa(null);
      }
      return;
    }
    await sincronizarCaixa(linhas);
    if (geracao.current !== minha) return;
    setConsultandoCaixa(false);
    setProgressoCaixa(null);
    if (cortados.length) {
      const aviso = `Dias com pedidos demais (lista cortada, alguns pedidos ficaram de fora): ${cortados.join(', ')}.`;
      setErroCaixa((atual) => (atual ? `${atual}\n${aviso}` : aviso));
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
      // NF trocada: os títulos da NF antiga não valem mais; os da nova vêm no
      // próximo "Consultar boletos" (ou recarregando a lista).
      atualizarLinha(b.id, { titulosCaixa: [] });
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
    progressoCaixa,
    erroCaixa,
    sincronizarCaixa,
    consultarMes,
  };
}
