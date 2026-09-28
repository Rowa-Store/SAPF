// Áreas do app — fonte única para o menu do cabeçalho e os atalhos da tela inicial.

export const AREAS = [
  {
    href: '/pedidos',
    rotulo: 'Pedidos',
    descricao: 'Pedidos de atacado e franquia do Shopify, prontos para virar rascunho de nota no Tiny.',
  },
  {
    href: '/rascunhos',
    rotulo: 'Rascunhos',
    descricao: 'Rascunhos já criados no Tiny: conferir, editar e emitir a nota fiscal.',
  },
  {
    href: '/transferencias',
    rotulo: 'Transferências',
    descricao: 'Transferências de estoque entre lojas e a nota fiscal de cada uma.',
  },
  {
    href: '/gtin',
    rotulo: 'GTIN',
    descricao: 'Script para corrigir os GTINs dos itens de uma nota direto na Olist.',
  },
  {
    href: '/sysinfo',
    rotulo: 'Sys Info',
    descricao: 'Diagnóstico das integrações (Shopify, Tiny, Supabase) e da trava de emissão.',
  },
];
