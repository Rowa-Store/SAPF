// A lista de rascunhos foi unificada na tela de atacado (/pedidos) — o
// endereço antigo continua valendo para quem tem o link salvo.

import { redirect } from 'next/navigation';

export default function Rascunhos() {
  redirect('/pedidos');
}
