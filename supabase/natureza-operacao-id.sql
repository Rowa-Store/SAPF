-- Id da natureza de operação do Tiny em lojas_fiscais. O Tiny ignorou o nome
-- da natureza mesmo idêntico ao cadastro e caiu em "Venda para contribuinte";
-- pelo id (id_natureza_operacao na nota) não tem casamento de texto.
--
-- O id aparece na URL ao abrir a natureza no Tiny
-- (Configurações > Naturezas de operação > editar, parâmetro buscaid).
-- Rodar uma vez no SQL Editor do Supabase. É idempotente.

begin;

alter table lojas_fiscais add column if not exists natureza_operacao_id bigint;

update lojas_fiscais
set natureza_operacao_id = case natureza_operacao
  when 'Transferência de mercadoria entre lojas sp'                   then 1032378958
  when 'TRANSFERENCIA INTERESTADUAL'                                  then 1043394407
  when 'Remessa de mercadoria em consignação mercantil ou industrial' then 965428925
end;

-- Conferência: as 10 lojas com id preenchido (nenhum vazio).
select natureza_operacao, natureza_operacao_id, count(*) as lojas
from lojas_fiscais
group by natureza_operacao, natureza_operacao_id
order by natureza_operacao;

commit;
