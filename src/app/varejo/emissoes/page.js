// Entrada de rota da contagem de notas emitidas por usuário (só admin).

import AbasVarejo from '@/components/ui/AbasVarejo';
import EmissoesPorUsuario from '@/features/emissoes/components/EmissoesPorUsuario';

export default function Page() {
  return (
    <>
      <AbasVarejo />
      <EmissoesPorUsuario />
    </>
  );
}
