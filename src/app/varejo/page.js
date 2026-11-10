// Entrada de rota da tela B2C: pedidos da loja online e a nota de cada um.
// O gerente vê a lista sem as ações (ver somenteLeituraNoVarejo).

import AbasVarejo from '@/components/ui/AbasVarejo';
import ControleAtacado from '@/features/pedidos/components/ControleAtacado';
import { somenteLeituraNoVarejo } from '@/lib/acessos';
import { usuarioAtual } from '@/lib/supabase/sessao';

export default async function Page() {
  const usuario = await usuarioAtual();
  return (
    <>
      <AbasVarejo />
      <ControleAtacado canal="b2c" somenteLeitura={somenteLeituraNoVarejo(usuario?.papel)} />
    </>
  );
}
