// acessos.js — que papel abre que página e que API. Fonte única para o
// middleware (que barra) e para o menu/tela inicial (que só mostram o que o
// papel abre).
//
// O papel fica em app_metadata.papel do usuário no Supabase Auth: vai dentro
// do token e o próprio usuário não consegue alterar (ver supabase/acessos.sql).

import { AREAS } from './navegacao.js';

/** Rotas que qualquer usuário logado abre, seja qual for o papel. */
const LIVRES = ['/'];

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
  return (REGRAS[papel] ?? []).some((r) => casa(r, caminho));
}

/** Áreas do menu que o papel abre, na ordem de AREAS. */
export function areasDoPapel(papel) {
  return AREAS.filter((a) => podeAcessar(papel, a.href));
}
