// Abas da área B2C: as notas (/varejo) e, só para o admin, a contagem de
// notas emitidas por usuário. Para quem não é admin a área tem uma tela só,
// então nada aparece.

import { usuarioAtual } from '@/lib/supabase/sessao';
import Abas from './Abas';

const ABAS = [
  { href: '/varejo', rotulo: 'Notas B2C' },
  { href: '/varejo/emissoes', rotulo: 'Emissões por usuário' },
];

export default async function AbasVarejo() {
  const usuario = await usuarioAtual();
  if (usuario?.papel !== 'admin') return null;
  return <Abas abas={ABAS} rotulo="B2C" />;
}
