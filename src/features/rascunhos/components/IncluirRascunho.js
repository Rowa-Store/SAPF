// /pedidos/[id]/rascunho — conferência e inclusão do rascunho da nota no Tiny.
//
// É a primeira tela que se abre ao clicar num pedido da lista: cliente e itens
// chegam prontos e editáveis, e é aqui que se confere tudo antes de gravar. A
// tela só grava depois de duas ações da pessoa: clicar em "Incluir rascunho" e
// depois confirmar no aviso que aparece.

'use client';

import { useState } from 'react';
import Paginacao from '@/components/ui/Paginacao';
import { CAMPOS_CLIENTE } from '@/lib/fiscal/camposCliente';
import {
  DESCONTO_EXTRA_MAXIMO,
  MARKUPS_SUGERIDOS,
  MARKUP_MAXIMO,
  MARKUP_MINIMO,
  descontoDoMarkup,
  formatarMarkup,
} from '@/lib/fiscal/markup';
import { rotuloFormaPagamento } from '@/lib/fiscal/pagamento';
import { formatarMoeda } from '@/lib/format';
import { resumoDoTransporte } from '@/lib/fiscal/transporte';
import { useIncluirRascunho } from '../hooks/useIncluirRascunho';
import TrocarTransportadora from './TrocarTransportadora';

// Duração da transição de saída da linha (ver .linha-saindo em globals.css) —
// a remoção de verdade só acontece depois, senão a linha some sem animar.
const DURACAO_ANIMACAO_MS = 250;

export default function IncluirRascunho({ params }) {
  const { id } = params;

  const {
    dados,
    erroCarregamento,
    pagina,
    setPagina,
    clienteEditado,
    pedindoConfirmacao,
    setPedindoConfirmacao,
    enviando,
    erroEnvio,
    resultado,
    carregado,
    totalPaginas,
    itensDaPagina,
    totalNota,
    itensForamEditados,
    podeIncluir,
    itensRemovidos,
    markup,
    markupOriginal,
    alterarMarkup,
    descontoExtra,
    alterarDescontoExtra,
    transporte,
    setTransporte,
    transporteBloqueado,
    notaFiscalNaTela,
    atualizarCliente,
    atualizarItem,
    removerItem,
    restaurarItemRemovido,
    restaurarItens,
    confirmarInclusao,
    podeEmitir,
    pedindoConfirmacaoEmissao,
    setPedindoConfirmacaoEmissao,
    emitindo,
    erroEmissao,
    emissao,
    confirmarEmissao,
  } = useIncluirRascunho(id);

  const [saindoIndices, setSaindoIndices] = useState(() => new Set());
  const [markupDigitado, setMarkupDigitado] = useState('');
  const [erroMarkup, setErroMarkup] = useState(null);
  const [descontoDigitado, setDescontoDigitado] = useState('');
  const [erroDesconto, setErroDesconto] = useState(null);
  const [trocandoTransporte, setTrocandoTransporte] = useState(false);

  function handleMarkup(valor) {
    if (alterarMarkup(valor)) {
      setErroMarkup(null);
      setMarkupDigitado('');
    } else {
      setErroMarkup(
        `Markup inválido — use um número entre ${formatarMarkup(MARKUP_MINIMO)} e ${formatarMarkup(MARKUP_MAXIMO)}, como 2,4.`
      );
    }
  }

  function handleDesconto(valor) {
    if (alterarDescontoExtra(valor)) {
      setErroDesconto(null);
      setDescontoDigitado('');
    } else {
      setErroDesconto(`Desconto inválido — use um percentual entre 0 e ${DESCONTO_EXTRA_MAXIMO}, como 10 ou 7,5.`);
    }
  }

  function handleRemover(indiceGlobal) {
    setSaindoIndices((atual) => new Set(atual).add(indiceGlobal));
    setTimeout(() => {
      removerItem(indiceGlobal);
      setSaindoIndices((atual) => {
        const proximo = new Set(atual);
        proximo.delete(indiceGlobal);
        return proximo;
      });
    }, DURACAO_ANIMACAO_MS);
  }

  if (erroCarregamento && !dados) {
    return (
      <div className="aviso">
        <strong>Não foi possível abrir este pedido.</strong>
        <p>{erroCarregamento}</p>
        <p>
          <a href="/pedidos">Voltar para a tela de atacado</a>
        </p>
      </div>
    );
  }

  if (!carregado) return <p className="fraco">Lendo o pedido…</p>;

  // Transporte que o preview montou, no formato de transporteEscolhido — só
  // para a janela marcar o que está em uso.
  const transporteOriginal =
    dados.transporteInformado?.tipo === 'retirada'
      ? { tipo: 'retirada' }
      : dados.transportadora
        ? { tipo: 'transportadora', id: dados.transportadora.id }
        : dados.transporteBloqueado
          ? null
          : { tipo: 'correios' };

  return (
    <>
      <h2>
        Incluir rascunho — pedido {dados.pedido.name}{' '}
        <span className={`marca marca-${dados.classificacao}`}>{dados.classificacao}</span>{' '}
        {dados.markupOrigem === 'acessorio' && <span className="marca marca-acessorio">acessórios</span>}
      </h2>
      <p className="fraco">
        {dados.pedido.totalItens} itens lidos em {dados.pedido.paginasLidas} página(s).
        {dados.pedido.origemCnpj && ` CNPJ encontrado em ${dados.pedido.origemCnpj}.`}
      </p>

      {dados.notaEmitida ? (
        <div className="aviso">
          <strong>A nota deste pedido já foi emitida.</strong>
          <p>Nota {dados.tinyNotaId ?? 'sem id retornado'} já tem valor fiscal — não dá para enviar outro rascunho.</p>
        </div>
      ) : (
        dados.jaProcessado && (
          <div className="aviso">
            <strong>Este pedido já tem o rascunho {dados.tinyNotaId ?? 'sem id retornado'} no Tiny.</strong>
            <p>
              Dá para enviar um rascunho novo no lugar dele — se o Tiny acusar duplicidade, faça uma
              alteração mínima e envie de novo. O novo passa a ser o que &quot;Emitir nota&quot; emite; o
              antigo continua no Tiny e precisa ser cancelado ou excluído lá, à mão.
            </p>
          </div>
        )
      )}

      {dados.alertas.length > 0 && (
        <div className="aviso">
          <strong>Confira antes de continuar</strong>
          <ul>
            {dados.alertas.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {resultado && (
        <div className="aviso aviso-ok">
          <strong>Rascunho criado no Tiny — nota {resultado.tinyNotaId ?? 'sem id retornado'}.</strong>
          <p>{resultado.mensagem}</p>
          {resultado.contribuinte && (
            <p className={resultado.contribuinte.ok ? 'fraco' : undefined}>
              {resultado.contribuinte.mensagem}
            </p>
          )}
          {!emissao && <p>A nota pode ser emitida pelo botão &quot;Emitir nota&quot; no fim da página.</p>}
        </div>
      )}

      {emissao && (
        <div className="aviso aviso-ok">
          <strong>
            Nota {emissao.tinyNotaId} emitida{emissao.numeroNf ? ` — NF nº ${emissao.numeroNf}` : ''}.
          </strong>
          {!emissao.numeroNf && (
            <p>A SEFAZ ainda não devolveu o número — a tela de atacado confere de novo depois.</p>
          )}
          <p>
            <a href="/pedidos">Voltar para a tela de atacado</a>
          </p>
        </div>
      )}

      {erroEnvio && (
        <div className="aviso">
          <strong>A inclusão não foi concluída.</strong>
          <p>{erroEnvio}</p>
        </div>
      )}

      <h3>Dados do cliente na nota</h3>
      <div className="cartao campos">
        {CAMPOS_CLIENTE.map(([campo, rotulo]) => (
          <div key={campo}>
            <label htmlFor={campo}>{rotulo}</label>
            <input
              id={campo}
              value={clienteEditado?.[campo] ?? ''}
              onChange={(e) => atualizarCliente(campo, e.target.value)}
              disabled={!!resultado}
            />
          </div>
        ))}
      </div>

      <h3>
        Itens da nota
        {itensForamEditados && (
          <button
            className="secundario"
            style={{ marginLeft: '1rem', padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
            onClick={restaurarItens}
            disabled={!!resultado}
          >
            Restaurar valores originais
          </button>
        )}
      </h3>
      {/* Markup da nota inteira: valor unitário = preço do Shopify ÷ markup
          (ver markup.js). O padrão vem do cadastro da franquia, quando ela
          tem markup próprio, ou da classificação; trocar aqui refaz todos os
          itens, inclusive os que foram editados à mão. Ao lado, o desconto
          extra em % sobre o valor que já saiu do markup. */}
      <div
        className="cartao"
        style={{ marginBottom: '1rem', display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}
      >
        <div style={{ flex: '1 1 22rem' }}>
          <div>
            <strong>
              Markup dos itens: {formatarMarkup(markup)} ({formatarMarkup(descontoDoMarkup(markup))}% de
              desconto sobre o preço do Shopify)
            </strong>
          </div>
          <div className="fraco">
            {dados.markupOrigem === 'franquia'
              ? 'Padrão desta franquia'
              : dados.markupOrigem === 'acessorio'
                ? 'Padrão de franquia para acessórios (primeiro item do pedido)'
                : `Padrão para ${dados.classificacao}`}
            :{' '}
            {formatarMarkup(markupOriginal)} (
            {formatarMarkup(descontoDoMarkup(markupOriginal))}%).
          </div>
          {markup !== markupOriginal && (
            <p style={{ margin: '0.5rem 0 0' }}>
              <strong>Esta nota vai com markup diferente do padrão.</strong> Todos os itens foram
              recalculados com o novo markup.
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem' }}>
            {MARKUPS_SUGERIDOS.map((m) => (
              <button
                key={m}
                className={m === markup ? undefined : 'secundario'}
                style={{ padding: '0.15rem 0.6rem', fontSize: '0.85rem' }}
                onClick={() => handleMarkup(m)}
                disabled={!!resultado}
              >
                {formatarMarkup(m)}
              </button>
            ))}
            <input
              aria-label="Outro markup"
              placeholder="Outro (ex.: 2,35)"
              inputMode="decimal"
              style={{ width: '9rem' }}
              value={markupDigitado}
              onChange={(e) => setMarkupDigitado(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleMarkup(markupDigitado)}
              disabled={!!resultado}
            />
            <button
              className="secundario"
              style={{ padding: '0.15rem 0.6rem', fontSize: '0.85rem' }}
              onClick={() => handleMarkup(markupDigitado)}
              disabled={!!resultado || !markupDigitado.trim()}
            >
              Aplicar
            </button>
          </div>
          {erroMarkup && <p style={{ margin: '0.5rem 0 0' }}>{erroMarkup}</p>}
        </div>

        <div style={{ flex: '1 1 16rem' }}>
          <div>
            <strong>Desconto extra: {formatarMarkup(descontoExtra)}%</strong>
          </div>
          <div className="fraco">Sobre o valor com markup, abatido de cada item.</div>
          {descontoExtra > 0 && (
            <p style={{ margin: '0.5rem 0 0' }}>
              <strong>Esta nota vai com {formatarMarkup(descontoExtra)}% de desconto nos itens.</strong>
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.5rem' }}>
            <input
              aria-label="Desconto extra em percentual"
              placeholder="% (ex.: 10)"
              inputMode="decimal"
              style={{ width: '7rem' }}
              value={descontoDigitado}
              onChange={(e) => setDescontoDigitado(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDesconto(descontoDigitado)}
              disabled={!!resultado}
            />
            <button
              className="secundario"
              style={{ padding: '0.15rem 0.6rem', fontSize: '0.85rem' }}
              onClick={() => handleDesconto(descontoDigitado)}
              disabled={!!resultado || !descontoDigitado.trim()}
            >
              Aplicar
            </button>
            {descontoExtra > 0 && (
              <button
                className="secundario"
                style={{ padding: '0.15rem 0.6rem', fontSize: '0.85rem' }}
                onClick={() => handleDesconto(0)}
                disabled={!!resultado}
              >
                Remover
              </button>
            )}
          </div>
          {erroDesconto && <p style={{ margin: '0.5rem 0 0' }}>{erroDesconto}</p>}
        </div>
      </div>


      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Descrição</th>
            <th className="num">Qtd.</th>
            <th className="num">Valor unitário</th>
            <th className="num">Total da linha</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {itensDaPagina.map(({ item, indiceGlobal }) => (
            <tr key={indiceGlobal} className={saindoIndices.has(indiceGlobal) ? 'linha-saindo' : undefined}>
              <td>
                <input
                  className="mono"
                  value={item.codigo}
                  onChange={(e) => atualizarItem(indiceGlobal, 'codigo', e.target.value)}
                  disabled={!!resultado}
                />
              </td>
              <td>
                <input
                  value={item.descricao}
                  onChange={(e) => atualizarItem(indiceGlobal, 'descricao', e.target.value)}
                  disabled={!!resultado}
                />
              </td>
              <td className="num">
                <input
                  type="number"
                  min="0"
                  step="1"
                  style={{ textAlign: 'right' }}
                  value={item.quantidade}
                  onChange={(e) => atualizarItem(indiceGlobal, 'quantidade', e.target.value)}
                  disabled={!!resultado}
                />
              </td>
              <td className="num">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  style={{ textAlign: 'right' }}
                  value={item.valor_unitario}
                  onChange={(e) => atualizarItem(indiceGlobal, 'valor_unitario', e.target.value)}
                  disabled={!!resultado}
                />
              </td>
              <td className="num">{formatarMoeda(Number(item.valor_unitario || 0) * Number(item.quantidade || 0))}</td>
              <td>
                <button
                  className="secundario"
                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
                  onClick={() => handleRemover(indiceGlobal)}
                  disabled={!!resultado || saindoIndices.has(indiceGlobal)}
                >
                  Remover
                </button>
              </td>
            </tr>
          ))}
          {itensDaPagina.length === 0 && (
            <tr>
              <td colSpan={6} className="fraco">
                Nenhum item na nota. Use &quot;Restaurar valores originais&quot; acima para trazer os itens de volta.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Paginacao pagina={pagina} totalPaginas={totalPaginas} aoMudarPagina={setPagina} />

      {itensRemovidos.length > 0 && (
        <div className="cartao" style={{ marginTop: '1rem' }}>
          <strong>Itens removidos desta nota ({itensRemovidos.length})</strong>
          <table style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Descrição</th>
                <th className="num">Qtd.</th>
                <th className="num">Valor unitário</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {itensRemovidos.map((item, indice) => (
                <tr key={indice}>
                  <td className="mono">{item.codigo}</td>
                  <td>{item.descricao}</td>
                  <td className="num">{item.quantidade}</td>
                  <td className="num">{formatarMoeda(Number(item.valor_unitario || 0))}</td>
                  <td>
                    <button
                      className="secundario"
                      style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
                      onClick={() => restaurarItemRemovido(indice)}
                      disabled={!!resultado}
                    >
                      Restaurar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="cartao" style={{ marginTop: '1rem' }}>
        <div>
          <strong>Total da nota: {formatarMoeda(totalNota)}</strong>
        </div>
        <div>Frete: {formatarMoeda(dados.pedido.valorFrete)}</div>
        {/* Desconto do metafield `desconto` do Shopify, já convertido em
            número e abatido do total pelo Tiny — ver desconto.js. */}
        <div>Desconto: {formatarMoeda(dados.pedido.valorDesconto ?? 0)}</div>
        <div>Método de pagamento (Shopify): {dados.pedido.metodoPagamento}</div>
        {/* O que vai na nota nem sempre é o que veio do Shopify: franquia com
            boleto vira "múltiplas" com 3 parcelas (ver pagamento.js). */}
        <div>
          Forma de pagamento na nota:{' '}
          {rotuloFormaPagamento(dados.payload?.nota_fiscal?.forma_pagamento)}
        </div>
        {dados.payload?.nota_fiscal?.parcelas?.length > 0 && (
          <div>
            Parcelas:{' '}
            {dados.payload.nota_fiscal.parcelas
              .map(({ parcela }) => `${parcela.dias} dias (${parcela.data})`)
              .join(', ')}
          </div>
        )}
        {/* O metafield `transportadora` do pedido manda; em branco, a
            transportadora anexada ao CNPJ do cliente ou os Correios. */}
        <div>Transportadora: {resumoDoTransporte(dados, transporte)}</div>
        <div>Forma de frete: {notaFiscalNaTela?.forma_frete ?? 'não informada'}</div>
        {/* O que vai na nota é o número já lido do payload, não o texto cru do
            metafield — se o Shopify não mandou nada, a nota vai com 1 volume e
            o alerta lá em cima avisa. */}
        <div>Quantidade de volumes: {dados.payload?.nota_fiscal?.quantidade_volumes ?? 1}</div>
      </div>

      {!resultado && !emissao && (
        <>
          <button
            style={{ marginTop: '1.5rem' }}
            onClick={() => setPedindoConfirmacao(true)}
            disabled={!podeIncluir || pedindoConfirmacao || !!transporteBloqueado}
            title={transporteBloqueado ?? undefined}
          >
            {dados.jaProcessado ? 'Enviar novo rascunho ao Tiny' : 'Incluir rascunho no Tiny'}
          </button>

          {pedindoConfirmacao && (
            <div className="confirmacao">
              <p style={{ marginTop: 0 }}>
                <strong>Confirma a inclusão?</strong> Isto grava uma nota real no Tiny de produção,
                mesmo que este pedido seja fictício. Depois de criada, cancelar exige uma ação manual
                dentro do Tiny.
              </p>
              {dados.jaProcessado && (
                <p>
                  <strong>
                    Isto cria um NOVO rascunho — não altera o {dados.tinyNotaId ?? 'rascunho atual'}.
                  </strong>{' '}
                  O antigo fica duplicado no Tiny até ser cancelado ou excluído lá.
                </p>
              )}
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={confirmarInclusao} disabled={enviando}>
                  {enviando ? 'Enviando…' : 'Sim, criar o rascunho'}
                </button>
                <button
                  className="secundario"
                  onClick={() => setPedindoConfirmacao(false)}
                  disabled={enviando}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {podeEmitir && (
        <>
          <button
            style={{ marginTop: '1.5rem', marginLeft: resultado ? 0 : '0.75rem' }}
            onClick={() => setPedindoConfirmacaoEmissao(true)}
            disabled={pedindoConfirmacaoEmissao || emitindo || enviando || pedindoConfirmacao}
          >
            Emitir nota
          </button>

          {pedindoConfirmacaoEmissao && (
            <div className="confirmacao">
              <p style={{ marginTop: 0 }}>
                <strong>
                  Emitir a nota {resultado?.tinyNotaId ?? dados.tinyNotaId} ({dados.pedido.name})?
                </strong>{' '}
                Isso dá valor fiscal real e é irreversível — não é possível desfazer pelo sistema.
              </p>
              {!resultado && (
                <p>
                  Vai o rascunho que já está no Tiny. O que foi alterado nesta tela só entra se você
                  enviar um rascunho novo antes.
                </p>
              )}
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={confirmarEmissao} disabled={emitindo}>
                  {emitindo ? 'Emitindo…' : 'Sim, emitir'}
                </button>
                <button
                  className="secundario"
                  onClick={() => setPedindoConfirmacaoEmissao(false)}
                  disabled={emitindo}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {erroEmissao && (
            <div className="aviso" style={{ marginTop: '1rem' }}>
              <strong>A nota não foi emitida.</strong>
              <p>{erroEmissao}</p>
            </div>
          )}
        </>
      )}

      {!resultado && !emissao && !dados.notaEmitida && (
        <div style={{ marginTop: '1.5rem' }}>
          <button className="secundario" onClick={() => setTrocandoTransporte(true)} disabled={enviando}>
            Trocar transportadora
          </button>
          {transporte && (
            <span className="fraco" style={{ marginLeft: '0.75rem' }}>
              Este pedido vai com {transporte.nome} — envie o rascunho para valer.
            </span>
          )}
        </div>
      )}

      <TrocarTransportadora
        aberto={trocandoTransporte}
        aoFechar={() => setTrocandoTransporte(false)}
        aoEscolher={setTransporte}
        atual={transporte ?? transporteOriginal}
        temOriginal={Boolean(transporte)}
      />

      <p style={{ marginTop: '2rem' }}>
        <a href="/pedidos">Voltar para a tela de atacado</a>
      </p>
    </>
  );
}
