'use client';

import { usePathname } from 'next/navigation';
import { areasDoPapel, PAPEIS } from '@/lib/acessos';
import { sair } from '@/features/login/acoes';

/** Rota ativa: a própria área ou qualquer subpágina dela (ex.: /pedidos/123/rascunho). */
function estaAtiva(caminho, href) {
  return href === '/' ? caminho === '/' : caminho === href || caminho.startsWith(`${href}/`);
}

/**
 * Cabeçalho fixo do app: marca, navegação e o usuário logado. O menu mostra
 * só as áreas que o papel do usuário abre (quem barra de fato é o middleware).
 */
export default function SiteHeader({ usuario }) {
  const caminho = usePathname() ?? '/';
  const links = usuario ? [{ href: '/', rotulo: 'Início' }, ...areasDoPapel(usuario.papel)] : [];

  return (
    <header className="topo">
      <a href="/" className="marca-app">
        <img src="/icon.svg" className="marca-app-icone" alt="" width={22} height={22} />
        <h1>SAP</h1>
      </a>
      {usuario && (
        <>
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
          <div className="topo-usuario">
            <span className="fraco" title={usuario.email}>
              {PAPEIS[usuario.papel] ?? 'Sem acesso'}
            </span>
            <form action={sair}>
              <button type="submit" className="secundario pequeno">
                Sair
              </button>
            </form>
          </div>
        </>
      )}
    </header>
  );
}
