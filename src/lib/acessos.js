// acessos.js — que papel abre que página e que API. Fonte única para o
// middleware (que barra) e para o menu/tela inicial (que só mostram o que o
// papel abre).
//
// O papel de cada e-mail fica na tabela "acessos" do Supabase, editada pelo
// Table Editor (ver supabase/acessos.sql).

import { AREAS } from './navegacao.js';

/** Rotas que qualquer usuário logado abre, seja qual for o papel. */
const LIVRES = ['/'];

/** Só o admin abre, mesmo dentro de uma área de outro papel (ex.: a
 *  contagem de emissões fica no B2C, mas o papel varejo não a vê). */
const SO_ADMIN = ['/varejo/emissoes', '/api/varejo/emissoes'];

// Cada regra é um prefixo de caminho (vale ele e tudo abaixo) ou uma RegExp.
const REGRAS = {
  financeiro: [
    '/pedidos', // B2B, com transportadoras, clientes e a tela do rascunho
    '/rascunhos', // endereço antigo, redireciona para /pedidos
    '/boletos',
    '/transferencias',
    '/api/pedidos',
    '/api/boletos',
    '/api/transferencias',
    '/api/transportadoras', // cadastro e troca de transportadora no rascunho
    '/api/franquias', // cadastro de clientes franqueados
  ],
  varejo: [
    '/varejo',
    '/api/varejo',
    // A tela B2C cria o rascunho, emite, consulta a situação e baixa o DANFE
    // pelas rotas de /api/pedidos/[id] — só essas, não a lista B2B.
    /^\/api\/pedidos\/[^/]+\/(rascunho|emitir|situacao|danfe)$/,
  ],
};

export const PAPEIS = {
  admin: 'Administração',
  financeiro: 'Financeiro',
  varejo: 'Varejo',
};

function casa(regra, caminho) {
  if (regra instanceof RegExp) return regra.test(caminho);
  return caminho === regra || caminho.startsWith(`${regra}/`);
}

/** O papel abre esse caminho? Papel desconhecido ou ausente não abre nada além das rotas livres. */
export function podeAcessar(papel, caminho) {
  if (LIVRES.includes(caminho)) return true;
  if (papel === 'admin') return true;
  if (SO_ADMIN.some((r) => casa(r, caminho))) return false;
  return (REGRAS[papel] ?? []).some((r) => casa(r, caminho));
}

/**
 * Papel do usuário logado, lido da tabela "acessos" com a sessão dele. A
 * política de RLS só devolve a linha do próprio e-mail. Sem linha (ou erro
 * na consulta) → null, que não abre nada.
 */
export async function buscarPapel(supabase) {
  const { data, error } = await supabase.from('acessos').select('papel').maybeSingle();
  return error ? null : (data?.papel ?? null);
}

/** Áreas do menu que o papel abre, na ordem de AREAS. */
export function areasDoPapel(papel) {
  return AREAS.filter((a) => podeAcessar(papel, a.href));
}
