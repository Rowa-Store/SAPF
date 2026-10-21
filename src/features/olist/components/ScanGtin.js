// /olist/scan-gtin — GTINs (barcodes) repetidos entre as variantes do Shopify.
//
// Lê todos os produtos do Shopify, de qualquer status, e mostra cada conflito
// lado a lado no visual do admin do Shopify: o Produto 1 (o mais antigo, em
// geral o original) contra o Produto 2 — e os seguintes, se houver mais —,
// com uma linha por GTIN repetido. Barcode repetido dentro do mesmo produto
// aparece numa coluna só. O scan pausa e continua de onde parou; o que já
// leu fica neste navegador (ver useScanGtin). Só lê; "Baixar PDF" imprime o
// relatório.

'use client';

import { useState } from 'react';
import AbasOlist from '@/components/ui/AbasOlist';
import { formatarDataCurta, formatarDataHoraCurta, formatarMoedaOuTraco } from '@/lib/format';
import { useScanGtin } from '../hooks/useScanGtin';
import { abrirRelatorioPdf } from './relatorioScanGtin';

const STATUS_SHOPIFY = { ACTIVE: 'Active', DRAFT: 'Draft', ARCHIVED: 'Archived' };

function CabecalhoProduto({ produto, numero }) {
  return (
    <div className="lado-shopify shopify-cabecalho">
      <span className="shopify-marca">Produto {numero}</span>
      <div className="shopify-titulo">
        <span>{produto.titulo}</span>
        {produto.status && (
          <span className={`shopify-status status-${produto.status.toLowerCase()}`}>
            {STATUS_SHOPIFY[produto.status] ?? produto.status}
          </span>
        )}
      </div>
      <div className="shopify-tipo">
        {produto.tipo && `Type · ${produto.tipo} · `}criado em {formatarDataCurta(produto.criado)} ·{' '}
        <a href={produto.admin} target="_blank" rel="noreferrer">
          Abrir no Shopify
        </a>
      </div>
      <div className="shopify-campos shopify-campos-pai">
        <div>
          <span className="shopify-rotulo">Title</span>
          <span className="shopify-campo">{produto.titulo}</span>
        </div>
        <div>
          <span className="shopify-rotulo">Variants</span>
          <span className="shopify-campo">
            {produto.totalVariantes} · {produto.variantes.length} com barcode
          </span>
        </div>
      </div>
    </div>
  );
}

/** As variantes de um produto com o GTIN repetido. */
function VariantesComGtin({ variantes }) {
  return (
    <div className="lado-shopify">
      {variantes.length === 0 && <p className="fraco">—</p>}
      {variantes.map((v, i) => (
        <div className="shopify-cartao" key={`${v.sku}-${i}`}>
          <div className="shopify-campos">
            <div>
              <span className="shopify-rotulo">Variant</span>
              <span className="shopify-campo">{v.opcao || '—'}</span>
            </div>
            <div>
              <span className="shopify-rotulo">SKU</span>
              <span className="shopify-campo">{v.sku || '—'}</span>
            </div>
            <div>
              <span className="shopify-rotulo">Price</span>
              <span className="shopify-campo">{formatarMoedaOuTraco(v.preco)}</span>
            </div>
            <div className="campo-diferente">
              <span className="shopify-rotulo">Barcode</span>
              <span className="shopify-campo">{v.gtin}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Conflito({ conflito }) {
  return (
    <section className="par-produto par-gtin" style={{ '--colunas': conflito.produtos.length }}>
      <div className="par-linha">
        {conflito.produtos.map((p, i) => (
          <CabecalhoProduto key={p.id} produto={p} numero={i + 1} />
        ))}
      </div>
      {conflito.gtins.map((g) => (
        <div className="par-linha" key={g.gtin}>
          {g.porProduto.map((variantes, i) => (
            <VariantesComGtin key={conflito.produtos[i].id} variantes={variantes} />
          ))}
        </div>
      ))}
    </section>
  );
}

export default function ScanGtin() {
  const { estado, trabalho, comGtin, conflitos, gtinsDuplicados, erro, espera, soAtivos, setSoAtivos, iniciar, continuar, pausar } =
    useScanGtin();
  const [bloqueado, setBloqueado] = useState(false);
  const rodando = estado === 'rodando' || estado === 'pausando';

  function baixarPdf() {
    setBloqueado(!abrirRelatorioPdf({ conflitos, trabalho, soAtivos, gtinsDuplicados }));
  }

  return (
    <>
      <AbasOlist />
      <div className="cabecalho-pagina">
        <h2>Scan GTIN</h2>
      </div>

      <div className="cartao">
        <p className="fraco" style={{ marginTop: 0 }}>
          Lê todos os produtos do Shopify, 100 por vez e dos mais recentes para os mais antigos, e lista os barcodes (GTIN)
          que aparecem em mais de uma variante. Dá para pausar e continuar depois — o que já foi lido fica guardado neste
          navegador. Só lê: nada é alterado no Shopify nem na Olist.
        </p>
        <div className="grupo-botoes">
          {rodando ? (
            <button className="secundario" onClick={pausar} disabled={estado === 'pausando'}>
              {estado === 'pausando' ? 'Pausando…' : 'Pausar'}
            </button>
          ) : (
            <>
              {estado === 'pausado' && <button onClick={continuar}>Continuar</button>}
              <button className={estado === 'pausado' ? 'secundario' : undefined} onClick={iniciar}>
                {estado === 'parado' ? 'Iniciar scan' : 'Novo scan'}
              </button>
            </>
          )}
          <button className="secundario" onClick={baixarPdf} disabled={!trabalho}>
            Baixar PDF
          </button>
          {trabalho?.fim && <span className="fraco">Último scan concluído: {formatarDataHoraCurta(trabalho.fim)}</span>}
        </div>
        <label className="campo-check" style={{ marginTop: '0.75rem' }}>
          <input type="checkbox" checked={soAtivos} onChange={(e) => setSoAtivos(e.target.checked)} />
          Só produtos ativos — ignora rascunhos e arquivados
        </label>
      </div>

      {bloqueado && (
        <div className="aviso">
          <p style={{ margin: 0 }}>O navegador bloqueou a janela do relatório — libere pop-ups para esta página.</p>
        </div>
      )}

      {erro && (
        <div className="aviso">
          <p style={{ margin: 0 }}>{erro}</p>
        </div>
      )}

      {trabalho && (
        <p className="fraco" role="status">
          {trabalho.paginas} página(s) · {trabalho.lidos} produtos lidos · {comGtin} com barcode · {gtinsDuplicados} GTIN(s)
          repetido(s) em {conflitos.length} conflito(s)
          {estado === 'fim' && ' — concluído.'}
          {estado === 'pausado' && ' — pausado.'}
          {espera && (
            <>
              <br />
              Limite de chamadas do Shopify — tentando de novo em {espera}s
            </>
          )}
        </p>
      )}

      {estado === 'fim' && conflitos.length === 0 && <div className="vazio">Nenhum GTIN repetido no Shopify.</div>}

      {conflitos.map((c) => (
        <Conflito key={c.chave} conflito={c} />
      ))}
    </>
  );
}
