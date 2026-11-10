// Entrada de rota da tela B2C: pedidos da loja online e a nota de cada um.

import AbasVarejo from '@/components/ui/AbasVarejo';
import ControleAtacado from '@/features/pedidos/components/ControleAtacado';

export default function Page() {
  return (
    <>
      <AbasVarejo />
      <ControleAtacado canal="b2c" />
    </>
  );
}
