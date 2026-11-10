// /varejo/emissoes — quantas notas cada usuário emitiu pelo SAP, atualizado
// sozinho a cada poucos segundos. Só o admin abre.

'use client';

import { formatarDataHoraCurta } from '@/lib/format';
import { INTERVALO_MS, useEmissoes } from '../hooks/useEmissoes';

export default function EmissoesPorUsuario() {
  const { dados, erro } = useEmissoes();
  const b2b = (u) => (u.porTipo.atacado ?? 0) + (u.porTipo.franquia ?? 0);

  return (
    <>
      <div className="cabecalho-pagina">
        <h2>Notas emitidas por usuário</h2>
        {dados && (
          <span className="fraco">
            Atualiza a cada {INTERVALO_MS / 1000} s · última leitura{' '}
            {new Date(dados.atualizadoEm).toLocaleTimeString('pt-BR')}
          </span>
        )}
      </div>

      {erro && (
        <div className="aviso">
          <strong>Não foi possível atualizar a contagem.</strong>
          <p style={{ marginBottom: 0 }}>{erro}</p>
        </div>
      )}

      {!dados ? (
        !erro && <p className="fraco">Carregando…</p>
      ) : dados.usuarios.length === 0 ? (
        <div className="vazio">Nenhuma nota emitida com usuário registrado ainda.</div>
      ) : (
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th className="num">Hoje</th>
                <th className="num">Total</th>
                <th className="num">B2C</th>
                <th className="num">B2B</th>
                <th>Última emissão</th>
              </tr>
            </thead>
            <tbody>
              {dados.usuarios.map((u) => (
                <tr key={u.email}>
                  <td>{u.email}</td>
                  <td className="num forte">{u.hoje}</td>
                  <td className="num">{u.total}</td>
                  <td className="num">{u.porTipo.varejo ?? 0}</td>
                  <td className="num">{b2b(u)}</td>
                  <td className="fraco">{formatarDataHoraCurta(u.ultimaEmissao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="fraco">
        Conta só as notas emitidas pelo botão do SAP com login. Notas emitidas direto no Tiny ou antes do login não
        têm usuário.
      </p>
    </>
  );
}
