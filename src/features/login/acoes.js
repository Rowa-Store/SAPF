'use server';

// Entrar e sair. Os usuários são criados no painel do Supabase
// (Authentication > Users), com o papel em app_metadata — ver supabase/acessos.sql.

import { redirect } from 'next/navigation';
import { clienteAuth } from '@/lib/supabase/sessao';

/** Só caminhos internos: evita mandar o usuário para outro site depois do login. */
function destinoSeguro(para) {
  return typeof para === 'string' && para.startsWith('/') && !para.startsWith('//') ? para : '/';
}

export async function entrar(_estado, formData) {
  const email = String(formData.get('email') ?? '').trim();
  const senha = String(formData.get('senha') ?? '');
  if (!email || !senha) return { erro: 'Informe e-mail e senha.' };

  const { error } = await clienteAuth().auth.signInWithPassword({ email, password: senha });
  if (error) return { erro: 'E-mail ou senha inválidos.' };

  redirect(destinoSeguro(formData.get('para')));
}

export async function sair() {
  await clienteAuth().auth.signOut();
  redirect('/login');
}
