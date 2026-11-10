// GET /api/varejo/emissoes — quantas notas do B2C cada usuário emitiu pelo
// SAP, acumulado do dia e do mês (fuso de São Paulo). Só admin e gerente
// abrem (ver RESTRITAS em lib/acessos.js). A tela /varejo/emissoes consulta
// de tempos em tempos.

import { emissoesDoVarejoDesde } from '@/lib/db';
import { hoje, intervaloDoDia } from '@/lib/datas';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const dia = hoje();
    const inicioDoDia = Date.parse(intervaloDoDia(dia).inicio);
    const notas = await emissoesDoVarejoDesde(intervaloDoDia(`${dia.slice(0, 7)}-01`).inicio);

    const porUsuario = new Map();
    for (const { emitida_por: email, emitida_em: em } of notas) {
      const u = porUsuario.get(email) ?? { email, hoje: 0, mes: 0, ultimaEmissao: null };
      u.mes += 1;
      if (Date.parse(em) >= inicioDoDia) u.hoje += 1;
      if (!u.ultimaEmissao || em > u.ultimaEmissao) u.ultimaEmissao = em;
      porUsuario.set(email, u);
    }

    const usuarios = [...porUsuario.values()].sort((a, b) => b.hoje - a.hoje || b.mes - a.mes);
    return Response.json({ usuarios, atualizadoEm: new Date().toISOString() });
  } catch (erro) {
    return erroJson(`Não foi possível ler as emissões por usuário: ${erro.message}`);
  }
}
