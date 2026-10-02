'use client';

import { useEffect, useRef } from 'react';

/**
 * Janela por cima da tela, com o <dialog> nativo: Esc fecha, o foco fica
 * preso dentro e o fundo escurece sem biblioteca. `aoFechar` é chamado em
 * qualquer forma de fechar pela pessoa (Esc, botão, clique fora) — fechar
 * porque `aberto` virou false não chama, senão uma janela que dá lugar a outra
 * desfaria o estado de quem a abriu.
 */
export default function Modal({ aberto, titulo, aoFechar, children, largura = '36rem' }) {
  const ref = useRef(null);
  // O evento close chega depois do render; o ref diz se ainda era para estar aberto.
  const abertoRef = useRef(aberto);
  abertoRef.current = aberto;

  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (aberto && !dialogo.open) dialogo.showModal();
    if (!aberto && dialogo.open) dialogo.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      className="modal"
      style={{ maxWidth: largura }}
      onClose={() => abertoRef.current && aoFechar()}
      // Clique no fundo (fora da caixa) cai no próprio <dialog>.
      onClick={(e) => e.target === ref.current && aoFechar()}
    >
      {aberto && (
        <div className="modal-caixa">
          <div className="modal-topo">
            <h3>{titulo}</h3>
            <button className="secundario pequeno" onClick={aoFechar} aria-label="Fechar">
              Fechar
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
