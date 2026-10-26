'use client';

import { formatarDia } from '@/lib/datas';

/**
 * Navegação das listas paginadas por dia (atacado, boletos): os botões andam
 * um dia por vez, o campo de data pula direto e não passa de hoje.
 */
export default function NavegacaoDia({ dia, diaDeHoje, carregando, irParaDia, diaAnterior, diaSeguinte }) {
  if (!dia) return null;
  return (
    <div className="navegacao-dia">
      <label htmlFor="dia">Dia</label>
      <div className="navegacao-dia-controles">
        <button className="secundario pequeno" onClick={diaAnterior} disabled={carregando} aria-label="Dia anterior">
          ←
        </button>
        <input
          id="dia"
          type="date"
          value={dia}
          max={diaDeHoje ?? undefined}
          onChange={(e) => irParaDia(e.target.value)}
          disabled={carregando}
        />
        <button
          className="secundario pequeno"
          onClick={diaSeguinte}
          disabled={carregando || dia === diaDeHoje}
          aria-label="Dia seguinte"
        >
          →
        </button>
        {dia === diaDeHoje ? (
          <span className="fraco">Hoje — {formatarDia(dia)}</span>
        ) : (
          <button className="secundario pequeno" onClick={() => irParaDia(diaDeHoje)} disabled={carregando}>
            Voltar para hoje
          </button>
        )}
      </div>
    </div>
  );
}
