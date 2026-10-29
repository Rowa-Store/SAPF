-- email-nf-franquia.sql — controle do e-mail da nota para a franquia (DANFE
-- + XML, ver src/lib/fiscal/emailNotaFranquia.js). Rode no SQL Editor do
-- Supabase ANTES de publicar o código: sem a coluna, a emissão funciona, mas
-- o e-mail não sai (a reserva do envio dá erro). O update do fim é para a
-- primeira vez: rodado de novo, marcaria como enviada a nota cujo envio falhou.

-- Quando o e-mail foi enviado; null = ainda não. É a trava contra envio em
-- dobro entre a emissão e a conferência da tela B2B.
alter table notas_processadas add column if not exists email_nf_enviado_em timestamptz;

-- Notas emitidas antes de o envio existir não recebem e-mail retroativo: a
-- conferência da tela B2B passaria a mandar para elas assim que lesse o número.
update notas_processadas
set email_nf_enviado_em = atualizado_em
where nota_emitida and email_nf_enviado_em is null;
