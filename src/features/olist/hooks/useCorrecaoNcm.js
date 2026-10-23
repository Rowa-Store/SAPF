'use client';

import { useEffect, useRef, useState } from 'react';

// Correção geral de NCM da Olist, em duas etapas (como useLimpezaGtin):
//
//   1. procurar — lê a lista inteira de produtos da Olist, 100 por página, e
//      junta os que têm regra de NCM (com o NCM certo) e os sem regra. Só lê.
//   2. corrigir — um produto por requisição: lê o NCM gravado e, se estiver
//      diferente do da regra, grava e confere relendo.
//
// Pausa entre as requisições; se o Tiny recusar por limite de chamadas
// (429), espera e tenta de novo. Dá para pausar e continuar — o progresso
// fica guardado neste navegador.
const PAUSA_ENTRE_CHAMADAS_MS = 1500;
const ESPERA_LIMITE_S = 60;
const SALVAR_A_CADA_MS = 2000;
const CHAVE_GUARDADA = 'sapf:correcao-ncm-olist';

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

function ler() {
  try {
    return JSON.parse(window.localStorage.getItem(CHAVE_GUARDADA) ?? 'null');
  } catch {
    return null;
  }
}

function gravar(valor) {
  try {
    window.localStorage.setItem(CHAVE_GUARDADA, JSON.stringify(valor));
  } catch {
    // Sem localStorage: só não fica lembrado.
  }
}

const PROCURA_NOVA = () => ({ pagina: 1, paginas: null, lidos: 0, concluida: false, inicio: new Date().toISOString() });

/** /olist/ncm — procura e corrige o NCM de todos os produtos da Olist. */
export function useCorrecaoNcm() {
  // parado | procurando | corrigindo | pausando
  const [estado, setEstado] = useState('parado');
  // Item sendo tratado agora: { texto, segundos? }
  const [atual, setAtual] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [, setVersaoDaTela] = useState(0);

  // procura: onde a leitura da lista parou; itens: os com regra, na ordem da
  // lista; semRegra: os sem regra (só para mostrar); feitos: id ->
  // { estado: corrigido|ja_certo|sem_regra|erro, de?, para?, erro? }.
  const dados = useRef({ procura: null, itens: [], semRegra: [], feitos: {} });
  const pausar = useRef(false);
  const ultimoSalvo = useRef(0);

  function redesenhar(salvarAgora = false) {
    setVersaoDaTela((v) => v + 1);
    if (!salvarAgora && Date.now() - ultimoSalvo.current < SALVAR_A_CADA_MS) return;
    ultimoSalvo.current = Date.now();
    gravar(dados.current);
  }

  useEffect(() => {
    const g = ler();
    if (g?.procura) {
      dados.current = { procura: g.procura, itens: g.itens ?? [], semRegra: g.semRegra ?? [], feitos: g.feitos ?? {} };
      setVersaoDaTela((v) => v + 1);
    }
  }, []);

  /** Espera o limite do Tiny contando os segundos. false se pausaram no meio. */
  async function esperarLimite(texto) {
    for (let s = ESPERA_LIMITE_S; s > 0; s -= 1) {
      if (pausar.current) return false;
      setAtual({ texto, segundos: s });
      await esperar(1000);
    }
    return true;
  }

  /** fetch que espera e repete enquanto o Tiny recusar por limite. null se pausaram. */
  async function chamar(url, opcoes, texto) {
    for (;;) {
      setAtual({ texto });
      let resposta;
      try {
        resposta = await fetch(url, opcoes);
      } catch (e) {
        return { erro: `Falha de rede: ${e.message}` };
      }
      if (resposta.status === 429) {
        if (!(await esperarLimite(texto))) return null;
        continue;
      }
      const corpo = await resposta.json().catch(() => ({}));
      return resposta.ok ? { corpo } : { erro: corpo.erro ?? `Falha (${resposta.status})` };
    }
  }

  async function procurar() {
    const d = dados.current;
    pausar.current = false;
    setErro(null);
    setEstado('procurando');
    const p = d.procura;
    while (p.paginas == null || p.pagina <= p.paginas) {
      if (pausar.current) break;
      const r = await chamar(
        `/api/olist/ncm?${new URLSearchParams({ pagina: String(p.pagina) })}`,
        undefined,
        `Lendo a lista de produtos da Olist — página ${p.pagina}${p.paginas ? ` de ${p.paginas}` : ''}`
      );
      if (!r) break;
      if (r.erro) {
        setErro(`Não deu para ler a lista de produtos da Olist: ${r.erro}`);
        break;
      }
      const conhecidos = new Set([...d.itens, ...d.semRegra].map((i) => i.id));
      d.itens = [...d.itens, ...r.corpo.comRegra.filter((i) => !conhecidos.has(i.id))];
      d.semRegra = [...d.semRegra, ...r.corpo.semRegra.filter((i) => !conhecidos.has(i.id))];
      p.paginas = r.corpo.paginas;
      p.lidos += r.corpo.lidos;
      p.pagina += 1;
      redesenhar(true);
      if (p.pagina <= p.paginas) await esperar(PAUSA_ENTRE_CHAMADAS_MS);
    }
    p.concluida = p.paginas != null && p.pagina > p.paginas;
    setAtual(null);
    redesenhar(true);
    setEstado('parado');
  }

  /** Começa a procura do zero (esquece o que já foi feito). */
  function iniciar() {
    dados.current = { procura: PROCURA_NOVA(), itens: [], semRegra: [], feitos: {} };
    setAviso(null);
    procurar();
  }

  /** Confere e corrige, um por vez, os itens que ainda não foram feitos. */
  async function corrigir() {
    const d = dados.current;
    pausar.current = false;
    setErro(null);
    setAviso(null);
    setEstado('corrigindo');
    let corrigidos = 0;
    let comErro = 0;
    let primeira = true;
    for (const item of d.itens) {
      if (pausar.current) break;
      const feito = d.feitos[item.id];
      if (feito && feito.estado !== 'erro') continue;
      if (!primeira) await esperar(PAUSA_ENTRE_CHAMADAS_MS);
      primeira = false;
      const r = await chamar(
        '/api/olist/ncm',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) },
        `Conferindo “${item.nome}”`
      );
      if (!r) break;
      const { de, para } = r.corpo ?? {};
      if (r.erro) {
        comErro += 1;
        d.feitos = { ...d.feitos, [item.id]: { estado: 'erro', erro: r.erro } };
      } else if (r.corpo.restante) {
        comErro += 1;
        d.feitos = {
          ...d.feitos,
          [item.id]: {
            estado: 'erro',
            de,
            para,
            erro:
              `A Olist respondeu OK, mas ao ler de novo o NCM é ${r.corpo.restante} (devia ser ${para}).` +
              (r.corpo.erros?.length ? ` Recusas: ${r.corpo.erros.join(' | ')}` : ''),
          },
        };
      } else if (!r.corpo.conferido) {
        // Gravou, mas a releitura falhou: fica na fila — corrigir de novo só relê e dá "já certo".
        comErro += 1;
        d.feitos = {
          ...d.feitos,
          [item.id]: { estado: 'erro', de, para, erro: 'A Olist respondeu OK, mas não deu para ler de novo e conferir. Corrija de novo para conferir.' },
        };
      } else {
        d.feitos = { ...d.feitos, [item.id]: { estado: r.corpo.acao, de, para } };
        if (r.corpo.acao === 'corrigido') corrigidos += 1;
      }
      redesenhar();
    }
    setAtual(null);
    redesenhar(true);
    setAviso(`${corrigidos} produto(s) com o NCM corrigido na Olist.` + (comErro ? ` ${comErro} com erro — clique no erro para ver.` : ''));
    setEstado('parado');
  }

  function pausarAgora() {
    pausar.current = true;
    setEstado('pausando');
  }

  const { procura, itens, semRegra, feitos } = dados.current;
  const pendentes = itens.filter((i) => !feitos[i.id] || feitos[i.id].estado === 'erro');
  const comEstado = (estadoFeito) => itens.filter((i) => feitos[i.id]?.estado === estadoFeito).map((i) => ({ ...i, ...feitos[i.id] }));
  return {
    estado,
    atual,
    erro,
    aviso,
    setAviso,
    procura,
    itens,
    semRegra,
    pendentes,
    comErro: comEstado('erro'),
    corrigidos: comEstado('corrigido'),
    jaCertos: comEstado('ja_certo').length,
    iniciar,
    continuarProcura: procurar,
    corrigir,
    pausar: pausarAgora,
  };
}
