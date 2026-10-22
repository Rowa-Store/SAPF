'use client';

import { useEffect, useRef, useState } from 'react';

// Limpeza geral de GTIN da Olist, em duas etapas:
//
//   1. procurar — lê a lista inteira de produtos da Olist, 100 por página, e
//      junta os que têm GTIN. Só lê.
//   2. limpar — um produto por requisição: deixa o GTIN vazio no produto (ou
//      no pai, com todas as variações) e confere relendo. As outras
//      variações do mesmo pai saem da fila sem nova chamada.
//
// Pausa entre as requisições; se o Tiny recusar por limite de chamadas
// (429), espera e tenta de novo. Dá para pausar e continuar — o progresso
// fica guardado neste navegador.
const PAUSA_ENTRE_CHAMADAS_MS = 1500;
const ESPERA_LIMITE_S = 60;
const SALVAR_A_CADA_MS = 2000;
const CHAVE_GUARDADA = 'sapf:limpeza-gtin-olist';

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

/** /olist/gtin — procura e limpa o GTIN de todos os produtos da Olist. */
export function useLimpezaGtin() {
  // parado | procurando | limpando | pausando
  const [estado, setEstado] = useState('parado');
  // Item sendo tratado agora: { texto, segundos? }
  const [atual, setAtual] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [, setVersaoDaTela] = useState(0);

  // procura: onde a leitura da lista parou; itens: os com GTIN, na ordem da
  // lista; feitos: id -> { estado: limpo|ja_limpo|erro, erro? }.
  const dados = useRef({ procura: null, itens: [], feitos: {} });
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
      dados.current = { procura: g.procura, itens: g.itens ?? [], feitos: g.feitos ?? {} };
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
        `/api/olist/gtin?${new URLSearchParams({ pagina: String(p.pagina) })}`,
        undefined,
        `Lendo a lista de produtos da Olist — página ${p.pagina}${p.paginas ? ` de ${p.paginas}` : ''}`
      );
      if (!r) break;
      if (r.erro) {
        setErro(`Não deu para ler a lista de produtos da Olist: ${r.erro}`);
        break;
      }
      const conhecidos = new Set(d.itens.map((i) => i.id));
      d.itens = [...d.itens, ...r.corpo.comGtin.filter((i) => !conhecidos.has(i.id))];
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
    dados.current = { procura: PROCURA_NOVA(), itens: [], feitos: {} };
    setAviso(null);
    procurar();
  }

  /** Limpa, um por vez, os itens com GTIN que ainda não foram feitos. */
  async function limpar() {
    const d = dados.current;
    pausar.current = false;
    setErro(null);
    setAviso(null);
    setEstado('limpando');
    let limpos = 0;
    let comErro = 0;
    let primeira = true;
    for (const item of d.itens) {
      if (pausar.current) break;
      const feito = d.feitos[item.id];
      if (feito && feito.estado !== 'erro') continue;
      if (!primeira) await esperar(PAUSA_ENTRE_CHAMADAS_MS);
      primeira = false;
      const r = await chamar(
        '/api/olist/gtin',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) },
        `Limpando “${item.nome}”`
      );
      if (!r) break;
      if (r.erro) {
        comErro += 1;
        d.feitos = { ...d.feitos, [item.id]: { estado: 'erro', erro: r.erro } };
      } else if (r.corpo.restantes.length) {
        comErro += 1;
        d.feitos = {
          ...d.feitos,
          [item.id]: {
            estado: 'erro',
            erro: `A Olist respondeu OK, mas ao ler de novo ainda há GTIN em: ${r.corpo.restantes.join(', ')}.`,
          },
        };
      } else if (!r.corpo.conferido) {
        // Gravou, mas a releitura falhou: fica na fila — limpar de novo só relê e dá "já limpo".
        comErro += 1;
        d.feitos = {
          ...d.feitos,
          [item.id]: { estado: 'erro', erro: 'A Olist respondeu OK, mas não deu para ler de novo e conferir. Limpe de novo para conferir.' },
        };
      } else {
        // O produto e todas as variações do mesmo pai saem da fila.
        const estadoFeito = r.corpo.acao === 'limpo' ? 'limpo' : 'ja_limpo';
        const novos = Object.fromEntries([item.id, ...r.corpo.ids].map((id) => [id, { estado: estadoFeito }]));
        d.feitos = { ...d.feitos, ...novos };
        if (estadoFeito === 'limpo') limpos += 1;
      }
      redesenhar();
    }
    setAtual(null);
    redesenhar(true);
    setAviso(`${limpos} produto(s) com o GTIN limpo na Olist.` + (comErro ? ` ${comErro} com erro — clique no erro para ver.` : ''));
    setEstado('parado');
  }

  function pausarAgora() {
    pausar.current = true;
    setEstado('pausando');
  }

  const { procura, itens, feitos } = dados.current;
  const pendentes = itens.filter((i) => !feitos[i.id] || feitos[i.id].estado === 'erro');
  return {
    estado,
    atual,
    erro,
    aviso,
    setAviso,
    procura,
    itens,
    feitos,
    pendentes,
    comErro: itens.filter((i) => feitos[i.id]?.estado === 'erro').map((i) => ({ ...i, erro: feitos[i.id].erro })),
    limpos: itens.filter((i) => feitos[i.id] && feitos[i.id].estado !== 'erro').length,
    iniciar,
    continuarProcura: procurar,
    limpar,
    pausar: pausarAgora,
  };
}
