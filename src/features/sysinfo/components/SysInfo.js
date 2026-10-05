// /sysinfo — mostra se as integrações estão respondendo. É o lugar para
// conferir se as variáveis de ambiente foram preenchidas corretamente.

'use client';

import { useSaude } from '../hooks/useSaude';

export default function SysInfo() {
  const { saude, erro } = useSaude();

  return (
    <>
      <div className="cabecalho-pagina">
        <h2>Situação das integrações</h2>
      </div>

      {erro && <p className="aviso">Não foi possível consultar o status: {erro}</p>}
      {!saude && !erro && <p className="fraco">Consultando os três serviços…</p>}

      {saude && (
        <table>
          <thead>
            <tr>
              <th>Serviço</th>
              <th>Situação</th>
              <th>Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {saude.servicos.map((s) => (
              <tr key={s.servico}>
                <td>{s.servico}</td>
                <td>
                  <span className={s.ok ? 'marca marca-ok' : 'marca marca-erro'}>
                    {s.ok ? 'respondendo' : 'com problema'}
                  </span>
                </td>
                <td className="fraco">{s.detalhe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
