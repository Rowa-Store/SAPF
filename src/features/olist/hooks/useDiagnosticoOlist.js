'use client';

import { useRef, useState } from 'react';

// Varredura do diagnóstico: lê o Shopify de 20 em 20 produtos ativos e
// compara cada um com a Olist, um por requisição, com uma pausa entre eles.
// Se o Tiny recusar por limite de chamadas (429), espera e tenta o mesmo
// produto de novo. Dá para pausar e continuar de onde parou.
const PAUSA_ENTRE_PRODUTOS_MS = 1500;
const ESPERA_LIMITE_S = 60;

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Problemas que a varredura aponta, na ordem da tela. Cada um diz se o
// produto comparado (de /api/olist/comparar) tem o problema.
export const PROBLEMAS = [
  { chave: 'nao_cadastrado', rotulo: 'Não está na Olist', classe: 'marca-erro', tem: (p) => p.situacao === 'nao_encontrado' },
  { chave: 'duplicado', rotulo: 'Duplicado na Olist', classe: 'marca-erro', tem: (p) => p.situacao === 'duplicado' },
  {
    chave: 'sku_faltando',
    rotulo: 'SKU faltando',
    classe: 'marca-erro',
    tem: (p) => p.situacao === 'encontrado' && p.linhas.some((l) => l.situacao === 'nova'),
  },
  {
    chave: 'desatualizado',
    rotulo: 'Desatualizado',
    classe: 'marca-acessorio',
    tem: (p) => p.diferencasPai.length > 0 || p.linhas.some((l) => l.diferencas.length > 0),
  },
  {
    chave: 'sku_em_outro',
    rotulo: 'SKU em outro produto',
    classe: 'marca-erro',
    tem: (p) => p.linhas.some((l) => l.situacao === 'fora_do_pai'),
  },
  { chave: 'sem_sku', rotulo: 'Sem SKU no Shopify', classe: 'marca-erro', tem: (p) => p.linhas.some((l) => l.situacao === 'sem_sku') },
];

const NOME_CAMPO = { nome: 'nome', ncm: 'NCM', peso: 'peso', preco: 'preço' };

/** Resumo enxuto de um produto comparado — a tela guarda só isto, não a
 *  comparação inteira, para a lista não pesar numa varredura longa. */
function resumir(produto) {
  const problemas = PROBLEMAS.filter((p) => p.tem(produto)).map((p) => p.chave);
  const comPreco = produto.linhas.filter((l) => l.diferencas.includes('preco')).length;
  const detalhes = [
    produto.diferencasPai.length > 0 && `${produto.diferencasPai.map((c) => NOME_CAMPO[c]).join(', ')} do pai`,
    comPreco > 0 && `preço em ${comPreco} SKU(s)`,
    ...['nova', 'fora_do_pai', 'sem_sku'].map((s) => {
      const n = produto.linhas.filter((l) => l.situacao === s).length;
      if (!n || (s === 'nova' && produto.situacao !== 'encontrado')) return false;
      return { nova: `${n} SKU(s) faltando`, fora_do_pai: `${n} SKU(s) em outro produto`, sem_sku: `${n} variante(s) sem SKU` }[s];
    }),
    produto.situacao === 'nao_encontrado' && `${produto.linhas.filter((l) => l.sku).length} SKU(s) para cadastrar`,
    produto.situacao === 'duplicado' && `${produto.duplicados} produtos ativos com este nome`,
  ].filter(Boolean);
  return {
    id: produto.id,
    titulo: produto.titulo,
    status: produto.status,
    // SKU para abrir o produto no cadastro de produtos.
    sku: produto.linhas.find((l) => l.sku)?.sku ?? null,
    problemas,
    detalhes,
  };
}

/** /olist/diagnostico — varredura das diferenças de cadastro entre o Shopify e a Olist. */
export function useDiagnosticoOlist() {
  // parado | rodando | pausando | pausado | fim
  const [estado, setEstado] = useState('parado');
  const [lotes, setLotes] = useState(0);
  const [verificados, setVerificados] = useState(0);
  const [iguais, setIguais] = useState(0);
  // Só os produtos com algum problema.
  const [divergentes, setDivergentes] = useState([]);
  // { id, titulo, erro } de quem não deu para comparar
  const [falhas, setFalhas] = useState([]);
  // Produto sendo comparado agora: { titulo, segundos? }
  const [atual, setAtual] = useState(null);
  const [erro, setErro] = useState(null);

  // Produtos do lote atual que ainda faltam, e o cursor do próximo lote.
  const pendentes = useRef([]);
  const proximo = useRef(null);
  const temMais = useRef(true);
  const pausar = useRef(false);

  function zerar() {
    pendentes.current = [];
    proximo.current = null;
    temMais.current = true;
    setLotes(0);
    setVerificados(0);
    setIguais(0);
    setDivergentes([]);
    setFalhas([]);
  }

  /** Compara um produto, esperando enquanto o Tiny recusar por limite.
   *  Devolve null se pausaram durante a espera (o produto fica pendente). */
  async function comparar(item) {
    for (;;) {
      setAtual({ titulo: item.titulo });
      let resposta;
      try {
        resposta = await fetch(`/api/olist/comparar?${new URLSearchParams({ produtoId: item.id })}`);
      } catch (e) {
        return { erro: `Falha de rede: ${e.message}` };
      }
      if (resposta.status === 429) {
        for (let s = ESPERA_LIMITE_S; s > 0; s -= 1) {
          if (pausar.current) return null;
          setAtual({ titulo: item.titulo, segundos: s });
          await esperar(1000);
        }
        continue;
      }
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) return { erro: corpo.erro ?? 'Falha na comparação' };
      return { produto: corpo.produtos[0] };
    }
  }

  async function rodar() {
    pausar.current = false;
    setErro(null);
    setEstado('rodando');
    while (!pausar.current) {
      if (!pendentes.current.length) {
        if (!temMais.current) break;
        try {
          const resposta = await fetch(`/api/olist/diagnostico?${new URLSearchParams(proximo.current ? { cursor: proximo.current } : {})}`);
          const corpo = await resposta.json().catch(() => ({}));
          if (!resposta.ok) throw new Error(corpo.erro ?? 'Falha ao ler o Shopify');
          pendentes.current = corpo.produtos;
          proximo.current = corpo.proximo;
          temMais.current = !!corpo.proximo;
          setLotes((n) => n + 1);
        } catch (e) {
          setErro(e.message);
          setAtual(null);
          setEstado('pausado');
          return;
        }
        continue;
      }

      const item = pendentes.current[0];
      const r = await comparar(item);
      if (!r) break;
      pendentes.current = pendentes.current.slice(1);
      setVerificados((n) => n + 1);
      if (r.erro) {
        setFalhas((atual) => [...atual, { id: item.id, titulo: item.titulo, erro: r.erro }]);
      } else {
        const resumo = resumir(r.produto);
        if (resumo.problemas.length) setDivergentes((atual) => [...atual, resumo]);
        else setIguais((n) => n + 1);
      }
      if (pendentes.current.length || temMais.current) await esperar(PAUSA_ENTRE_PRODUTOS_MS);
    }
    setAtual(null);
    setEstado(pausar.current ? 'pausado' : 'fim');
  }

  function iniciar() {
    zerar();
    rodar();
  }

  function pausarVarredura() {
    pausar.current = true;
    setEstado('pausando');
  }

  return {
    estado,
    lotes,
    verificados,
    iguais,
    divergentes,
    falhas,
    atual,
    erro,
    iniciar,
    continuar: rodar,
    pausar: pausarVarredura,
  };
}
