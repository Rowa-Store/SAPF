// sessao.js — login dos usuários (Supabase Auth) no servidor: Server
// Components e Server Actions. Usa a chave anon + o cookie da sessão; a
// service role (db.js) continua só para os dados.

import { cache } from 'react';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export function credenciaisAuth() {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_ANON_KEY;
  return url && chave ? { url, chave } : null;
}

export function clienteAuth() {
  const cred = credenciaisAuth();
  if (!cred) throw new Error('Login não configurado (SUPABASE_URL / SUPABASE_ANON_KEY ausentes).');
  const loja = cookies();
  return createServerClient(cred.url, cred.chave, {
    cookies: {
      getAll: () => loja.getAll(),
      setAll: (lista) => {
        // Server Component não pode gravar cookie; quem renova a sessão é o
        // middleware, então aqui é seguro ignorar.
        try {
          lista.forEach(({ name, value, options }) => loja.set(name, value, options));
        } catch {}
      },
    },
  });
}

/** Usuário logado ({ email, papel }) ou null. Uma consulta por requisição. */
export const usuarioAtual = cache(async () => {
  // Lê o cookie antes de tudo: é o que faz o Next renderizar a página a cada
  // requisição. Sem isso, um build sem as variáveis congelaria o cabeçalho deslogado.
  cookies();
  if (!credenciaisAuth()) return null;
  const { data } = await clienteAuth().auth.getUser();
  const u = data?.user;
  return u ? { email: u.email, papel: u.app_metadata?.papel ?? null } : null;
});
