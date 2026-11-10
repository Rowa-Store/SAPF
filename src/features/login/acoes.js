'use server';

// Entrar e sair. Os usuários são criados no painel do Supabase
// (Authentication > Users), e o papel na tabela acessos — ver supabase/acessos.sql.

import { redirect } from 'next/navigation';
import { clienteAuth } from '@/lib/supabase/sessao';

/** Só caminhos internos: evita mandar o usuário para outro site depois do login. */
function destinoSeguro(para) {
  return typeof para === 'string' && para.startsWith('/') && !para.startsWith('//') ? para : '/';
}

// Erros do Supabase Auth que não são senha errada e que o usuário (ou o
// admin) consegue resolver. O resto vira "E-mail ou senha inválidos".
const MENSAGENS_LOGIN = {
  email_not_confirmed:
    'Seu usuário ainda não foi confirmado. Peça ao administrador para confirmar o e-mail no Supabase.',
  user_banned: 'Seu usuário está bloqueado. Fale com o administrador.',
  over_request_rate_limit: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
};

export async function entrar(_estado, formData) {
  const email = String(formData.get('email') ?? '').trim();
  const senha = String(formData.get('senha') ?? '');
  if (!email || !senha) return { erro: 'Informe e-mail e senha.' };

  const { error } = await clienteAuth().auth.signInWithPassword({ email, password: senha });
  if (error) {
    // Nos logs do Vercel, para saber por que alguém não entrou (sem a senha).
    console.error(`[login] ${email}: ${error.code ?? error.status} ${error.message}`);
    return { erro: MENSAGENS_LOGIN[error.code] ?? 'E-mail ou senha inválidos.' };
  }

  redirect(destinoSeguro(formData.get('para')));
}

export async function sair() {
  await clienteAuth().auth.signOut();
  redirect('/login');
}
