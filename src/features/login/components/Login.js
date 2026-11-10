'use client';

// Tela de login: e-mail e senha do Supabase Auth.

import { useFormState, useFormStatus } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { entrar } from '../acoes';

function BotaoEntrar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  );
}

export default function Login() {
  const [estado, acao] = useFormState(entrar, null);
  const para = useSearchParams().get('para') ?? '/';

  return (
    <form action={acao} className="cartao login">
      <h2>Entrar</h2>
      <input type="hidden" name="para" value={para} />
      <label>
        E-mail
        <input type="email" name="email" autoComplete="username" required autoFocus />
      </label>
      <label>
        Senha
        <input type="password" name="senha" autoComplete="current-password" required />
      </label>
      {estado?.erro && (
        <p className="aviso" role="alert">
          {estado.erro}
        </p>
      )}
      <BotaoEntrar />
    </form>
  );
}
