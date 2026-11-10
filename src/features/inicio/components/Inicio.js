// Página inicial: atalhos para as áreas que o papel do usuário abre, com uma
// linha sobre o que cada uma faz.

import { areasDoPapel } from '@/lib/acessos';
import { usuarioAtual } from '@/lib/supabase/sessao';

export default async function Inicio() {
  const usuario = await usuarioAtual();
  const areas = areasDoPapel(usuario?.papel);

  return (
    <>
      <div className="boas-vindas">
        <h2>SAP</h2>
        <p className="fraco">
          Pedidos de atacado e de franquia e transferências entre lojas do Shopify viram nota fiscal no
          Tiny. Escolha por onde começar.
        </p>
      </div>

      {areas.length === 0 && (
        <p className="aviso">Seu usuário ainda não tem acesso a nenhuma área. Peça a liberação ao administrador.</p>
      )}

      <nav className="grade-atalhos" aria-label="Áreas do app">
        {areas.map((a) => (
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
