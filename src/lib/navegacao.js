// Áreas do app — fonte única para o menu do cabeçalho e os atalhos da tela inicial.

export const AREAS = [
  {
    href: '/pedidos',
    rotulo: 'Atacado',
    descricao: 'Pedidos de atacado e franquia do Shopify: criar o rascunho, emitir a nota fiscal e baixar o DANFE.',
  },
  {
    href: '/transferencias',
    rotulo: 'Transferências',
    descricao: 'Transferências de estoque entre lojas e a nota fiscal de cada uma.',
  },
  {
    href: '/olist',
    rotulo: 'Olist',
    descricao: 'Compara um produto do Shopify com a Olist, lado a lado, e traz do Shopify o que estiver diferente ou faltando.',
  },
  {
    href: '/gtin',
    rotulo: 'GTIN',
    descricao: 'Script para corrigir os GTINs dos itens de uma nota direto na Olist.',
  },
  {
    href: '/sysinfo',
    rotulo: 'Sys Info',
    descricao: 'Diagnóstico das integrações (Shopify, Tiny, Supabase).',
  },
];
