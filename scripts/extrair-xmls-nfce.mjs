#!/usr/bin/env node
/**
 * Baixa o XML de todas as NFC-e (modelo 65) de uma conta do Tiny, pela API 2.0.
 *
 * Uso:
 *   TINY_TOKEN=... node scripts/extrair-xmls-nfce.mjs [pasta] [--desde dd/mm/aaaa] [--ate dd/mm/aaaa]
 *
 * A pesquisa de notas não filtra por modelo, então o script percorre todas as
 * notas e fica com as de chave de acesso modelo 65 (posições 21-22 da chave).
 * XMLs já baixados são pulados — dá para rodar de novo depois de uma falha.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://api.tiny.com.br/api2';
const PAUSA_MS = 1100; // fica abaixo do limite de chamadas por minuto da API 2.0
const ESPERA_BLOQUEIO_MS = 60_000;

const token = process.env.TINY_TOKEN;
if (!token) {
  console.error('Defina TINY_TOKEN com o token da API do Tiny.');
  process.exit(1);
}

const args = process.argv.slice(2);
function opcao(nome) {
  const i = args.indexOf(nome);
  if (i === -1) return undefined;
  const valor = args[i + 1];
  args.splice(i, 2);
  return valor;
}
const desde = opcao('--desde');
const ate = opcao('--ate');
const pasta = path.resolve(args[0] ?? 'xmls-nfce');

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const paraArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Código 6 = "API bloqueada / excedido o número de acessos": espera e tenta de novo.
async function chamar(endpoint, params, { json = true } = {}) {
  for (let tentativa = 1; ; tentativa++) {
    await dormir(PAUSA_MS);
    const corpo = new URLSearchParams({ token, ...(json ? { formato: 'JSON' } : {}), ...params });
    let texto;
    try {
      const resposta = await fetch(`${BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: corpo.toString(),
      });
      texto = await resposta.text();
      if (resposta.status === 429 || resposta.status >= 500) throw new Error(`HTTP ${resposta.status}`);
    } catch (erro) {
      if (tentativa >= 5) throw erro;
      console.warn(`  ${endpoint}: ${erro.message}, tentando de novo...`);
      await dormir(5000 * tentativa);
      continue;
    }

    const bloqueado = json
      ? /"codigo_erro"\s*:\s*"?6"?/.test(texto)
      : /<codigo_erro>6<\/codigo_erro>/.test(texto);
    if (bloqueado && tentativa < 10) {
      console.warn('  limite de chamadas atingido, aguardando 1 min...');
      await dormir(ESPERA_BLOQUEIO_MS);
      continue;
    }
    return texto;
  }
}

async function listarNfce() {
  const notas = [];
  let pagina = 1;
  let totalPaginas = 1;
  do {
    const params = { pagina: String(pagina) };
    if (desde) params.dataInicial = desde;
    if (ate) params.dataFinal = ate;

    const retorno = JSON.parse(await chamar('notas.fiscais.pesquisa.php', params)).retorno;
    if (retorno.status === 'Erro') {
      const erros = paraArray(retorno.erros).map((e) => e.erro).join('; ');
      // "A consulta não retornou registros" não é falha.
      if (retorno.codigo_erro === '20' || /não retornou registros/i.test(erros)) break;
      throw new Error(`Pesquisa de notas falhou: ${erros}`);
    }

    totalPaginas = Number(retorno.numero_paginas) || 1;
    for (const { nota_fiscal: n } of paraArray(retorno.notas_fiscais)) {
      if (n.chave_acesso?.replace(/\D/g, '').slice(20, 22) === '65') notas.push(n);
    }
    console.log(`Página ${pagina}/${totalPaginas} — ${notas.length} NFC-e até agora`);
    pagina++;
  } while (pagina <= totalPaginas);
  return notas;
}

async function existe(arquivo) {
  try {
    await access(arquivo);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(pasta, { recursive: true });
  const notas = await listarNfce();
  console.log(`\n${notas.length} NFC-e encontradas. Baixando XMLs em ${pasta}\n`);

  let baixados = 0;
  let pulados = 0;
  const falhas = [];

  for (const [i, nota] of notas.entries()) {
    const chave = nota.chave_acesso.replace(/\D/g, '');
    const arquivo = path.join(pasta, `${chave}-nfce.xml`);
    const rotulo = `[${i + 1}/${notas.length}] NFC-e ${nota.numero} (${nota.descricao_situacao})`;

    if (await existe(arquivo)) {
      pulados++;
      continue;
    }

    const texto = await chamar('nota.fiscal.obter.xml.php', { id: nota.id }, { json: false });
    // O XML da nota vem embrulhado em <retorno><xml_nfe>...</xml_nfe></retorno>.
    const xml = texto.match(/<xml_nfe>([\s\S]*)<\/xml_nfe>/)?.[1];
    if (!xml) {
      const erro = texto.match(/<erro>([\s\S]*?)<\/erro>/)?.[1] ?? 'resposta sem xml_nfe';
      console.warn(`${rotulo}: falhou — ${erro}`);
      falhas.push({ id: nota.id, numero: nota.numero, chave, erro });
      continue;
    }

    await writeFile(arquivo, `<?xml version="1.0" encoding="UTF-8"?>${xml.trim()}`);
    baixados++;
    console.log(`${rotulo}: ok`);
  }

  console.log(`\nConcluído: ${baixados} baixados, ${pulados} já existiam, ${falhas.length} falhas.`);
  if (falhas.length) {
    const relatorio = path.join(pasta, 'falhas.json');
    await writeFile(relatorio, JSON.stringify(falhas, null, 2));
    console.log(`Falhas em ${relatorio}`);
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
