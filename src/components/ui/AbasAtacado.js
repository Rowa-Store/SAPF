'use client';

// Abas da área de atacado: as notas (/pedidos) e os cadastros de
// transportadoras e de clientes franqueados. Fica no topo das telas, no
// lugar do título.

import { usePathname } from 'next/navigation';

const ABAS = [
  { href: '/pedidos', rotulo: 'Notas de atacado' },
  { href: '/pedidos/transportadoras', rotulo: 'Transportadoras' },
  { href: '/pedidos/clientes', rotulo: 'Clientes franqueados' },
];

export default function AbasAtacado() {
  const caminho = usePathname();
  return (
    <nav className="abas" aria-label="Atacado">
      {ABAS.map(({ href, rotulo }) => {
        const ativa = caminho === href;
        return (
          <a key={href} href={href} className={ativa ? 'ativa' : undefined} aria-current={ativa ? 'page' : undefined}>
            {rotulo}
          </a>
        );
      })}
    </nav>
  );
}
