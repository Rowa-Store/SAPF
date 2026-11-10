// middleware.js — porteiro do app: toda página e API passa por aqui.
// Sem login → /login (API: 401). Logado, mas o papel não abre a rota →
// tela inicial (API: 403). As regras ficam em src/lib/acessos.js.

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { buscarPapel, podeAcessar } from '@/lib/acessos';

const PUBLICAS = ['/login'];

function negar(req, status, mensagem, destino) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ erro: mensagem }, { status });
  }
  return NextResponse.redirect(destino);
}

export async function middleware(req) {
  const caminho = req.nextUrl.pathname;
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_ANON_KEY;

  // Sem configuração, fecha tudo: melhor o app parado do que aberto.
  if (!url || !chave) {
    return new NextResponse('Login não configurado (SUPABASE_URL / SUPABASE_ANON_KEY ausentes).', { status: 500 });
  }

  let resposta = NextResponse.next({ request: req });
  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (lista) => {
        // Sessão renovada: o cookie novo vale para esta requisição e volta ao navegador.
        lista.forEach(({ name, value }) => req.cookies.set(name, value));
        resposta = NextResponse.next({ request: req });
        lista.forEach(({ name, value, options }) => resposta.cookies.set(name, value, options));
      },
    },
  });

  // getUser confere o token com o Supabase (não só lê o cookie).
  const { data } = await supabase.auth.getUser();
  const usuario = data?.user;

  if (PUBLICAS.includes(caminho)) {
    return usuario ? NextResponse.redirect(new URL('/', req.url)) : resposta;
  }

  if (!usuario) {
    const login = new URL('/login', req.url);
    login.searchParams.set('para', caminho + req.nextUrl.search);
    return negar(req, 401, 'Faça login para continuar.', login);
  }

  if (!podeAcessar(await buscarPapel(supabase), caminho)) {
    return negar(req, 403, 'Seu usuário não tem acesso a esta área.', new URL('/', req.url));
  }

  return resposta;
}

export const config = {
  // Tudo, menos arquivos estáticos (o zip da extensão, ícone, _next).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|zip)$).*)'],
};
