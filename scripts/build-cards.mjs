#!/usr/bin/env node
// Lê data/collection.csv, busca cada impressão na Scryfall, baixa as imagens
// para img/cards/ e grava data/cards.json. Imagens já baixadas são reaproveitadas.
// Uso: node scripts/build-cards.mjs

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = join(ROOT, 'data/collection.csv');
const JSON_PATH = join(ROOT, 'data/cards.json');
const IMG_DIR = join(ROOT, 'img/cards');

const HEADERS = { 'User-Agent': 'pasta-de-magic/0.1', Accept: 'application/json' };
const DELAY_MS = 100; // a Scryfall pede de 50 a 100 ms entre chamadas
const COLUMNS = ['set', 'collector_number', 'lang', 'foil', 'qty'];
const CARD_TYPES = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',').map((col) => col.trim());
  if (header.join() !== COLUMNS.join()) {
    throw new Error(`Linha 1: o cabeçalho deve ser "${COLUMNS.join(',')}"`);
  }

  const rows = [];
  lines.slice(1).forEach((raw, index) => {
    const line = index + 2;
    if (!raw.trim()) return;

    const values = raw.split(',').map((value) => value.trim());
    if (values.length !== COLUMNS.length) {
      throw new Error(`Linha ${line}: esperava ${COLUMNS.length} colunas, achei ${values.length}`);
    }
    const [set, number, lang, foil, qty] = values;
    if (!set || !number || !lang) throw new Error(`Linha ${line}: set, número e idioma são obrigatórios`);
    if (foil !== 'true' && foil !== 'false') throw new Error(`Linha ${line}: foil deve ser true ou false`);
    if (!/^[1-9]\d*$/.test(qty)) throw new Error(`Linha ${line}: qty deve ser um inteiro positivo`);

    rows.push({ line, set: set.toLowerCase(), number, lang: lang.toLowerCase(), foil: foil === 'true', qty: Number(qty) });
  });
  return rows;
}

async function fetchWithRetry(url, options) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt === 3) return response;
    await sleep(1000 * (attempt + 1));
  }
}

async function fetchCard({ line, set, number, lang }) {
  const url = `https://api.scryfall.com/cards/${set}/${encodeURIComponent(number)}/${lang}`;
  const response = await fetchWithRetry(url, { headers: HEADERS });
  if (!response.ok) {
    throw new Error(`Linha ${line}: a Scryfall respondeu ${response.status} para ${set}/${number}/${lang}`);
  }
  return response.json();
}

// Cartas de 2 faces não têm image_uris no topo: cada face traz a sua.
function imageUrls(card) {
  if (card.image_uris) return [card.image_uris.normal];
  return (card.card_faces ?? []).map((face) => face.image_uris.normal);
}

// Em cartas de 2 faces, tipo e cor são os da face da frente.
function cardTypes(card) {
  const [front] = card.type_line.split(' // ');
  const [supertypes] = front.split(' — ');
  const words = supertypes.toLowerCase().split(' ');
  return CARD_TYPES.filter((type) => words.includes(type));
}

function cardColors(card) {
  return card.colors ?? card.card_faces?.[0]?.colors ?? [];
}

async function downloadImage(url, fileName) {
  const target = join(IMG_DIR, fileName);
  if (existsSync(target)) return false;

  const response = await fetchWithRetry(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!response.ok) throw new Error(`Falha ao baixar ${url}: ${response.status}`);

  // Grava em arquivo temporário para um download interrompido não parecer completo.
  const partial = `${target}.part`;
  await writeFile(partial, Buffer.from(await response.arrayBuffer()));
  await rename(partial, target);
  return true;
}

async function main() {
  const rows = parseCsv(await readFile(CSV_PATH, 'utf8'));
  await mkdir(IMG_DIR, { recursive: true });

  const cards = [];
  let downloaded = 0;

  for (const row of rows) {
    const card = await fetchCard(row);
    await sleep(DELAY_MS);

    if (row.foil && !card.finishes.includes('foil')) {
      throw new Error(`Linha ${row.line}: ${card.name} (${row.set}/${row.number}) não existe em foil`);
    }
    if (!['highres_scan', 'lowres'].includes(card.image_status)) {
      console.warn(`Aviso, linha ${row.line}: ${card.name} (${row.lang}) tem imagem "${card.image_status}"`);
    }

    const urls = imageUrls(card);
    if (urls.length === 0) throw new Error(`Linha ${row.line}: ${card.name} não tem imagem`);

    const images = [];
    for (const [index, url] of urls.entries()) {
      const fileName = `${card.id}${index === 0 ? '' : '-back'}.jpg`;
      if (await downloadImage(url, fileName)) {
        downloaded += 1;
        await sleep(DELAY_MS);
      }
      images.push(`img/cards/${fileName}`);
    }

    cards.push({
      id: card.id,
      name: card.name,
      printed_name: card.printed_name ?? card.card_faces?.[0]?.printed_name ?? null,
      set: card.set,
      set_name: card.set_name,
      collector_number: card.collector_number,
      lang: card.lang,
      rarity: card.rarity,
      types: cardTypes(card),
      colors: cardColors(card),
      foil: row.foil,
      qty: row.qty,
      images,
    });
    console.log(`${String(cards.length).padStart(4)}/${rows.length}  ${card.name}`);
  }

  await writeFile(JSON_PATH, `${JSON.stringify(cards, null, 2)}\n`);
  console.log(`\n${cards.length} cartas em data/cards.json, ${downloaded} imagens novas.`);
}

main().catch((error) => {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
});
