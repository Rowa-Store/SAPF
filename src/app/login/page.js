// Entrada de rota da tela de login.

import { Suspense } from 'react';
import Login from '@/features/login/components/Login';

export const metadata = { title: 'Entrar — Sap' };

export default function Page() {
  // useSearchParams pede Suspense para a página não virar toda dinâmica no build.
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
