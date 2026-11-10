'use client';

import { useCallback, useEffect, useState } from 'react';

/** De quanto em quanto tempo a tela consulta de novo. */
export const INTERVALO_MS = 15000;

/**
 * Contagem de notas emitidas por usuário, consultada a cada INTERVALO_MS
 * enquanto a aba do navegador está visível (e na hora em que volta a ficar).
 * Uma consulta que falha mantém a última contagem na tela, com o erro.
 */
export function useEmissoes() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch('/api/varejo/emissoes', { cache: 'no-store' });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.erro ?? 'Falha ao carregar as emissões.');
      setDados(corpo);
      setErro(null);
    } catch (e) {
      setErro(e.message);
    }
  }, []);

  useEffect(() => {
    carregar();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') carregar();
    }, INTERVALO_MS);
    const aoVoltar = () => document.visibilityState === 'visible' && carregar();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [carregar]);

  return { dados, erro };
}
