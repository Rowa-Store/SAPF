'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const FILTROS_VAZIOS = {
  soAtacado: true,
  naoEmitidas: false,
  busca: '',
};

async function lerJson(resposta, mensagemPadrao) {
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? mensagemPadrao);
  return corpo;
}

/**
 * /pedidos — tela única de atacado: pedidos do Shopify, o rascunho da nota no
 * Tiny, a emissão e o DANFE, tudo na mesma linha.
 *
 * Por linha há dois estados independentes: a ação em andamento (sempre com
 * confirmação na própria tela antes de gravar — nunca window.confirm, que o
 * navegador pode bloquear) e a conferência da nota no Tiny.
 *
 * Criar o rascunho a partir da linha lê o preview primeiro e mostra os
 * alertas no painel de confirmação: é o mesmo payload que vai para o Tiny.
 * Para ajustar itens ou cliente antes, a conferência completa continua em
 * /pedidos/[id]/rascunho.
 *
 * A lista vem paginada do servidor, 50 pedidos por vez (cursor do Shopify),
 * e a busca roda lá também — carregar tudo de uma vez deixava a tela lenta.
 * "Só atacado" e "não emitidas" filtram a página já carregada.
 *
 * O nº da NF nunca é digitado: vem da nota autorizada no Tiny. Toda linha da
 * página aberta que tem nota no Tiny mas ainda não tem número é conferida
 * sozinha, uma por vez (a API do Tiny tem limite de chamadas por minuto).
 */
export function useAtacado() {
  const [pedidos, setPedidos] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [carregando, setCarregando] = useState(false);
  // Cursor de cada página já aberta (o da 1ª é null) e o da próxima, se houver.
  const [cursores, setCursores] = useState([null]);
  const [proximoCursor, setProximoCursor] = useState(null);
  // Busca que valeu na última carga — a do campo só vale ao aplicar.
  const [buscaAplicada, setBuscaAplicada] = useState('');

  const [permitirEmissao, setPermitirEmissao] = useState(null);
  const [alternandoTrava, setAlternandoTrava] = useState(false);
  const [erroTrava, setErroTrava] = useState(null);

  // { [id]: { fase: 'confirmar-rascunho'|'confirmar-emissao-direta'|'confirmar-emissao'|'enviando'|'erro',
  //           preview?: { carregando, dados?, erro? }, erro? } }
  const [acoes, setAcoes] = useState({});
  // ids já conferidos automaticamente nesta carga — não repete a cada render.
  const conferidos = useRef(new Set());

  const carregar = useCallback(async ({ cursor = null, busca = '' } = {}) => {
    setCarregando(true);
    setErro(null);
    try {
      const query = new URLSearchParams();
      if (cursor) query.set('cursor', cursor);
      if (busca.trim()) query.set('busca', busca.trim());
      const corpo = await lerJson(await fetch(`/api/pedidos?${query}`), 'Falha ao carregar');
      setPedidos(corpo.pedidos);
      setProximoCursor(corpo.proximoCursor);
      setAcoes({});
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

    fetch('/api/config/permitir-emissao')
      .then((r) => r.json())
      .then((d) => setPermitirEmissao(!!d.permitirEmissao))
      .catch(() => setPermitirEmissao(false));
  }, [carregar]);

  async function alternarPermitirEmissao() {
    setAlternandoTrava(true);
    setErroTrava(null);
    try {
      const corpo = await lerJson(
        await fetch('/api/config/permitir-emissao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permitirEmissao: !permitirEmissao }),
        }),
        'Falha ao salvar'
      );
      setPermitirEmissao(corpo.permitirEmissao);
    } catch (e) {
      setErroTrava(e.message);
    } finally {
      setAlternandoTrava(false);
    }
  }

  function atualizarFiltro(campo, valor) {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  }

  // Busca nova, lista nova: volta para a primeira página.
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

  const filtrosAlterados = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VAZIOS);

  function atualizarLinha(id, mudanca) {
    setPedidos((atual) => atual.map((p) => (p.id === id ? { ...p, ...mudanca } : p)));
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

  // Abre a confirmação de criar (só rascunho, ou rascunho + emissão) e já lê
  // o preview, para a pessoa ver os alertas e o total antes de confirmar.
  async function pedirCriacao(p, fase) {
    definirAcao(p.id, { fase, preview: { carregando: true } });
    try {
      const dados = await lerJson(await fetch(`/api/pedidos/${p.id}/preview`), 'Falha ao montar o preview do pedido');
      setAcoes((atual) =>
        atual[p.id]?.fase === fase ? { ...atual, [p.id]: { fase, preview: { carregando: false, dados } } } : atual
      );
    } catch (e) {
      setAcoes((atual) =>
        atual[p.id]?.fase === fase
          ? { ...atual, [p.id]: { fase, preview: { carregando: false, erro: e.message } } }
          : atual
      );
    }
  }

  async function enviarRascunho(p, dados) {
    if (dados.jaProcessado) {
      throw new Error(`Este pedido já tem rascunho no Tiny (nota ${dados.tinyNotaId ?? 'sem id retornado'}).`);
    }
    const corpo = await lerJson(
      await fetch(`/api/pedidos/${p.id}/rascunho`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: dados.payload,
          classificacao: dados.classificacao,
          orderName: dados.pedido.name,
          confirmacaoTeste: true,
        }),
      }),
      'O Tiny recusou a inclusão.'
    );
    atualizarLinha(p.id, { status: 'rascunho_criado', tinyNotaId: corpo.tinyNotaId });
    return corpo;
  }

  async function enviarEmissao(p) {
    const corpo = await lerJson(
      await fetch(`/api/pedidos/${p.id}/emitir`, { method: 'POST' }),
      'O Tiny recusou a emissão.'
    );
    atualizarLinha(p.id, { notaEmitida: true, numeroNf: corpo.numeroNf ?? p.numeroNf });
    return corpo;
  }

  async function executarNaLinha(p, operacao, aoConcluir) {
    definirAcao(p.id, { fase: 'enviando' });
    try {
      const corpo = await operacao();
      definirAcao(p.id, null);
      aoConcluir?.(corpo);
    } catch (e) {
      definirAcao(p.id, { fase: 'erro', erro: e.message });
    }
  }

  function criarRascunho(p) {
    const dados = acoes[p.id]?.preview?.dados;
    if (!dados) return;
    return executarNaLinha(
      p,
      () => enviarRascunho(p, dados),
      (corpo) => setAviso(`Rascunho ${corpo.tinyNotaId ?? ''} do pedido ${p.name} criado no Tiny.`)
    );
  }

  // Se o rascunho sair e a emissão falhar, a linha já fica como "rascunho
  // criado" para tentar de novo só a emissão.
  function criarEEmitir(p) {
    const dados = acoes[p.id]?.preview?.dados;
    if (!dados) return;
    return executarNaLinha(
      p,
      async () => {
        await enviarRascunho(p, dados);
        return enviarEmissao(p);
      },
      (corpo) => setAviso(`Nota do pedido ${p.name} emitida${corpo.numeroNf ? ` — NF nº ${corpo.numeroNf}` : ''}.`)
    );
  }

  function emitir(p) {
    return executarNaLinha(
      p,
      () => enviarEmissao(p),
      (corpo) => setAviso(`Nota do pedido ${p.name} emitida${corpo.numeroNf ? ` — NF nº ${corpo.numeroNf}` : ''}.`)
    );
  }

  const precisaConferir = (p) => !!p.tinyNotaId && p.status === 'rascunho_criado' && (!p.notaEmitida || !p.numeroNf);

  async function conferirNoTiny(p) {
    try {
      const corpo = await lerJson(await fetch(`/api/pedidos/${p.id}/situacao`), 'Falha ao consultar a nota no Tiny.');
      atualizarLinha(p.id, {
        notaEmitida: corpo.notaEmitida || p.notaEmitida,
        numeroNf: corpo.numeroNf ?? p.numeroNf,
      });
    } catch (e) {
      definirAcao(p.id, { fase: 'erro', erro: e.message });
    }
  }

  const visiveis = (pedidos ?? []).filter(
    (p) => (!filtros.soAtacado || p.classificacao !== 'outro') && (!filtros.naoEmitidas || !p.notaEmitida)
  );

  const idsParaConferir = visiveis
    .filter((p) => precisaConferir(p) && !conferidos.current.has(p.id))
    .map((p) => p.id)
    .join(',');

  useEffect(() => {
    if (!idsParaConferir) return;
    const pendentes = visiveis.filter((p) => idsParaConferir.split(',').includes(String(p.id)));
    for (const p of pendentes) conferidos.current.add(p.id);
    (async () => {
      for (const p of pendentes) await conferirNoTiny(p);
    })();
    // Só dispara quando muda o conjunto de linhas a conferir, não a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsParaConferir]);

  return {
    pedidos,
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
    pagina,
    temProxima: !!proximoCursor,
    proximaPagina,
    paginaAnterior,
    permitirEmissao,
    alternandoTrava,
    erroTrava,
    alternarPermitirEmissao,
    acoes,
    definirAcao,
    pedirCriacao,
    criarRascunho,
    criarEEmitir,
    emitir,
  };
}
