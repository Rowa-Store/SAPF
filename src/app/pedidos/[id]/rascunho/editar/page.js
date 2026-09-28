// Rascunho de pedido já enviado ao Tiny não é editado: o ajuste de cliente e
// itens acontece antes, na conferência (/pedidos/[id]/rascunho). O endereço
// antigo leva de volta para a tela de atacado.

import { redirect } from 'next/navigation';

export default function EditarRascunhoPedido() {
  redirect('/pedidos');
}
