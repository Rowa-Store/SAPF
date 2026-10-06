-- clientes-ie.sql — cache da inscrição estadual (IE) dos clientes de atacado.
-- Rode no SQL Editor do Supabase (é o mesmo trecho do final de schema.sql;
-- pode rodar mais de uma vez).
--
-- O preview do pedido procura a IE aqui pelo CNPJ. Só quando não acha é que
-- consulta o SintegrAPI (que cobra crédito por consulta) e grava o resultado
-- nesta tabela, para o próximo pedido do mesmo cliente não gastar de novo.
-- Ver src/lib/fiscal/inscricaoEstadual.js.
--
-- cnpj    só dígitos
-- ie      só dígitos
-- uf      UF da inscrição
-- origem  'sintegrapi' (consulta automática) ou 'manual' (inserida à mão)

create table if not exists clientes_ie (
  cnpj text primary key,
  ie text not null,
  uf text,
  origem text not null default 'manual',
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

alter table clientes_ie enable row level security;
