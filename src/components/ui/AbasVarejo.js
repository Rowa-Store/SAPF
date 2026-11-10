// Abas da área B2C: as notas (/varejo) e, para quem abre (admin e gerente),
// a contagem de notas emitidas por usuário. Para os demais a área tem uma
// tela só, então nada aparece.

import { podeAcessar } from '@/lib/acessos';
import { usuarioAtual } from '@/lib/supabase/sessao';
import Abas from './Abas';

const ABAS = [
  { href: '/varejo', rotulo: 'Notas B2C' },
  { href: '/varejo/emissoes', rotulo: 'Emissões por usuário' },
];

export default async function AbasVarejo() {
  const usuario = await usuarioAtual();
  if (!podeAcessar(usuario?.papel, '/varejo/emissoes')) return null;
  return <Abas abas={ABAS} rotulo="B2C" />;
}
