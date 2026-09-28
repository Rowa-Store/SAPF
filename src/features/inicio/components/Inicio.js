// Página inicial: atalhos para cada área do app, com uma linha sobre o que
// cada uma faz.

import { AREAS } from '@/lib/navegacao';

export default function Inicio() {
  return (
    <>
      <div className="boas-vindas">
        <h2>SAPF</h2>
        <p className="fraco">
          Pedidos de atacado e de franquia e transferências entre lojas do Shopify viram nota fiscal no
          Tiny. Escolha por onde começar.
        </p>
      </div>

      <nav className="grade-atalhos" aria-label="Áreas do app">
        {AREAS.map((a) => (
          <a key={a.href} href={a.href} className="atalho">
            <span className="atalho-titulo">{a.rotulo}</span>
            <span className="atalho-descricao">{a.descricao}</span>
            <span className="atalho-seta" aria-hidden="true">→</span>
          </a>
        ))}
      </nav>
    </>
  );
}
