'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ITENS_POR_PAGINA } from '@/lib/constants';
import { somarDias } from '@/lib/datas';

export const FILTROS_VAZIOS = {
  naoEmitidas: false,
  busca: '',
};

async function lerJson(resposta, mensagemPadrao) {
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw Object.assign(new Error(corpo.erro ?? mensagemPadrao), { corpo });
  return corpo;
}

/**
 * /transferencias — transferências de estoque do Shopify + nota de cada uma
 * no Tiny, no mesmo formato da tela de atacado (ver useAtacado).
 *
 * Por linha há dois estados independentes: a ação em andamento (sempre com
 * confirmação na própria tela antes de gravar — nunca window.confirm, que o
 * navegador pode bloquear) e a conferência da nota no Tiny.
 *
 * Criar o rascunho a partir da linha lê o preview primeiro e mostra os
 * alertas e o total no painel de confirmação.
 *
 * A lista vem POR DIA do servidor: abre no dia de hoje e a navegação volta
 * um dia por vez. Uma busca não se prende a dia — vem inteira e é paginada
 * aqui, 50 por vez. O filtro "não emitidas" é aplicado na lista já carregada.
 *
 * O nº da NF nunca é digitado: vem da nota autorizada no Tiny. Toda linha da
 * página aberta que tem nota no Tiny mas ainda não tem número é conferida
 * sozinha, uma por vez (a API do Tiny tem limite de chamadas por minuto).
 */
export function useTransferencias() {
  const [transferencias, setTransferencias] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [carregando, setCarregando] = useState(false);
  const [pagina, setPagina] = useState(1);
  // Busca que valeu na última carga — a do campo só vale ao aplicar.
  const [buscaAplicada, setBuscaAplicada] = useState('');
  // Dia aberto (AAAA-MM-DD; null numa busca) e o "hoje" do servidor, que é
  // o de São Paulo — o relógio do navegador pode estar em outro fuso.
  const [dia, setDia] = useState(null);
  const [diaDeHoje, setDiaDeHoje] = useState(null);
  const [listaCompleta, setListaCompleta] = useState(true);

  // { [id]: { fase: 'confirmar-rascunho'|'confirmar-emissao-direta'|'confirmar-emissao'|'confirmar-novo-rascunho'|'enviando'|'erro',
  //           preview?: { carregando, dados?, erro? }, erro? } }
  const [acoes, setAcoes] = useState({});
  // ids já conferidos automaticamente nesta carga — não repete a cada render.
  const conferidos = useRef(new Set());

  const carregar = useCallback(async ({ busca = '', dia: diaPedido = null } = {}) => {
    setCarregando(true);
    setErro(null);
    try {
      const query = new URLSearchParams();
      if (busca.trim()) query.set('busca', busca.trim());
      else if (diaPedido) query.set('dia', diaPedido);
      const corpo = await lerJson(await fetch(`/api/transferencias?${query}`), 'Falha ao carregar');
      setTransferencias(corpo.transferencias);
      setDia(corpo.dia ?? null);
      setDiaDeHoje(corpo.hoje ?? null);
      setListaCompleta(corpo.completo !== false);
      setPagina(1);
      setAcoes({});
      conferidos.current = new Set();
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

  // Busca nova, lista nova (sem busca, hoje).
  async function buscar(busca = filtros.busca) {
    if (await carregar({ busca })) setBuscaAplicada(busca);
  }

  function limparFiltros() {
    setFiltros(FILTROS_VAZIOS);
    if (buscaAplicada) buscar('');
  }

  async function irParaDia(novo) {
    if (!novo || carregando || (diaDeHoje && novo > diaDeHoje)) return;
    if (await carregar({ dia: novo })) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const diaAnterior = () => dia && irParaDia(somarDias(dia, -1));
  const diaSeguinte = () => dia && irParaDia(somarDias(dia, 1));

  const filtrosAlterados = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VAZIOS);

  function atualizarLinha(id, mudanca) {
    setTransferencias((atual) => atual.map((t) => (t.id === id ? { ...t, ...mudanca } : t)));
  }

  function definirAcao(id, estado) {
    setAcoes((atual) => {
      if (!estado) {
        const { [id]: _remover, ...resto } = atual;
        return resto;
      }
      return { ...atual, [id]: estado };
    });
  }

  // Abre a confirmação de criar (só rascunho, rascunho + emissão ou novo
  // rascunho) e já lê o preview, para a pessoa ver os alertas e o total antes
  // de confirmar.
  async function pedirCriacao(t, fase) {
    definirAcao(t.id, { fase, preview: { carregando: true } });
    try {
      const dados = await lerJson(
        await fetch(`/api/transferencias/${t.id}/preview`),
        'Falha ao montar o preview da transferência'
      );
      setAcoes((atual) =>
        atual[t.id]?.fase === fase ? { ...atual, [t.id]: { fase, preview: { carregando: false, dados } } } : atual
      );
    } catch (e) {
      setAcoes((atual) =>
        atual[t.id]?.fase === fase
          ? { ...atual, [t.id]: { fase, preview: { carregando: false, erro: e.message } } }
          : atual
      );
    }
  }

  /** `substituir`: cria um novo rascunho no lugar do que já existe (o antigo fica para remover no Tiny). */
  async function enviarRascunho(t, { substituir = false } = {}) {
    const corpo = await lerJson(
      await fetch(`/api/transferencias/${t.id}/rascunho`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmacaoTeste: true, substituir }),
      }),
      'O Tiny recusou a inclusão.'
    );
    atualizarLinha(t.id, {
      situacaoFiscal: 'rascunho_criado',
      tinyNotaId: corpo.tinyNotaId,
      erro: null,
      erroEm: null,
      ...(corpo.tinyNotasSubstituidas ? { tinyNotasSubstituidas: corpo.tinyNotasSubstituidas } : {}),
    });
    return corpo;
  }

  async function enviarEmissao(t) {
    const corpo = await lerJson(
      await fetch(`/api/transferencias/${t.id}/emitir`, { method: 'POST' }),
      'O Tiny recusou a emissão.'
    );
    atualizarLinha(t.id, { notaEmitida: true, numeroNf: corpo.numeroNf ?? t.numeroNf, erro: null, erroEm: null });
    return corpo;
  }

  async function executarNaLinha(t, operacao, aoConcluir) {
    definirAcao(t.id, { fase: 'enviando' });
    try {
      const corpo = await operacao();
      definirAcao(t.id, null);
      aoConcluir?.(corpo);
    } catch (e) {
      definirAcao(t.id, { fase: 'erro', erro: e.message });
      // O servidor guarda o mesmo erro; aqui só deixa o "Ver erro" na linha sem recarregar.
      atualizarLinha(t.id, { erro: e.message, erroEm: new Date().toISOString() });
    }
  }

  /** Reabre o último erro de rascunho/emissão guardado para a linha. */
  function verErro(t) {
    definirAcao(t.id, { fase: 'erro', erro: t.erro, erroEm: t.erroEm });
  }

  function criarRascunho(t) {
    return executarNaLinha(t, () => enviarRascunho(t), (corpo) => setAviso(corpo.mensagem));
  }

  function novoRascunho(t) {
    return executarNaLinha(t, () => enviarRascunho(t, { substituir: true }), (corpo) => setAviso(corpo.mensagem));
  }

  // Se o rascunho sair e a emissão falhar, a linha já fica como "rascunho
  // criado" para tentar de novo só a emissão.
  function criarEEmitir(t) {
    return executarNaLinha(
      t,
      async () => {
        await enviarRascunho(t);
        return enviarEmissao(t);
      },
      (corpo) => setAviso(`Nota da transferência ${t.name} emitida${corpo.numeroNf ? ` — NF nº ${corpo.numeroNf}` : ''}.`)
    );
  }

  function emitir(t) {
    return executarNaLinha(
      t,
      () => enviarEmissao(t),
      (corpo) => setAviso(`Nota da transferência ${t.name} emitida${corpo.numeroNf ? ` — NF nº ${corpo.numeroNf}` : ''}.`)
    );
  }

  const precisaConferir = (t) => !!t.tinyNotaId && (!t.notaEmitida || !t.numeroNf);

  async function conferirNoTiny(t) {
    try {
      const corpo = await lerJson(
        await fetch(`/api/transferencias/${t.id}/situacao`),
        'Falha ao consultar a nota no Tiny.'
      );
      atualizarLinha(t.id, { notaEmitida: corpo.notaEmitida || t.notaEmitida, numeroNf: corpo.numeroNf ?? t.numeroNf });
    } catch (e) {
      definirAcao(t.id, { fase: 'erro', erro: e.message });
    }
  }

  const visiveis = (transferencias ?? []).filter((t) => !filtros.naoEmitidas || !t.notaEmitida);
  // A lista do dia vem inteira na tela; a da busca, em páginas de 50.
  const totalPaginas = dia ? 1 : Math.max(1, Math.ceil(visiveis.length / ITENS_POR_PAGINA));
  const inicio = (Math.min(pagina, totalPaginas) - 1) * ITENS_POR_PAGINA;
  const visiveisDaPagina = dia ? visiveis : visiveis.slice(inicio, inicio + ITENS_POR_PAGINA);

  const idsParaConferir = visiveisDaPagina
    .filter((t) => precisaConferir(t) && !conferidos.current.has(t.id))
    .map((t) => t.id)
    .join(',');

  useEffect(() => {
    if (!idsParaConferir) return;
    const pendentes = visiveisDaPagina.filter((t) => idsParaConferir.split(',').includes(t.id));
    for (const t of pendentes) conferidos.current.add(t.id);
    (async () => {
      for (const t of pendentes) await conferirNoTiny(t);
    })();
    // Só dispara quando muda o conjunto de linhas a conferir, não a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsParaConferir]);

  function mudarPagina(nova) {
    setPagina(nova);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return {
    transferencias,
    verErro,
    erro,
    aviso,
    setAviso,
    filtros,
    atualizarFiltro,
    limparFiltros,
    filtrosAlterados,
    buscar,
    buscaAplicada,
    carregando,
    visiveis,
    visiveisDaPagina,
    pagina: Math.min(pagina, totalPaginas),
    totalPaginas,
    mudarPagina,
    dia,
    diaDeHoje,
    listaCompleta,
    irParaDia,
    diaAnterior,
    diaSeguinte,
    acoes,
    definirAcao,
    pedirCriacao,
    criarRascunho,
    novoRascunho,
    criarEEmitir,
    emitir,
  };
}
