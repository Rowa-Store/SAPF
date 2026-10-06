// /pedidos/clientes — cadastro dos clientes franqueados (tabela client_exce).
// Pedido de cliente com o CNPJ aqui, ativo, é classificado como franquia em
// vez de atacado (ver classificacao.js) e usa o markup cadastrado, se houver.
// Vale para os próximos rascunhos; os já enviados ao Tiny não mudam.

'use client';

import AbasAtacado from '@/components/ui/AbasAtacado';
import Modal from '@/components/ui/Modal';
import { formatarCnpj, formatarDataCurta } from '@/lib/format';
import { formatarMarkup, MARKUP_PADRAO } from '@/lib/fiscal/markup';
import { useFranquias } from '../hooks/useFranquias';

function FormularioFranquia({ formulario, atualizarCampo, salvar, fechar }) {
  const { dados, salvando, erro } = formulario;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className="campos">
        <div>
          <label htmlFor="f-cnpj">CNPJ *</label>
          <input
            id="f-cnpj"
            autoFocus
            required
            placeholder="00.000.000/0000-00"
            value={dados.cnpj}
            onChange={(e) => atualizarCampo('cnpj', e.target.value)}
          />
          <div className="fraco">Com ou sem máscara.</div>
        </div>
        <div>
          <label htmlFor="f-apelido">Nome da franquia</label>
          <input id="f-apelido" value={dados.apelido} onChange={(e) => atualizarCampo('apelido', e.target.value)} />
        </div>
        <div>
          <label htmlFor="f-markup">Markup</label>
          <input
            id="f-markup"
            inputMode="decimal"
            placeholder={formatarMarkup(MARKUP_PADRAO.franquia)}
            value={dados.markup}
            onChange={(e) => atualizarCampo('markup', e.target.value)}
          />
          <div className="fraco">Vazio = padrão de franquia ({formatarMarkup(MARKUP_PADRAO.franquia)}).</div>
        </div>
      </div>
      <label className="campo-check">
        <input type="checkbox" checked={dados.ativo} onChange={(e) => atualizarCampo('ativo', e.target.checked)} />
        Ativo — desmarcado, os pedidos deste CNPJ voltam a ser tratados como atacado
      </label>
      {erro && (
        <div className="aviso">
          <p style={{ margin: 0 }}>{erro}</p>
        </div>
      )}
      <div className="rodape-modal">
        <button type="button" className="secundario" onClick={fechar}>
          Cancelar
        </button>
        <button type="submit" disabled={salvando || !dados.cnpj.trim()}>
          {salvando ? 'Salvando…' : 'Cadastrar'}
        </button>
      </div>
    </form>
  );
}

export default function CadastroFranquias() {
  const { franquias, erro, aviso, setAviso, formulario, abrirNova, atualizarCampo, salvar, fecharFormulario } =
    useFranquias();

  return (
    <>
      <AbasAtacado />
      <div className="cabecalho-pagina">
        <h2>Clientes franqueados</h2>
        <div className="grupo-botoes">
          <button onClick={abrirNova}>Novo cliente</button>
        </div>
      </div>

      <p className="fraco">
        Pedido de cliente com o CNPJ cadastrado aqui é tratado como franquia em vez de atacado — vale para os
        próximos rascunhos; os já enviados ao Tiny não mudam.
      </p>

      {aviso && (
        <div className="aviso aviso-ok aviso-fechavel">
          <p style={{ margin: 0 }}>{aviso}</p>
          <button className="secundario pequeno" onClick={() => setAviso(null)} aria-label="Fechar aviso">
            Fechar
          </button>
        </div>
      )}

      {erro && (
        <div className="aviso">
          <strong>Não foi possível carregar os clientes.</strong>
          <p>{erro}</p>
          <p>Confira em Sys Info se o Supabase está configurado e se supabase/client-exce.sql já foi rodado.</p>
        </div>
      )}

      {!franquias ? (
        !erro && <p className="fraco">Carregando clientes…</p>
      ) : franquias.length === 0 ? (
        <div className="vazio">Nenhum cliente franqueado cadastrado ainda.</div>
      ) : (
        <div className="tabela-rolavel">
          <table className="tabela-controle">
            <thead>
              <tr>
                <th>Franquia</th>
                <th>CNPJ</th>
                <th className="num">Markup</th>
                <th>Cadastrado em</th>
              </tr>
            </thead>
            <tbody>
              {franquias.map((f) => (
                <tr key={f.cnpj}>
                  <td>
                    <div className="forte">{f.apelido || <span className="fraco">—</span>}</div>
                    {!f.ativo && <span className="marca marca-erro">inativo</span>}
                  </td>
                  <td className="mono">{formatarCnpj(f.cnpj)}</td>
                  <td className="num">
                    {f.markup == null ? <span className="fraco">padrão</span> : formatarMarkup(f.markup)}
                  </td>
                  <td>{formatarDataCurta(f.criado_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal aberto={!!formulario} titulo="Novo cliente franqueado" aoFechar={fecharFormulario} largura="44rem">
        {formulario && (
          <FormularioFranquia
            formulario={formulario}
            atualizarCampo={atualizarCampo}
            salvar={salvar}
            fechar={fecharFormulario}
          />
        )}
      </Modal>
    </>
  );
}
