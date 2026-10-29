'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export const FRANQUIA_VAZIA = {
  cnpj: '',
  apelido: '',
  razao_social: '',
  ie: '',
  contato: '',
  email: '',
  telefone: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  observacoes: '',
  markup: '',
  transportadoraId: '',
  ativo: true,
};

function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Cadastro gravado → campos do formulário (tudo texto; markup com vírgula). */
function paraFormulario(f) {
  const dados = { ...FRANQUIA_VAZIA };
  for (const campo of Object.keys(FRANQUIA_VAZIA)) {
    if (f[campo] != null) dados[campo] = f[campo];
  }
  dados.markup = f.markup == null ? '' : String(f.markup).replace('.', ',');
  dados.transportadoraId = f.transportadora?.id == null ? '' : String(f.transportadora.id);
  return dados;
}

/**
 * /pedidos/clientes — clientes franqueados: inclusão, edição dos dados
 * cadastrais e da transportadora. CNPJ cadastrado aqui faz o pedido ser
 * classificado como franquia em vez de atacado.
 */
export function useFranquias() {
  const [franquias, setFranquias] = useState(null);
  const [transportadoras, setTransportadoras] = useState([]);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [busca, setBusca] = useState('');
  // { dados, cnpjOriginal e transportadoraAtual (só na edição), salvando,
  //   confirmandoExclusao, excluindo, erro }
  const [formulario, setFormulario] = useState(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const resposta = await fetch('/api/franquias');
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro ?? 'Falha ao carregar');
      setFranquias(corpo.franquias);
    } catch (e) {
      setErro(e.message);
    }
  }, []);

  useEffect(() => {
    carregar();
    // A lista de transportadoras só alimenta a escolha no formulário; se
    // falhar, o select mostra só a atual e "Correios".
    fetch('/api/transportadoras')
      .then((r) => (r.ok ? r.json() : { transportadoras: [] }))
      .then((corpo) => setTransportadoras(corpo.transportadoras ?? []))
      .catch(() => {});
  }, [carregar]);

  const filtradas = useMemo(() => {
    const alvo = normalizar(busca.trim());
    if (!franquias || !alvo) return franquias;
    const alvoDigitos = alvo.replace(/\D+/g, '');
    return franquias.filter(
      (f) =>
        normalizar(
          [f.apelido, f.razao_social, f.cidade, f.uf, f.contato, f.email, f.transportadora?.nome].join(' ')
        ).includes(alvo) ||
        (alvoDigitos.length >= 3 && String(f.cnpj).replace(/\D+/g, '').includes(alvoDigitos))
    );
  }, [franquias, busca]);

  function abrirNova() {
    setFormulario({ dados: FRANQUIA_VAZIA, cnpjOriginal: null, salvando: false, erro: null });
  }

  function abrirEdicao(franquia) {
    setFormulario({
      dados: paraFormulario(franquia),
      cnpjOriginal: franquia.cnpj,
      transportadoraAtual: franquia.transportadora,
      salvando: false,
      erro: null,
    });
  }

  function atualizarCampo(campo, valor) {
    setFormulario((atual) => ({ ...atual, dados: { ...atual.dados, [campo]: valor } }));
  }

  async function salvar() {
    const { dados, cnpjOriginal } = formulario;
    setFormulario((atual) => ({ ...atual, salvando: true, erro: null }));
    try {
      const resposta = await fetch('/api/franquias', {
        method: cnpjOriginal ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cnpjOriginal ? { ...dados, cnpjOriginal } : dados),
      });
      const corpo = await resposta.json().catch(() => ({}));
      // Com `franquia` no erro, o cadastro foi salvo e só a IE ou a
      // transportadora ficaram para trás: recarrega para a tela mostrar o real
      // e, se era inclusão, o "salvar" de novo passa a ser edição.
      if (!resposta.ok && corpo.franquia) {
        carregar();
        setFormulario((atual) => ({ ...atual, cnpjOriginal: corpo.franquia.cnpj, salvando: false, erro: corpo.erro }));
        return;
      }
      if (!resposta.ok) throw new Error(corpo.erro ?? 'Falha ao salvar');
      const salva = corpo.franquia;
      setFormulario(null);
      setAviso(
        cnpjOriginal
          ? `Cadastro de ${salva.apelido || salva.razao_social || salva.cnpj} atualizado.`
          : `Cliente ${salva.apelido || salva.razao_social || salva.cnpj} cadastrado como franquia.`
      );
      carregar();
    } catch (e) {
      setFormulario((atual) => ({ ...atual, salvando: false, erro: e.message }));
    }
  }

  function pedirExclusao(confirmando) {
    setFormulario((atual) => ({ ...atual, confirmandoExclusao: confirmando, erro: null }));
  }

  async function excluir() {
    const { cnpjOriginal, dados } = formulario;
    setFormulario((atual) => ({ ...atual, excluindo: true, erro: null }));
    try {
      const resposta = await fetch('/api/franquias', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnpj: cnpjOriginal }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro ?? 'Falha ao excluir');
      setFormulario(null);
      setFranquias((atual) => (atual ?? []).filter((f) => f.cnpj !== cnpjOriginal));
      setAviso(`Cadastro de ${dados.apelido || dados.razao_social || cnpjOriginal} excluído — os pedidos dele voltam a ser atacado.`);
    } catch (e) {
      setFormulario((atual) => ({ ...atual, excluindo: false, erro: e.message }));
    }
  }

  return {
    franquias,
    filtradas,
    transportadoras,
    erro,
    aviso,
    setAviso,
    busca,
    setBusca,
    formulario,
    abrirNova,
    abrirEdicao,
    atualizarCampo,
    salvar,
    pedirExclusao,
    excluir,
    fecharFormulario: () => setFormulario(null),
  };
}
