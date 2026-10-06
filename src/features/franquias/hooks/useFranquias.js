'use client';

import { useCallback, useEffect, useState } from 'react';

export const FRANQUIA_VAZIA = { cnpj: '', apelido: '', markup: '', ativo: true };

/**
 * /pedidos/clientes — inclusão de clientes franqueados. CNPJ cadastrado aqui
 * faz o pedido ser classificado como franquia em vez de atacado.
 */
export function useFranquias() {
  const [franquias, setFranquias] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  // { dados, salvando, erro }
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
  }, [carregar]);

  function abrirNova() {
    setFormulario({ dados: FRANQUIA_VAZIA, salvando: false, erro: null });
  }

  function atualizarCampo(campo, valor) {
    setFormulario((atual) => ({ ...atual, dados: { ...atual.dados, [campo]: valor } }));
  }

  async function salvar() {
    setFormulario((atual) => ({ ...atual, salvando: true, erro: null }));
    try {
      const resposta = await fetch('/api/franquias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formulario.dados),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro ?? 'Falha ao salvar');
      const nova = corpo.franquia;
      setFranquias((atual) =>
        [...(atual ?? []), nova].sort((a, b) => (a.apelido ?? '').localeCompare(b.apelido ?? ''))
      );
      setFormulario(null);
      setAviso(`Cliente ${nova.apelido || nova.cnpj} cadastrado como franquia.`);
    } catch (e) {
      setFormulario((atual) => ({ ...atual, salvando: false, erro: e.message }));
    }
  }

  return {
    franquias,
    erro,
    aviso,
    setAviso,
    formulario,
    abrirNova,
    atualizarCampo,
    salvar,
    fecharFormulario: () => setFormulario(null),
  };
}
