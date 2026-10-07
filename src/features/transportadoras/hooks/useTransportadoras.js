'use client';

import { useCallback, useEffect, useState } from 'react';

export const TRANSPORTADORA_VAZIA = {
  nome: '',
  cnpj: '',
  ie: '',
  forma_frete: '',
  endereco: '',
  cidade: '',
  uf: '',
  ativo: true,
};

async function lerJson(resposta, mensagemPadrao) {
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(corpo.erro ?? mensagemPadrao);
    erro.corpo = corpo;
    throw erro;
  }
  return corpo;
}

function enviarJson(url, metodo, dados) {
  return fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
}

/**
 * /pedidos/transportadoras — cadastro das transportadoras do atacado e dos
 * clientes (por CNPJ) anexados a cada uma. Tudo acontece em janelas por cima
 * da lista, uma de cada vez:
 *
 *   - formulario: criar ou editar uma transportadora;
 *   - clientes:   ver (e remover) quem usa a transportadora;
 *   - anexo:      anexar um CNPJ. Se ele já estiver em outra transportadora,
 *                 a janela mostra qual e pede confirmação para mover.
 */
export function useTransportadoras() {
  const [transportadoras, setTransportadoras] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);

  // { id?: number, dados, salvando, erro }
  const [formulario, setFormulario] = useState(null);
  // { transportadora, lista?: [], carregando, erro, removendo?: cnpj }
  const [clientes, setClientes] = useState(null);
  // { transportadora, cnpj, nome, enviando, erro, emOutra? }
  const [anexo, setAnexo] = useState(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const corpo = await lerJson(await fetch('/api/transportadoras'), 'Falha ao carregar');
      setTransportadoras(corpo.transportadoras);
    } catch (e) {
      setErro(e.message);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // ?nova=<nome>: veio do aviso "transporte não cadastrado" da lista do
  // atacado — abre o cadastro já com o nome digitado no Shopify.
  useEffect(() => {
    const nome = new URLSearchParams(window.location.search).get('nova');
    if (nome) setFormulario({ dados: { ...TRANSPORTADORA_VAZIA, nome }, salvando: false, erro: null });
  }, []);

  /** Ajusta a contagem da linha sem recarregar a lista inteira. */
  function somarClientes(id, delta) {
    setTransportadoras((atual) =>
      atual?.map((t) => (t.id === id ? { ...t, totalClientes: Math.max(0, (t.totalClientes ?? 0) + delta) } : t))
    );
  }

  // ---- Criar / editar ----

  function abrirNova() {
    setFormulario({ dados: TRANSPORTADORA_VAZIA, salvando: false, erro: null });
  }

  function abrirEdicao(t) {
    const dados = Object.fromEntries(
      Object.keys(TRANSPORTADORA_VAZIA).map((campo) => [campo, t[campo] ?? TRANSPORTADORA_VAZIA[campo]])
    );
    setFormulario({ id: t.id, dados, salvando: false, erro: null });
  }

  function atualizarCampo(campo, valor) {
    setFormulario((atual) => ({ ...atual, dados: { ...atual.dados, [campo]: valor } }));
  }

  async function salvar() {
    const { id, dados } = formulario;
    setFormulario((atual) => ({ ...atual, salvando: true, erro: null }));
    try {
      const corpo = await lerJson(
        await enviarJson(id ? `/api/transportadoras/${id}` : '/api/transportadoras', id ? 'PUT' : 'POST', dados),
        'Falha ao salvar'
      );
      const salva = corpo.transportadora;
      setTransportadoras((atual) => {
        const lista = atual ?? [];
        return id
          ? lista.map((t) => (t.id === id ? { ...salva, totalClientes: t.totalClientes } : t))
          : [...lista, { ...salva, totalClientes: 0 }].sort((a, b) => a.nome.localeCompare(b.nome));
      });
      setFormulario(null);
      setAviso(id ? `Transportadora ${salva.nome} atualizada.` : `Transportadora ${salva.nome} cadastrada.`);
    } catch (e) {
      setFormulario((atual) => ({ ...atual, salvando: false, erro: e.message }));
    }
  }

  // ---- Clientes que usam a transportadora ----

  async function abrirClientes(t) {
    setClientes({ transportadora: t, carregando: true, erro: null });
    try {
      const corpo = await lerJson(await fetch(`/api/transportadoras/${t.id}/clientes`), 'Falha ao carregar');
      setClientes((atual) => atual && { ...atual, lista: corpo.clientes, carregando: false });
    } catch (e) {
      setClientes((atual) => atual && { ...atual, carregando: false, erro: e.message });
    }
  }

  async function removerCliente(cnpj) {
    const t = clientes.transportadora;
    setClientes((atual) => ({ ...atual, removendo: cnpj, erro: null }));
    try {
      await lerJson(await fetch(`/api/transportadoras/${t.id}/clientes/${cnpj}`, { method: 'DELETE' }), 'Falha ao remover');
      setClientes((atual) => atual && { ...atual, removendo: null, lista: atual.lista.filter((c) => c.cnpj !== cnpj) });
      somarClientes(t.id, -1);
    } catch (e) {
      setClientes((atual) => atual && { ...atual, removendo: null, erro: e.message });
    }
  }

  // ---- Anexar cliente ----

  function abrirAnexo(t) {
    setAnexo({ transportadora: t, cnpj: '', nome: '', enviando: false, erro: null });
  }

  function atualizarAnexo(campo, valor) {
    // Mudou o CNPJ, a pergunta "mover da outra transportadora?" deixa de valer.
    setAnexo((atual) => ({ ...atual, [campo]: valor, ...(campo === 'cnpj' ? { emOutra: null, erro: null } : {}) }));
  }

  async function anexar({ mover = false } = {}) {
    const { transportadora: t, cnpj, nome } = anexo;
    setAnexo((atual) => ({ ...atual, enviando: true, erro: null }));
    try {
      const corpo = await lerJson(
        await enviarJson(`/api/transportadoras/${t.id}/clientes`, 'POST', { cnpj, nome, mover }),
        'Falha ao anexar'
      );
      somarClientes(t.id, 1);
      if (corpo.movido && anexo.emOutra) somarClientes(anexo.emOutra.id, -1);
      // A janela fica aberta e limpa, para anexar o próximo CNPJ em seguida.
      setAnexo({
        transportadora: t,
        cnpj: '',
        nome: '',
        enviando: false,
        erro: null,
        ultimo: corpo.cliente,
      });
    } catch (e) {
      setAnexo((atual) => ({ ...atual, enviando: false, erro: e.message, emOutra: e.corpo?.emOutra ?? null }));
    }
  }

  return {
    transportadoras,
    erro,
    aviso,
    setAviso,
    formulario,
    abrirNova,
    abrirEdicao,
    atualizarCampo,
    salvar,
    fecharFormulario: () => setFormulario(null),
    clientes,
    abrirClientes,
    removerCliente,
    fecharClientes: () => setClientes(null),
    anexo,
    abrirAnexo,
    atualizarAnexo,
    anexar,
    fecharAnexo: () => setAnexo(null),
  };
}
