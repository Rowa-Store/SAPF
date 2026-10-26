// planilhaTiny.js — planilha de importação de produtos do Tiny (Olist), no
// modelo do Tiny (64 colunas, .xls). Para cadastrar pela importação de
// planilha em vez da API: nenhuma chamada ao Tiny.
//
// Cada SKU é uma linha de produto simples (tipo "S", sem código do pai), com
// o que o "trazer do Shopify" mandaria pelo produto.incluir
// (simplesParaIncluir): código, nome, unidade, NCM, origem, preço, peso e
// GTIN vazio.

import * as XLSX from 'xlsx';
import { simplesParaIncluir } from './produtoTiny.js';

// Cabeçalho do modelo do Tiny, na ordem — a importação casa pelo nome da coluna.
export const COLUNAS = [
  'ID', 'Código (SKU)', 'Descrição', 'Unidade', 'NCM (Classificação fiscal)', 'Origem', 'Preço', 'Valor IPI fixo',
  'Observações', 'Situação', 'Estoque', 'Preço de custo', 'Cód do fornecedor', 'Fornecedor', 'Localização',
  'Estoque máximo', 'Estoque mínimo', 'Peso líquido (Kg)', 'Peso bruto (Kg)', 'GTIN/EAN', 'GTIN/EAN tributável',
  'Descrição complementar', 'CEST', 'Código de Enquadramento IPI', 'Formato embalagem', 'Largura embalagem',
  'Altura Embalagem', 'Comprimento embalagem', 'Diâmetro embalagem', 'Tipo do produto', 'URL imagem 1',
  'URL imagem 2', 'URL imagem 3', 'URL imagem 4', 'URL imagem 5', 'URL imagem 6', 'Categoria', 'Código do pai',
  'Variações', 'Marca', 'Garantia', 'Sob encomenda', 'Preço promocional', 'URL imagem externa 1',
  'URL imagem externa 2', 'URL imagem externa 3', 'URL imagem externa 4', 'URL imagem externa 5',
  'URL imagem externa 6', 'Link do vídeo', 'Título SEO', 'Descrição SEO', 'Palavras chave SEO', 'Slug',
  'Dias para preparação', 'Controlar lotes', 'Unidade por caixa', 'URL imagem externa 7', 'URL imagem externa 8',
  'URL imagem externa 9', 'URL imagem externa 10', 'Markup', 'Permitir inclusão nas vendas', 'EX TIPI',
];

const numero = (v) => (v === '' || v == null ? '' : Number(v));

/** Linha da planilha de um SKU (linha de compararProduto). */
function linhaDaPlanilha(linha) {
  const p = simplesParaIncluir(linha);
  const valores = {
    'Código (SKU)': p.codigo,
    'Descrição': p.nome,
    'Unidade': p.unidade,
    'NCM (Classificação fiscal)': p.ncm ?? '',
    'Origem': numero(p.origem),
    'Preço': numero(p.preco),
    'Situação': 'Ativo',
    'Peso líquido (Kg)': numero(p.peso_liquido),
    'Peso bruto (Kg)': numero(p.peso_bruto),
    'GTIN/EAN': '',
    'GTIN/EAN tributável': '',
    'Tipo do produto': 'S',
    'Sob encomenda': 'Não',
    'Controlar lotes': 'Não',
    'Permitir inclusão nas vendas': 'Sim',
  };
  return COLUNAS.map((c) => valores[c] ?? '');
}

/** O .xls (Buffer) com uma linha por SKU. */
export function gerarPlanilha(linhas) {
  const folha = XLSX.utils.aoa_to_sheet([COLUNAS, ...linhas.map(linhaDaPlanilha)]);
  const pasta = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(pasta, folha, 'Planilha 1');
  return XLSX.write(pasta, { bookType: 'xls', type: 'buffer' });
}
