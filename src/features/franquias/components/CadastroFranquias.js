// /pedidos/clientes — cadastro dos clientes franqueados (tabela client_exce).
// Pedido de cliente com o CNPJ aqui, ativo, é classificado como franquia em
// vez de atacado (ver classificacao.js) e usa o markup cadastrado, se houver.
// A IE e a transportadora escolhidas aqui são as mesmas que a nota usa
// (clientes_ie e /pedidos/transportadoras). Vale para os próximos rascunhos;
// os já enviados ao Tiny não mudam.

'use client';

import AbasAtacado from '@/components/ui/AbasAtacado';
import Modal from '@/components/ui/Modal';
import { formatarCnpj, formatarDataCurta } from '@/lib/format';
import { formatarMarkup, MARKUP_PADRAO } from '@/lib/fiscal/markup';
import { useFranquias } from '../hooks/useFranquias';

// Seções do formulário. `largo` ocupa a linha inteira.
const SECOES = [
  {
    titulo: 'Identificação',
    campos: [
      { campo: 'apelido', rotulo: 'Nome da franquia', dica: 'Como aparece nas listas.' },
      { campo: 'razao_social', rotulo: 'Razão social' },
      {
        campo: 'ie',
        rotulo: 'Inscrição estadual',
        dica: 'A mesma que vai na nota. Vazio = consulta o SintegrAPI no próximo pedido.',
        inputMode: 'numeric',
      },
    ],
  },
  {
    titulo: 'Contato',
    campos: [
      { campo: 'contato', rotulo: 'Responsável' },
      { campo: 'email', rotulo: 'E-mail', tipo: 'email' },
      { campo: 'telefone', rotulo: 'Telefone', tipo: 'tel', placeholder: '(00) 00000-0000' },
    ],
  },
  {
    titulo: 'Endereço',
    campos: [
      { campo: 'cep', rotulo: 'CEP', inputMode: 'numeric', placeholder: '00000-000' },
      { campo: 'logradouro', rotulo: 'Logradouro', largo: true },
      { campo: 'numero', rotulo: 'Número' },
      { campo: 'complemento', rotulo: 'Complemento' },
      { campo: 'bairro', rotulo: 'Bairro' },
      { campo: 'cidade', rotulo: 'Cidade' },
      { campo: 'uf', rotulo: 'UF', maxLength: 2 },
    ],
  },
];

function CampoTexto({ dados, atualizarCampo, campo, rotulo, dica, largo, tipo, inputMode, placeholder, maxLength }) {
  return (
    <div className={largo ? 'campo-largo' : undefined}>
      <label htmlFor={`f-${campo}`}>{rotulo}</label>
      <input
        id={`f-${campo}`}
        type={tipo ?? 'text'}
        inputMode={inputMode}
        placeholder={placeholder}
        maxLength={maxLength}
        value={dados[campo] ?? ''}
        onChange={(e) => atualizarCampo(campo, e.target.value)}
      />
      {dica && <div className="fraco">{dica}</div>}
    </div>
  );
}

function FormularioFranquia({ formulario, transportadoras, atualizarCampo, salvar, pedirExclusao, excluir, fechar }) {
  const { dados, salvando, erro, cnpjOriginal, transportadoraAtual, confirmandoExclusao, excluindo } = formulario;
  const editando = !!cnpjOriginal;

  // Ativas para escolher. A atual entra sempre — mesmo inativa ou se a lista
  // não carregou —, senão o select cairia em "Correios" e salvar soltaria o
  // cliente sem ninguém pedir.
  const opcoes = transportadoras.filter((t) => t.ativo !== false || String(t.id) === dados.transportadoraId);
  if (transportadoraAtual && !opcoes.some((t) => String(t.id) === String(transportadoraAtual.id))) {
    opcoes.unshift(transportadoraAtual);
  }
  const escolhida = opcoes.find((t) => String(t.id) === dados.transportadoraId);

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
          {editando ? (
            <input id="f-cnpj" className="mono" value={formatarCnpj(cnpjOriginal)} readOnly disabled />
          ) : (
            <input
              id="f-cnpj"
              autoFocus
              required
              placeholder="00.000.000/0000-00"
              value={dados.cnpj}
              onChange={(e) => atualizarCampo('cnpj', e.target.value)}
            />
          )}
          <div className="fraco">{editando ? 'O CNPJ é a chave do cadastro e não muda.' : 'Com ou sem máscara.'}</div>
        </div>
      </div>

      {SECOES.map(({ titulo, campos }) => (
        <fieldset key={titulo} className="secao-form">
          <legend>{titulo}</legend>
          <div className="campos">
            {campos.map((c) => (
              <CampoTexto key={c.campo} dados={dados} atualizarCampo={atualizarCampo} {...c} />
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="secao-form">
        <legend>Faturamento e frete</legend>
        <div className="campos">
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
          <div>
            <label htmlFor="f-transportadora">Transportadora</label>
            <select
              id="f-transportadora"
              value={dados.transportadoraId}
              onChange={(e) => atualizarCampo('transportadoraId', e.target.value)}
            >
              <option value="">Nenhuma — notas saem pelos Correios</option>
              {opcoes.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.nome}
                  {t.ativo === false ? ' (inativa)' : ''}
                </option>
              ))}
            </select>
            <div className="fraco">
              {escolhida?.ativo === false
                ? 'Esta transportadora está inativa: as notas saem pelos Correios até ela ser reativada.'
                : 'Trocar aqui muda a transportadora das próximas notas deste cliente.'}
            </div>
          </div>
          <div className="campo-largo">
            <label htmlFor="f-observacoes">Observações</label>
            <textarea
              id="f-observacoes"
              rows={3}
              value={dados.observacoes ?? ''}
              onChange={(e) => atualizarCampo('observacoes', e.target.value)}
            />
          </div>
        </div>
      </fieldset>

      <label className="campo-check">
        <input type="checkbox" checked={dados.ativo} onChange={(e) => atualizarCampo('ativo', e.target.checked)} />
        Ativo — desmarcado, os pedidos deste CNPJ voltam a ser tratados como atacado
      </label>
      {erro && (
        <div className="aviso">
          <p style={{ margin: 0 }}>{erro}</p>
        </div>
      )}
      {confirmandoExclusao && (
        <div className="aviso">
          <p style={{ margin: 0 }}>
            <strong>Excluir o cadastro de {dados.apelido || dados.razao_social || formatarCnpj(cnpjOriginal)}?</strong>{' '}
            Os próximos pedidos deste CNPJ passam a ser tratados como atacado, e os dados cadastrais e o markup se
            perdem. A IE e a transportadora do CNPJ continuam valendo. Os rascunhos já enviados ao Tiny não mudam.
          </p>
          <div className="grupo-botoes" style={{ marginTop: '0.6rem' }}>
            <button type="button" className="perigo pequeno" onClick={excluir} disabled={excluindo}>
              {excluindo ? 'Excluindo…' : 'Excluir de vez'}
            </button>
            <button type="button" className="secundario pequeno" onClick={() => pedirExclusao(false)} disabled={excluindo}>
              Manter o cadastro
            </button>
          </div>
        </div>
      )}
      <div className="rodape-modal">
        {editando && !confirmandoExclusao && (
          <button type="button" className="secundario perigo-texto" style={{ marginRight: 'auto' }} onClick={() => pedirExclusao(true)}>
            Excluir cadastro
          </button>
        )}
        <button type="button" className="secundario" onClick={fechar}>
          Cancelar
        </button>
        <button type="submit" disabled={salvando || excluindo || confirmandoExclusao || (!editando && !dados.cnpj.trim())}>
          {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar'}
        </button>
      </div>
    </form>
  );
}

function CelulaTransportadora({ transportadora }) {
  if (!transportadora) return <span className="fraco">Correios</span>;
  return (
    <>
      <div>{transportadora.nome}</div>
      {transportadora.ativo === false && <span className="marca marca-erro">inativa — sai pelos Correios</span>}
    </>
  );
}

export default function CadastroFranquias() {
  const {
    franquias,
    filtradas,
    transportadoras,
    erro,
    aviso,
    setAviso,
    busca,
    setBusca,
    formulario,
    abrirNova,
    abrirEdicao,
    atualizarCampo,
    salvar,
    pedirExclusao,
    excluir,
    fecharFormulario,
  } = useFranquias();

  const ativos = franquias?.filter((f) => f.ativo).length ?? 0;

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
        Pedido de cliente com o CNPJ cadastrado aqui é tratado como franquia em vez de atacado. Clique num cliente para
        ver e editar o cadastro completo, inclusive a transportadora. Vale para os próximos rascunhos; os já enviados ao
        Tiny não mudam.
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
        <div className="vazio">
          Nenhum cliente franqueado cadastrado ainda.{' '}
          <button className="link" onClick={abrirNova}>
            Cadastrar o primeiro
          </button>
        </div>
      ) : (
        <>
          <div className="linha-busca">
            <input
              type="search"
              placeholder="Buscar por nome, razão social, CNPJ, cidade ou transportadora…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar cliente"
            />
          </div>
          <p className="fraco" style={{ margin: '0 0 0.75rem' }}>
            {busca.trim()
              ? `${filtradas.length} de ${franquias.length} cliente(s)`
              : `${franquias.length} cliente(s) · ${ativos} ativo(s)`}
          </p>

          {filtradas.length === 0 ? (
            <div className="vazio">Nenhum cliente com essa busca.</div>
          ) : (
            <div className="tabela-rolavel">
              <table className="tabela-controle">
                <thead>
                  <tr>
                    <th>Franquia</th>
                    <th>CNPJ</th>
                    <th>Cidade</th>
                    <th>Transportadora</th>
                    <th className="num">Markup</th>
                    <th>Cadastrado em</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((f) => (
                    <tr key={f.cnpj} className="linha-clicavel" onClick={() => abrirEdicao(f)}>
                      <td>
                        <div className="forte">{f.apelido || f.razao_social || <span className="fraco">—</span>}</div>
                        {f.apelido && f.razao_social && <div className="fraco">{f.razao_social}</div>}
                        {!f.ativo && <span className="marca marca-erro">inativo</span>}
                      </td>
                      <td className="mono">{formatarCnpj(f.cnpj)}</td>
                      <td>
                        {f.cidade || f.uf ? (
                          [f.cidade, f.uf].filter(Boolean).join(' / ')
                        ) : (
                          <span className="fraco">—</span>
                        )}
                      </td>
                      <td>
                        <CelulaTransportadora transportadora={f.transportadora} />
                      </td>
                      <td className="num">
                        {f.markup == null ? <span className="fraco">padrão</span> : formatarMarkup(f.markup)}
                      </td>
                      <td>{formatarDataCurta(f.criado_em)}</td>
                      <td>
                        <button
                          className="pequeno secundario"
                          onClick={(e) => {
                            e.stopPropagation();
                            abrirEdicao(f);
                          }}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal
        aberto={!!formulario}
        titulo={formulario?.cnpjOriginal ? 'Editar cliente franqueado' : 'Novo cliente franqueado'}
        aoFechar={fecharFormulario}
        largura="52rem"
      >
        {formulario && (
          <FormularioFranquia
            formulario={formulario}
            transportadoras={transportadoras}
            atualizarCampo={atualizarCampo}
            salvar={salvar}
            pedirExclusao={pedirExclusao}
            excluir={excluir}
            fechar={fecharFormulario}
          />
        )}
      </Modal>
    </>
  );
}
