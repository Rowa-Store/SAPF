'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ITENS_POR_PAGINA } from '@/lib/constants';
import { intervaloDoMes } from '@/lib/datas';

export const FILTROS_VAZIOS = {
  origem: '',
  destino: '',
  excluir: '',
  de: '',
  ate: '',
  nf: '',
  nome: '',
  rascunhos: false,
  naoEmitidas: false,
};

// A tela abre filtrada nas transferências que saem do CD.
const ORIGEM_PADRAO = 'Rowa Centro de Distribuição 1';

function paraQuery(filtros) {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor === true) busca.set(chave, '1');
    else if (valor) busca.set(chave, valor);
  }
  return busca.toString();
}

async function lerJson(resposta, mensagemPadrao) {
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? mensagemPadrao);
  return corpo;
}

/**
 * /transferencias — transferências de estoque do Shopify + nota de cada uma no Tiny.
 *
 * Por linha há três estados independentes: os produtos (preview da nota,
 * carregado sob demanda), a ação em andamento (rascunho/emissão, sempre com
 * confirmação antes) e a conferência da nota no Tiny.
 *
 * O nº da NF nunca é digitado: vem da nota autorizada no Tiny. Toda linha da
 * página aberta que tem nota no Tiny mas ainda não tem número é conferida
 * sozinha, uma por vez (a API do Tiny tem limite de chamadas por minuto).
 *
 * A emissão em lote (todas com rascunho, ou as selecionadas) roda uma
 * transferência por vez e reaproveita o estado de ação da linha: a que falha
 * mostra o erro nela mesma, e o lote segue para a próxima.
 */
export function useTransferencias() {
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [transferencias, setTransferencias] = useState(null);
  const [locais, setLocais] = useState([]);
  const [truncado, setTruncado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);

  // { [id]: { aberto, carregando, dados?, erro? } }
  const [produtos, setProdutos] = useState({});
  // { [id]: { fase: 'confirmar-rascunho'|'confirmar-emissao'|'confirmar-emissao-direta'|'enviando'|'erro', erro? } }
  const [acoes, setAcoes] = useState({});
  // ids com conferência no Tiny em andamento
  const [conferindo, setConferindo] = useState(() => new Set());
  // ids já conferidos automaticamente nesta carga — não repete a cada render.
  const conferidos = useRef(new Set());
  const [pagina, setPagina] = useState(1);
  // ids marcados para "Emitir selecionadas" — vale entre páginas.
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  // { feitas, total } enquanto um lote de emissão roda.
  const [lote, setLote] = useState(null);
  // { lista, descricao, semRascunho, jaEmitidas } enquanto o lote espera confirmação.
  const [loteAConfirmar, setLoteAConfirmar] = useState(null);

  const carregar = useCallback(async (f, extra = '') => {
    setCarregando(true);
    setErro(null);
    try {
      const corpo = await lerJson(await fetch(`/api/transferencias?${paraQuery(f)}${extra}`), 'Falha ao carregar');
      setTransferencias(corpo.transferencias);
      conferidos.current = new Set();
      // Filtro novo, lista nova: a página antiga pode nem existir mais.
      setPagina(1);
      setSelecionadas(new Set());
      setLocais(corpo.locais);
      setTruncado(corpo.truncado);
      return corpo;
    } catch (e) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar(FILTROS_VAZIOS, `&origemNome=${encodeURIComponent(ORIGEM_PADRAO)}`).then((corpo) => {
      // Só aplica se o usuário ainda não escolheu outra origem enquanto carregava.
      if (corpo?.origemId) setFiltros((atual) => (atual.origem ? atual : { ...atual, origem: corpo.origemId }));
    });
  }, [carregar]);

  function atualizarFiltro(campo, valor) {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  }

  function aplicarFiltros() {
    carregar(filtros);
  }

  /** Preenche "de"–"ate" com o mês AAAA-MM inteiro e já filtra. Vazio limpa as datas. */
  function aplicarMes(mes) {
    const novos = { ...filtros, ...(mes ? intervaloDoMes(mes) : { de: '', ate: '' }) };
    setFiltros(novos);
    carregar(novos);
  }

  function limparFiltros() {
    setFiltros(FILTROS_VAZIOS);
    carregar(FILTROS_VAZIOS);
  }

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

  async function carregarProdutos(id) {
    setProdutos((atual) => ({ ...atual, [id]: { aberto: true, carregando: true } }));
    try {
      const dados = await lerJson(await fetch(`/api/transferencias/${id}/preview`), 'Falha ao ler a transferência');
      setProdutos((atual) => ({ ...atual, [id]: { aberto: true, carregando: false, dados } }));
    } catch (e) {
      setProdutos((atual) => ({ ...atual, [id]: { aberto: true, carregando: false, erro: e.message } }));
    }
  }

  function alternarProdutos(id) {
    const atual = produtos[id];
    if (atual?.aberto) {
      setProdutos((p) => ({ ...p, [id]: { ...atual, aberto: false } }));
    } else if (atual?.dados) {
      setProdutos((p) => ({ ...p, [id]: { ...atual, aberto: true } }));
    } else {
      carregarProdutos(id);
    }
  }

  /**
   * `substituir`: cria um novo rascunho no lugar do que já existe (o antigo fica para remover no Tiny).
   * `reemitir`: idem, mas por cima de uma nota já emitida — a linha volta a "não emitida".
   */
  async function enviarRascunho(t, { substituir = false, reemitir = false } = {}) {
    const corpo = await lerJson(
      await fetch(`/api/transferencias/${t.id}/rascunho`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmacaoTeste: true, substituir, reemitir }),
      }),
      'O Tiny recusou a inclusão.'
    );
    atualizarLinha(t.id, {
      situacaoFiscal: 'rascunho_criado',
      tinyNotaId: corpo.tinyNotaId,
      ...(reemitir ? { notaEmitida: false, numeroNf: null } : {}),
      ...(corpo.tinyNotasSubstituidas ? { tinyNotasSubstituidas: corpo.tinyNotasSubstituidas } : {}),
    });
    return corpo;
  }

  async function enviarEmissao(t) {
    const corpo = await lerJson(
      await fetch(`/api/transferencias/${t.id}/emitir`, { method: 'POST' }),
      'O Tiny recusou a emissão.'
    );
    atualizarLinha(t.id, { notaEmitida: true, numeroNf: corpo.numeroNf ?? t.numeroNf });
    return corpo;
  }

  // Cria o rascunho quando ainda não existe e emite. Se o rascunho sair e a
  // emissão falhar, a linha já fica como "rascunho criado" para tentar de novo.
  async function rascunhoEEmissao(t) {
    if (t.situacaoFiscal !== 'rascunho_criado') await enviarRascunho(t);
    return enviarEmissao(t);
  }

  // Nota já emitida: cria um novo rascunho por cima e emite a nota nova. Se a
  // emissão falhar, a linha fica com o rascunho novo, pronta para "Emitir nota".
  async function reemissao(t) {
    await enviarRascunho(t, { reemitir: true });
    return enviarEmissao(t);
  }

  /** O que "emitir" significa para a linha: reemitir se já emitida, senão criar (se faltar) e emitir. */
  const operacaoDeEmissao = (t) => (t.notaEmitida ? reemissao : rascunhoEEmissao);

  async function executarNaLinha(t, operacao, aoConcluir) {
    definirAcao(t.id, { fase: 'enviando' });
    try {
      const corpo = await operacao(t);
      definirAcao(t.id, null);
      aoConcluir?.(corpo);
      return true;
    } catch (e) {
      definirAcao(t.id, { fase: 'erro', erro: e.message });
      return false;
    }
  }

  function criarRascunho(t) {
    return executarNaLinha(t, enviarRascunho, (corpo) => setAviso(corpo.mensagem));
  }

  function novoRascunho(t) {
    return executarNaLinha(t, (linha) => enviarRascunho(linha, { substituir: true }), (corpo) => setAviso(corpo.mensagem));
  }

  function reemitir(t) {
    return executarNaLinha(t, reemissao, (corpo) =>
      setAviso(
        `Transferência ${t.name} reemitida${corpo.numeroNf ? ` — NF nº ${corpo.numeroNf}` : ''}. ` +
          'Cancele a nota anterior à mão no Tiny.'
      )
    );
  }

  function emitir(t) {
    return executarNaLinha(t, enviarEmissao);
  }

  function emitirDireto(t) {
    return executarNaLinha(t, rascunhoEEmissao, (corpo) =>
      setAviso(`Nota da transferência ${t.name} emitida${corpo.numeroNf ? ` — NF nº ${corpo.numeroNf}` : ''}.`)
    );
  }

  const podeEmitir = (t) => !t.notaEmitida && t.status !== 'CANCELED';
  // Já emitidas também podem ser marcadas, para reemitir em lote — mas só uma a
  // uma: "emitir todas" e o "marcar a página" continuam ignorando as emitidas.
  const podeSelecionar = (t) => t.status !== 'CANCELED';
  const comRascunho = (transferencias ?? []).filter((t) => podeEmitir(t) && t.situacaoFiscal === 'rascunho_criado');
  const selecionadasEmitiveis = (transferencias ?? []).filter((t) => podeSelecionar(t) && selecionadas.has(t.id));

  function alternarSelecao(id) {
    setSelecionadas((atual) => {
      const nova = new Set(atual);
      if (nova.has(id)) nova.delete(id);
      else nova.add(id);
      return nova;
    });
  }

  function selecionarVarias(ids, marcar) {
    setSelecionadas((atual) => {
      const nova = new Set(atual);
      for (const id of ids) {
        if (marcar) nova.add(id);
        else nova.delete(id);
      }
      return nova;
    });
  }

  // A confirmação é um painel na própria tela, não window.confirm: o navegador
  // pode bloquear as caixas de diálogo da página, e aí o confirm devolve false
  // na hora — o botão parecia não fazer nada.
  function pedirConfirmacaoDoLote(lista, descricao) {
    if (lista.length === 0 || lote) return;
    setLoteAConfirmar({
      lista,
      descricao,
      semRascunho: lista.filter((t) => !t.notaEmitida && t.situacaoFiscal !== 'rascunho_criado').length,
      jaEmitidas: lista.filter((t) => t.notaEmitida).length,
    });
  }

  function cancelarLote() {
    setLoteAConfirmar(null);
  }

  // Uma confirmação só vale para o lote inteiro, inclusive para as reemissões.
  async function confirmarLote() {
    if (!loteAConfirmar || lote) return;
    const { lista } = loteAConfirmar;
    setLoteAConfirmar(null);
    setErro(null);
    setLote({ feitas: 0, total: lista.length });
    const falhas = [];
    for (const [i, t] of lista.entries()) {
      if (await executarNaLinha(t, operacaoDeEmissao(t))) selecionarVarias([t.id], false);
      else falhas.push(t.name);
      setLote({ feitas: i + 1, total: lista.length });
    }
    setLote(null);
    const emitidas = lista.length - falhas.length;
    setAviso(
      `${emitidas} nota(s) emitida(s).` +
        (falhas.length ? ` Falharam ${falhas.length}: ${falhas.join(', ')} — veja o erro em cada linha.` : '')
    );
  }

  function emitirTodasComRascunho() {
    return pedirConfirmacaoDoLote(comRascunho, 'transferências com rascunho da lista filtrada (todas as páginas)');
  }

  function emitirSelecionadas() {
    return pedirConfirmacaoDoLote(selecionadasEmitiveis, 'transferências selecionadas');
  }

  const precisaConferir = (t) => !!t.tinyNotaId && (!t.notaEmitida || !t.numeroNf);

  async function conferirNoTiny(t) {
    setConferindo((atual) => new Set(atual).add(t.id));
    try {
      const corpo = await lerJson(
        await fetch(`/api/transferencias/${t.id}/situacao`),
        'Falha ao consultar a nota no Tiny.'
      );
      atualizarLinha(t.id, { notaEmitida: corpo.notaEmitida || t.notaEmitida, numeroNf: corpo.numeroNf ?? t.numeroNf });
    } catch (e) {
      definirAcao(t.id, { fase: 'erro', erro: e.message });
    } finally {
      setConferindo((atual) => {
        const nova = new Set(atual);
        nova.delete(t.id);
        return nova;
      });
    }
  }

  const totalPaginas = Math.max(1, Math.ceil((transferencias?.length ?? 0) / ITENS_POR_PAGINA));
  const inicio = (pagina - 1) * ITENS_POR_PAGINA;
  const transferenciasDaPagina = (transferencias ?? []).slice(inicio, inicio + ITENS_POR_PAGINA);

  const idsParaConferir = transferenciasDaPagina
    .filter((t) => precisaConferir(t) && !conferidos.current.has(t.id))
    .map((t) => t.id)
    .join(',');

  useEffect(() => {
    if (!idsParaConferir) return;
    const pendentes = transferenciasDaPagina.filter((t) => idsParaConferir.split(',').includes(t.id));
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
    pagina,
    totalPaginas,
    mudarPagina,
    transferenciasDaPagina,
    filtros,
    atualizarFiltro,
    aplicarFiltros,
    aplicarMes,
    limparFiltros,
    filtrosAlterados,
    transferencias,
    locais,
    truncado,
    carregando,
    erro,
    aviso,
    setAviso,
    produtos,
    alternarProdutos,
    acoes,
    definirAcao,
    conferindo,
    precisaConferir,
    conferirNoTiny,
    criarRascunho,
    novoRascunho,
    emitir,
    emitirDireto,
    reemitir,
    podeEmitir,
    podeSelecionar,
    selecionadas,
    alternarSelecao,
    selecionarVarias,
    comRascunho,
    selecionadasEmitiveis,
    lote,
    loteAConfirmar,
    confirmarLote,
    cancelarLote,
    emitirTodasComRascunho,
    emitirSelecionadas,
  };
}
