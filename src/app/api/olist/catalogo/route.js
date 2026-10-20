// GET /api/olist/catalogo?pagina=1 — uma página do catálogo da Olist (Tiny)
// para o diagnóstico: com o catálogo em mãos, a tela manda para a comparação
// os registros que casam com cada produto, e o servidor não precisa
// pesquisar por nome nem por SKU (ver produtoPaiNoTiny). Só lê.

import { erroDeLimite, paginaDoCatalogo } from '@/lib/integrations/tiny';
import { erroJson } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request) {
  const pagina = Math.max(1, Number(new URL(request.url).searchParams.get('pagina')) || 1);
  try {
    const { itens, paginas } = await paginaDoCatalogo(pagina);
    return Response.json({
      paginas,
      itens: itens.map((p) => ({
        id: String(p.id),
        nome: p.nome ?? '',
        codigo: p.codigo ?? '',
        tipoVariacao: p.tipoVariacao ?? '',
        situacao: p.situacao ?? '',
        preco: p.preco ?? null,
      })),
    });
  } catch (e) {
    if (erroDeLimite(e.message)) return erroJson('Limite de chamadas por minuto da Olist atingido.', 429, { limite: true });
    return erroJson(e.message, 502);
  }
}
