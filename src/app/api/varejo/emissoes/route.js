// GET /api/varejo/emissoes — quantas notas cada usuário emitiu pelo SAP:
// hoje (dia de São Paulo), no total e por tipo de nota. Só o admin abre (ver
// SO_ADMIN em lib/acessos.js). A tela /varejo/emissoes consulta de tempos
// em tempos.

import { emissoesPorUsuario } from '@/lib/db';
import { hoje, intervaloDoDia } from '@/lib/datas';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const { totais, recentes } = await emissoesPorUsuario({ desde: intervaloDoDia(hoje()).inicio });

    const porUsuario = new Map();
    const linha = (email) => {
      if (!porUsuario.has(email)) {
        porUsuario.set(email, { email, hoje: 0, total: 0, porTipo: {}, ultimaEmissao: null });
      }
      return porUsuario.get(email);
    };
    for (const t of totais) {
      const u = linha(t.emitida_por);
      const notas = Number(t.notas);
      u.total += notas;
      u.porTipo[t.classificacao] = (u.porTipo[t.classificacao] ?? 0) + notas;
      if (!u.ultimaEmissao || t.ultima_emissao > u.ultimaEmissao) u.ultimaEmissao = t.ultima_emissao;
    }
    for (const r of recentes) linha(r.emitida_por).hoje += 1;

    const usuarios = [...porUsuario.values()].sort((a, b) => b.hoje - a.hoje || b.total - a.total);
    return Response.json({ usuarios, atualizadoEm: new Date().toISOString() });
  } catch (erro) {
    return erroJson(`Não foi possível ler as emissões por usuário: ${erro.message}`);
  }
}
