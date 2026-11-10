// /varejo/emissoes — quantas notas do B2C cada usuário emitiu pelo SAP, no
// dia e no mês, atualizado sozinho a cada poucos segundos. Admin e gerente.

'use client';

import { formatarDataHoraCurta } from '@/lib/format';
import { INTERVALO_MS, useEmissoes } from '../hooks/useEmissoes';

export default function EmissoesPorUsuario() {
  const { dados, erro } = useEmissoes();

  return (
    <>
      <div className="cabecalho-pagina">
        <h2>Notas B2C emitidas por usuário</h2>
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
        <div className="vazio">Nenhuma nota B2C emitida com usuário registrado neste mês.</div>
      ) : (
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>Usuário</th>
                <th className="num">Hoje</th>
                <th className="num">No mês</th>
                <th>Última emissão</th>
              </tr>
            </thead>
            <tbody>
              {dados.usuarios.map((u) => (
                <tr key={u.email}>
                  <td>{u.email}</td>
                  <td className="num forte">{u.hoje}</td>
                  <td className="num">{u.mes}</td>
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
