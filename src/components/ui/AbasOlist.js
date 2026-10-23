'use client';

// Abas da área Olist. Fica no topo das telas, no lugar do título — mesmo
// formato de AbasAtacado.

import { usePathname } from 'next/navigation';

const ABAS = [
  { href: '/olist', rotulo: 'Cadastro de produtos' },
  { href: '/olist/diagnostico', rotulo: 'Diagnóstico' },
  { href: '/olist/gtin', rotulo: 'Limpar GTIN' },
  { href: '/olist/ncm', rotulo: 'Corrigir NCM' },
  { href: '/olist/scan-gtin', rotulo: 'Scan GTIN' },
];

export default function AbasOlist() {
  const caminho = usePathname();
  return (
    <nav className="abas" aria-label="Olist">
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
