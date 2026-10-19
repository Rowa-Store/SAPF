// /pedidos/[id]/rascunho — conferência e inclusão do rascunho da nota no Tiny.
//
// É a primeira tela que se abre ao clicar num pedido da lista: cliente e itens
// chegam prontos e editáveis, e é aqui que se confere tudo antes de gravar. A
// tela só grava depois de duas ações da pessoa: clicar em "Incluir rascunho" e
// depois confirmar no aviso que aparece.

'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
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
    totalComDesconto,
    totalShopify,
    totalDivergente,
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
  const [mostrandoShopify, setMostrandoShopify] = useState(false);
  const [comparandoTotais, setComparandoTotais] = useState(false);

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
              Markup dos itens: {formatarMarkup(markup)} ({formatarMarkup(descontoDoMarkup(markup))}%)
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
              placeholder="Ex.: 2,35"
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
              placeholder="Ex.: 10%"
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

      <div className="cartao" style={{ marginTop: '1rem', position: 'relative' }}>
        {/* Totais como o admin do Shopify mostra, para comparar com a nota —
            escondidos até alguém abrir pela setinha, por cima do quadro. */}
        {dados.pedido.resumoShopify && (
          <>
            <button
              className="secundario pequeno"
              style={{ position: 'absolute', top: '0.75rem', right: '0.75rem' }}
              onClick={() => setMostrandoShopify((v) => !v)}
              aria-expanded={mostrandoShopify}
              aria-label={mostrandoShopify ? 'Ocultar valores do Shopify' : 'Mostrar valores do Shopify'}
              title={mostrandoShopify ? 'Ocultar valores do Shopify' : 'Mostrar valores do Shopify'}
            >
              {mostrandoShopify ? '▴' : '▾'}
            </button>
            {mostrandoShopify && (
              <div
                style={{
                  position: 'absolute',
                  top: '2.75rem',
                  right: '0.75rem',
                  width: 'min(28rem, calc(100% - 1.5rem))',
                  zIndex: 10,
                  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
                  borderRadius: '12px',
                }}
              >
                <QuadroTotais {...ladoShopify(dados.pedido.resumoShopify)} titulo={undefined} />
              </div>
            )}
          </>
        )}
        <div>
          <strong>Total da nota: {formatarMoeda(totalNota)}</strong>
          {totalDivergente && (
            <button
              className="secundario pequeno"
              style={{ color: 'var(--amarelo)', borderColor: 'var(--amarelo)', marginLeft: '0.75rem', fontWeight: 600 }}
              onClick={() => setComparandoTotais(true)}
              title="Comparar a nota com o pedido no Shopify"
            >
              ! valor divergente
            </button>
          )}
        </div>
        <div>Frete: {formatarMoeda(dados.pedido.valorFrete)}</div>
        {/* Desconto do metafield `desconto` do Shopify, já convertido em
            número e abatido do total pelo Tiny — ver desconto.js. */}
        <div>
          Desconto: {formatarMoeda(dados.pedido.valorDesconto ?? 0)}
          <span style={{ color: 'var(--tinta-fraca)', marginLeft: '0.75rem' }}>
            (total com desconto: {formatarMoeda(totalNota - Number(dados.pedido.valorDesconto ?? 0))})
          </span>
        </div>
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
        <div>
          Transportadora: {resumoDoTransporte(dados, transporte)}
          {!resultado && !emissao && !dados.notaEmitida && (
            <button
              className="secundario pequeno"
              style={{ marginLeft: '0.75rem' }}
              onClick={() => setTrocandoTransporte(true)}
              disabled={enviando}
            >
              Trocar transportadora
            </button>
          )}
          {transporte && !resultado && !emissao && (
            <span className="fraco" style={{ marginLeft: '0.75rem' }}>
              — envie o rascunho para valer.
            </span>
          )}
        </div>
        <div>Forma de frete: {notaFiscalNaTela?.forma_frete ?? 'não informada'}</div>
        {/* O que vai na nota é o número já lido do payload, não o texto cru do
            metafield — se o Shopify não mandou nada, a nota vai com 1 volume e
            o alerta lá em cima avisa. */}
        <div>Quantidade de volumes: {dados.payload?.nota_fiscal?.quantidade_volumes ?? 1}</div>
      </div>

      <Modal
        aberto={comparandoTotais && totalDivergente}
        titulo={`Divergência de valores — pedido ${dados.pedido.name}`}
        aoFechar={() => setComparandoTotais(false)}
        largura="58rem"
      >
        <ComparacaoTotais
          nota={{
            subtotal: totalNota,
            desconto: Number(dados.pedido.valorDesconto ?? 0),
            frete: Number(dados.pedido.valorFrete ?? 0),
            formaFrete: notaFiscalNaTela?.forma_frete ?? '',
            total: totalComDesconto,
          }}
          shopify={dados.pedido.resumoShopify}
        />
      </Modal>

      {/* Incluir à esquerda, emitir à direita. Emitir aparece sempre, mas só
          libera com um rascunho no Tiny. */}
      {!emissao && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginTop: '1.5rem' }}>
          <div>
            {!resultado && (
              <button
                onClick={() => setPedindoConfirmacao(true)}
                disabled={!podeIncluir || pedindoConfirmacao || !!transporteBloqueado}
                title={transporteBloqueado ?? undefined}
              >
                {dados.jaProcessado ? 'Enviar novo rascunho ao Tiny' : 'Incluir rascunho no Tiny'}
              </button>
            )}
          </div>
          <button
            onClick={() => setPedindoConfirmacaoEmissao(true)}
            disabled={!podeEmitir || pedindoConfirmacaoEmissao || emitindo || enviando || pedindoConfirmacao}
            title={
              podeEmitir
                ? undefined
                : dados.notaEmitida
                  ? 'A nota deste pedido já foi emitida'
                  : 'Inclua o rascunho no Tiny antes de emitir'
            }
          >
            Emitir nota
          </button>
        </div>
      )}

      {!resultado && !emissao && (
        <>
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

// Dinheiro e peso no formato do admin do Shopify (R$13,762.00 / 7.0 kg), para
// o lado do Shopify sair idêntico ao que se vê lá.
const moedaShopify = (v) =>
  `${v < 0 ? '-' : ''}R$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pesoShopify = (kg) => `${kg.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;

/** Quadro de totais do admin do Shopify (rótulos em inglês, como lá). */
function ladoShopify(shopify) {
  const itens = (n) => `${n} ${n === 1 ? 'item' : 'items'}`;
  return {
    titulo: 'Shopify',
    linhas: [
      ['Subtotal', itens(shopify.quantidadeItens), moedaShopify(shopify.subtotal)],
      ['Discount', shopify.descricaoDesconto, moedaShopify(-shopify.desconto)],
      ['Shipping', [shopify.formaFrete, shopify.pesoKg > 0 && `(${pesoShopify(shopify.pesoKg)})`].filter(Boolean).join(' '), moedaShopify(shopify.frete)],
      ...(shopify.impostos > 0 ? [['Taxes', '', moedaShopify(shopify.impostos)]] : []),
    ],
    total: ['Total', moedaShopify(shopify.total)],
    rodape: ['Paid', moedaShopify(shopify.pago)],
  };
}

/**
 * Nota do sistema x pedido no Shopify, lado a lado, para sair num print. O
 * lado da nota segue o visual dos totais do Tiny; o do Shopify copia o quadro
 * de totais do admin (rótulos em inglês e números no formato de lá).
 */
function ComparacaoTotais({ nota, shopify }) {
  const diferenca = nota.total - shopify.total;
  // Mesmos campos e rótulos do quadro de totais da nota no Tiny.
  const camposNota = [
    ['Total Produtos', formatarMoeda(nota.subtotal)],
    ['Valor do Frete', formatarMoeda(nota.frete)],
    ['Desconto', formatarMoeda(nota.desconto)],
    ['Total da Nota', formatarMoeda(nota.total)],
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(22rem, 1fr))', gap: '1rem' }}>
        <QuadroTiny titulo="Sistema (nota no Tiny)" campos={camposNota} />
        <QuadroTotais {...ladoShopify(shopify)} />
      </div>
      <p style={{ marginBottom: 0, color: 'var(--amarelo)', fontSize: '0.9rem' }}>
        ! Divergência encontrada: <strong>{formatarMoeda(Math.abs(diferenca))}</strong>{' '}
        {diferenca > 0 ? 'a mais na nota do que no Shopify' : 'a menos na nota do que no Shopify'}
      </p>
    </>
  );
}

// Quadro no visual dos totais da nota no Tiny: fundo grafite, rótulo pequeno
// em cinza e valor em destaque logo abaixo, em grade.
function QuadroTiny({ titulo, campos }) {
  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>{titulo}</div>
      <div
        style={{
          background: '#1f1f1f',
          color: '#f2f2f2',
          border: '1px solid #2e2e2e',
          borderRadius: '12px',
          padding: '1rem 1.25rem',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1rem 1.5rem',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        {campos.map(([rotulo, valor]) => (
          <div key={rotulo}>
            <div style={{ color: '#a3a3a3', fontSize: '0.8rem' }}>{rotulo}</div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{valor}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const estiloQuadro = {
  background: '#fff',
  color: '#303030',
  border: '1px solid #e3e3e3',
  borderRadius: '12px',
  padding: '0.75rem 1rem',
  fontSize: '0.85rem',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
};
const celula = { padding: '0.35rem 0.25rem', border: 'none', background: 'transparent', color: 'inherit' };

function QuadroTotais({ titulo, linhas, total, rodape }) {
  return (
    <div>
      {titulo && <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>{titulo}</div>}
      <div style={estiloQuadro}>
        <table style={{ width: '100%', border: 'none', borderCollapse: 'collapse' }}>
          <tbody>
            {linhas.map(([rotulo, detalhe, valor]) => (
              <tr key={rotulo}>
                <td style={{ ...celula, whiteSpace: 'nowrap' }}>{rotulo}</td>
                <td style={{ ...celula, color: '#616161' }}>{detalhe}</td>
                <td style={{ ...celula, textAlign: 'right', whiteSpace: 'nowrap' }}>{valor}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td style={celula}>{total[0]}</td>
              <td style={celula} />
              <td style={{ ...celula, textAlign: 'right', whiteSpace: 'nowrap' }}>{total[1]}</td>
            </tr>
            {rodape && (
              <tr style={{ borderTop: '1px solid #e3e3e3' }}>
                <td style={{ ...celula, paddingTop: '0.6rem' }}>{rodape[0]}</td>
                <td style={celula} />
                <td style={{ ...celula, paddingTop: '0.6rem', textAlign: 'right' }}>{rodape[1]}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
