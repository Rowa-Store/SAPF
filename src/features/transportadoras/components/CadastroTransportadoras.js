// /pedidos/transportadoras — cadastro das transportadoras do atacado e dos
// clientes que usam cada uma. Cliente (CNPJ) anexado a uma transportadora
// ativa tem a nota de atacado/franquia com o transporte dela em vez dos
// Correios (ver transporte.js e a rota do preview do pedido). Nada aqui grava
// no Tiny nem depende do cadastro de transportadoras de lá: os dados daqui vão
// direto na nota, a partir do próximo rascunho do cliente.

'use client';

import AbasAtacado from '@/components/ui/AbasAtacado';
import Modal from '@/components/ui/Modal';
import { formatarCnpj, formatarDataCurta } from '@/lib/format';
import { useTransportadoras } from '../hooks/useTransportadoras';

const CAMPOS = [
  {
    campo: 'nome',
    rotulo: 'Nome (razão social) *',
    largo: true,
  },
  { campo: 'cnpj', rotulo: 'CNPJ *', dica: 'Com ou sem máscara.' },
  { campo: 'ie', rotulo: 'Inscrição estadual', dica: 'Vazio para transportadora isenta.' },
  {
    campo: 'forma_frete',
    rotulo: 'Forma de frete (serviço)',
    dica: 'Rótulo inteiro do serviço, como no cadastro da Olist. Vazio = não vai na nota.',
    largo: true,
  },
  { campo: 'endereco', rotulo: 'Endereço *', largo: true },
  { campo: 'cidade', rotulo: 'Cidade *', dica: 'Escrita como na tabela de cidades do Tiny (com acento).' },
  { campo: 'uf', rotulo: 'UF *', maxLength: 2 },
];

const OBRIGATORIOS = ['nome', 'cnpj', 'endereco', 'cidade', 'uf'];

function FormularioTransportadora({ formulario, atualizarCampo, salvar, fechar }) {
  const { dados, salvando, erro, id } = formulario;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className="campos">
        {CAMPOS.map(({ campo, rotulo, dica, largo, maxLength }) => (
          <div key={campo} className={largo ? 'campo-largo' : undefined}>
            <label htmlFor={`t-${campo}`}>{rotulo}</label>
            <input
              id={`t-${campo}`}
              value={dados[campo] ?? ''}
              maxLength={maxLength}
              required={OBRIGATORIOS.includes(campo)}
              onChange={(e) => atualizarCampo(campo, e.target.value)}
            />
            {dica && <div className="fraco">{dica}</div>}
          </div>
        ))}
      </div>
      <label className="campo-check">
        <input type="checkbox" checked={dados.ativo} onChange={(e) => atualizarCampo('ativo', e.target.checked)} />
        Ativa — desmarcada, os clientes anexados voltam a sair pelos Correios (o anexo é mantido)
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
        <button type="submit" disabled={salvando || OBRIGATORIOS.some((c) => !String(dados[c] ?? '').trim())}>
          {salvando ? 'Salvando…' : id ? 'Salvar alterações' : 'Cadastrar'}
        </button>
      </div>
    </form>
  );
}

function ListaClientes({ clientes, removerCliente, abrirAnexo }) {
  const { transportadora, lista, carregando, erro, removendo } = clientes;
  return (
    <>
      {erro && (
        <div className="aviso">
          <p style={{ margin: 0 }}>{erro}</p>
        </div>
      )}
      {carregando ? (
        <p className="fraco">Carregando clientes…</p>
      ) : !lista?.length ? (
        <div className="vazio">Nenhum cliente anexado. As notas saem pelos Correios.</div>
      ) : (
        <div className="lista-rolavel">
          <table>
            <thead>
              <tr>
                <th>CNPJ</th>
                <th>Cliente</th>
                <th>Anexado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.cnpj}>
                  <td className="mono">{formatarCnpj(c.cnpj)}</td>
                  <td>{c.nome || <span className="fraco">—</span>}</td>
                  <td>{formatarDataCurta(c.criado_em)}</td>
                  <td>
                    <button
                      className="secundario pequeno"
                      onClick={() => removerCliente(c.cnpj)}
                      disabled={!!removendo}
                      title="Solta o cliente: as próximas notas dele saem pelos Correios"
                    >
                      {removendo === c.cnpj ? 'Removendo…' : 'Remover'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="rodape-modal">
        <span className="fraco" style={{ marginRight: 'auto' }}>
          {lista ? `${lista.length} cliente(s)` : ''}
        </span>
        <button className="secundario" onClick={() => abrirAnexo(transportadora)}>
          Anexar cliente
        </button>
      </div>
    </>
  );
}

function FormularioAnexo({ anexo, atualizarAnexo, anexar, fechar }) {
  const { transportadora, cnpj, nome, enviando, erro, emOutra, ultimo } = anexo;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        anexar();
      }}
    >
      <p className="fraco" style={{ marginTop: 0 }}>
        O CNPJ é a chave: cada cliente usa uma transportadora só. As próximas notas deste cliente saem com{' '}
        <strong>{transportadora.nome}</strong> em vez dos Correios.
      </p>
      <div className="campos">
        <div>
          <label htmlFor="anexo-cnpj">CNPJ do cliente *</label>
          <input
            id="anexo-cnpj"
            autoFocus
            placeholder="00.000.000/0000-00"
            value={cnpj}
            onChange={(e) => atualizarAnexo('cnpj', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="anexo-nome">Nome do cliente (opcional)</label>
          <input id="anexo-nome" value={nome} onChange={(e) => atualizarAnexo('nome', e.target.value)} />
        </div>
      </div>

      {ultimo && !erro && (
        <div className="aviso aviso-ok">
          <p style={{ margin: 0 }}>
            CNPJ <span className="mono">{formatarCnpj(ultimo.cnpj)}</span> anexado. Pode anexar o próximo.
          </p>
        </div>
      )}
      {erro && (
        <div className="aviso">
          <p style={{ margin: 0 }}>{erro}</p>
          {emOutra && (
            <div className="grupo-botoes" style={{ marginTop: '0.6rem' }}>
              <button type="button" className="pequeno" onClick={() => anexar({ mover: true })} disabled={enviando}>
                Mover para {transportadora.nome}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rodape-modal">
        <button type="button" className="secundario" onClick={fechar}>
          Fechar
        </button>
        <button type="submit" disabled={enviando || !cnpj.trim()}>
          {enviando ? 'Anexando…' : 'Anexar'}
        </button>
      </div>
    </form>
  );
}

export default function CadastroTransportadoras() {
  const {
    transportadoras,
    erro,
    aviso,
    setAviso,
    formulario,
    abrirNova,
    abrirEdicao,
    atualizarCampo,
    salvar,
    fecharFormulario,
    clientes,
    abrirClientes,
    removerCliente,
    fecharClientes,
    anexo,
    abrirAnexo,
    atualizarAnexo,
    anexar,
    fecharAnexo,
  } = useTransportadoras();

  function fecharAnexoEVoltar() {
    fecharAnexo();
    // Veio da lista de clientes: volta para ela já com o anexo novo.
    if (clientes) abrirClientes(clientes.transportadora);
  }

  return (
    <>
      <AbasAtacado />
      <div className="cabecalho-pagina">
        <h2>Transportadoras do atacado</h2>
        <div className="grupo-botoes">
          <button onClick={abrirNova}>Nova transportadora</button>
        </div>
      </div>

      <p className="fraco">
        O metafield <span className="mono">transportadora</span> do pedido no Shopify decide o transporte:
        &quot;correios&quot;, &quot;retirada&quot; (nota sem transportadora) ou o nome — ou um pedaço dele — de uma
        transportadora daqui. Em branco, cliente com o CNPJ anexado a uma transportadora ativa sai com ela; os
        demais, pelos Correios. Vale para os próximos rascunhos; os já enviados ao Tiny não mudam.
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
          <strong>Não foi possível carregar as transportadoras.</strong>
          <p>{erro}</p>
          <p>Confira em Sys Info se o Supabase está configurado e se supabase/transportadoras.sql já foi rodado.</p>
        </div>
      )}

      {!transportadoras ? (
        !erro && <p className="fraco">Carregando transportadoras…</p>
      ) : transportadoras.length === 0 ? (
        <div className="vazio">Nenhuma transportadora cadastrada ainda.</div>
      ) : (
        <div className="tabela-rolavel">
          <table className="tabela-controle">
            <thead>
              <tr>
                <th>Transportadora</th>
                <th>CNPJ</th>
                <th>Forma de frete</th>
                <th className="num">Clientes</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {transportadoras.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="forte">{t.nome}</div>
                    {(t.cidade || t.uf) && (
                      <div className="fraco">{[t.cidade, t.uf].filter(Boolean).join(' / ')}</div>
                    )}
                    {!t.ativo && <span className="marca marca-erro">inativa</span>}
                  </td>
                  <td className="mono">{t.cnpj ? formatarCnpj(t.cnpj) : <span className="fraco">—</span>}</td>
                  <td>{t.forma_frete || <span className="fraco">não informada</span>}</td>
                  <td className="num">{t.totalClientes}</td>
                  <td>
                    <div className="acoes-linha">
                      <button className="pequeno secundario" onClick={() => abrirEdicao(t)}>
                        Editar
                      </button>
                      <button className="pequeno secundario" onClick={() => abrirClientes(t)}>
                        Ver clientes
                      </button>
                      <button className="pequeno" onClick={() => abrirAnexo(t)}>
                        Anexar cliente
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        aberto={!!formulario}
        titulo={formulario?.id ? 'Editar transportadora' : 'Nova transportadora'}
        aoFechar={fecharFormulario}
        largura="44rem"
      >
        {formulario && (
          <FormularioTransportadora
            formulario={formulario}
            atualizarCampo={atualizarCampo}
            salvar={salvar}
            fechar={fecharFormulario}
          />
        )}
      </Modal>

      <Modal
        aberto={!!clientes && !anexo}
        titulo={clientes ? `Clientes de ${clientes.transportadora.nome}` : ''}
        aoFechar={fecharClientes}
        largura="44rem"
      >
        {clientes && <ListaClientes clientes={clientes} removerCliente={removerCliente} abrirAnexo={abrirAnexo} />}
      </Modal>

      <Modal
        aberto={!!anexo}
        titulo={anexo ? `Anexar cliente a ${anexo.transportadora.nome}` : ''}
        aoFechar={fecharAnexoEVoltar}
      >
        {anexo && (
          <FormularioAnexo anexo={anexo} atualizarAnexo={atualizarAnexo} anexar={anexar} fechar={fecharAnexoEVoltar} />
        )}
      </Modal>
    </>
  );
}
