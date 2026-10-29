-- client-exce-cadastro.sql — dados cadastrais completos dos clientes
-- franqueados (tela /pedidos/clientes). Rode no SQL Editor do Supabase ANTES
-- de publicar o código que edita esses campos — sem as colunas, a lista
-- continua abrindo, mas salvar um cadastro dá erro. Pode rodar mais de uma vez.
--
-- São dados de referência: a nota continua levando o destinatário do pedido
-- do Shopify. A IE fica em clientes_ie (a que a nota usa) e a transportadora
-- em clientes_transportadora — a tela grava nas duas, não aqui.

alter table client_exce add column if not exists razao_social text;
alter table client_exce add column if not exists contato text;       -- responsável
alter table client_exce add column if not exists email text;
alter table client_exce add column if not exists telefone text;
alter table client_exce add column if not exists cep text;           -- só dígitos
alter table client_exce add column if not exists logradouro text;
alter table client_exce add column if not exists numero text;
alter table client_exce add column if not exists complemento text;
alter table client_exce add column if not exists bairro text;
alter table client_exce add column if not exists cidade text;
alter table client_exce add column if not exists uf text;
alter table client_exce add column if not exists observacoes text;
alter table client_exce add column if not exists atualizado_em timestamptz default now();
