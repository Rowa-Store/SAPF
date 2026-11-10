'use client';

// Fileira de abas de uma área (ex.: B2C). A aba da página aberta fica marcada.

import { usePathname } from 'next/navigation';

export default function Abas({ abas, rotulo }) {
  const caminho = usePathname();
  return (
    <nav className="abas" aria-label={rotulo}>
      {abas.map(({ href, rotulo: texto }) => {
        const ativa = caminho === href;
        return (
          <a key={href} href={href} className={ativa ? 'ativa' : undefined} aria-current={ativa ? 'page' : undefined}>
            {texto}
          </a>
        );
      })}
    </nav>
  );
}
