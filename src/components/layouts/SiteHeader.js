'use client';

import { usePathname } from 'next/navigation';
import { AREAS } from '@/lib/navegacao';

/** Rota ativa: a própria área ou qualquer subpágina dela (ex.: /pedidos/123/rascunho). */
function estaAtiva(caminho, href) {
  return href === '/' ? caminho === '/' : caminho === href || caminho.startsWith(`${href}/`);
}

/** Cabeçalho fixo do app: marca e navegação principal. */
export default function SiteHeader() {
  const caminho = usePathname() ?? '/';
  const links = [{ href: '/', rotulo: 'Início' }, ...AREAS];

  return (
    <header className="topo">
      <a href="/" className="marca-app">
        <span className="marca-app-icone" aria-hidden="true" />
        <h1>SAPF</h1>
      </a>
      <nav>
        {links.map((l) => {
          const ativa = estaAtiva(caminho, l.href);
          return (
            <a key={l.href} href={l.href} className={ativa ? 'ativo' : undefined} aria-current={ativa ? 'page' : undefined}>
              {l.rotulo}
            </a>
          );
        })}
      </nav>
    </header>
  );
}
