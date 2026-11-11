#!/usr/bin/env node
// Lê os links da Scryfall em data/collection.csv, busca cada impressão, baixa as
// imagens para img/cards/ e grava data/cards.json. Imagens já baixadas são
// reaproveitadas, e as que saíram da coleção são apagadas.
// Uso: node scripts/build-cards.mjs

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = join(ROOT, 'data/collection.csv');
const JSON_PATH = join(ROOT, 'data/cards.json');
const IMG_DIR = join(ROOT, 'img/cards');

const HEADERS = { 'User-Agent': 'pasta-de-magic/0.1', Accept: 'application/json' };
const DELAY_MS = 100; // a Scryfall pede de 50 a 100 ms entre chamadas
const COLUMNS = ['link da carta', 'adicional', 'unidades'];
const LANGUAGES = { en: 'en', es: 'es', fr: 'fr', de: 'de', it: 'it', pt: 'pt', 'pt-br': 'pt', ja: 'ja', ko: 'ko', ru: 'ru', zhs: 'zhs', zht: 'zht' };
const CARD_TYPES = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Aceita https://scryfall.com/card/fra/317/nome e https://scryfall.com/card/fra/310/de/nome.
function parseLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error(`link inválido: "${link}"`);
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname !== 'scryfall.com' || parts[0] !== 'card' || parts.length < 4 || parts.length > 5) {
    throw new Error(`não é um link de carta da Scryfall: "${link}"`);
  }
  return {
    set: parts[1].toLowerCase(),
    number: decodeURIComponent(parts[2]),
    lang: parts.length === 5 ? LANGUAGES[parts[3].toLowerCase()] : 'en',
  };
}

function parseExtras(text) {
  const extras = { foil: false, lang: null };
  for (const word of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (word === 'foil') extras.foil = true;
    else if (LANGUAGES[word]) extras.lang = LANGUAGES[word];
    else throw new Error(`adicional desconhecido: "${word}"`);
  }
  return extras;
}

function parseCsv(text, problems, warnings) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = lines[0].split(',').map((column) => column.trim().toLowerCase());
  if (header.join() !== COLUMNS.join()) {
    throw new Error(`Linha 1: o cabeçalho deve ser "${COLUMNS.join(',')}"`);
  }

  const rows = [];
  lines.slice(1).forEach((raw, index) => {
    const line = index + 2;
    if (!raw.trim()) return;

    try {
      const values = raw.split(',').map((value) => value.trim());
      if (values.length !== COLUMNS.length) throw new Error(`esperava ${COLUMNS.length} colunas, achei ${values.length}`);

      const [link, extraText, units] = values;
      const printing = parseLink(link);
      const extras = parseExtras(extraText);
      if (!printing.lang) throw new Error(`idioma desconhecido no link: "${link}"`);
      if (units && !/^[1-9]\d*$/.test(units)) throw new Error(`unidades deve ser um inteiro positivo, achei "${units}"`);
      if (!units) warnings.push(`Linha ${line}: sem unidades, considerei 1`);

      rows.push({ line, ...printing, lang: extras.lang ?? printing.lang, foil: extras.foil, qty: Number(units || 1) });
    } catch (error) {
      problems.push(`Linha ${line}: ${error.message}`);
    }
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

async function fetchCard({ set, number, lang }) {
  const url = `https://api.scryfall.com/cards/${set}/${encodeURIComponent(number)}/${lang}`;
  const response = await fetchWithRetry(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`a Scryfall respondeu ${response.status} para ${set}/${number}/${lang}`);
  return response.json();
}

// Cartas de 2 faces não têm image_uris no topo: cada face traz a sua.
function imageUrls(card) {
  if (card.image_uris) return [card.image_uris.normal];
  return (card.card_faces ?? []).map((face) => face.image_uris.normal);
}

// Em cartas de 2 faces, tipo e cor são os da face da frente.
function cardTypes(card) {
  const typeLine = card.type_line ?? card.card_faces[0].type_line; // cartas reversíveis só têm nas faces
  const [front] = typeLine.split(' // ');
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

async function buildCard(row, used) {
  const card = await fetchCard(row);
  await sleep(DELAY_MS);

  if (row.foil && !card.finishes.includes('foil')) {
    throw new Error(`${card.name} (${row.set}/${row.number}) não existe em foil, só em ${card.finishes.join(', ')}`);
  }
  if (!row.foil && !card.finishes.includes('nonfoil')) {
    throw new Error(`${card.name} (${row.set}/${row.number}) só existe em ${card.finishes.join(', ')}, mas a linha não diz foil`);
  }

  // A Scryfall devolve uma imagem "placeholder" (carimbo de imagem indisponível) quando
  // a impressão em outro idioma não tem scan. Nesse caso a pasta mostra a imagem em inglês.
  let imageCard = card;
  if (card.lang !== 'en' && card.image_status === 'placeholder') {
    imageCard = await fetchCard({ ...row, lang: 'en' });
    await sleep(DELAY_MS);
    console.log(`Imagem em inglês para ${card.name} (${row.set}/${row.number}/${row.lang}): a Scryfall só tem placeholder.`);
  }

  const urls = imageUrls(imageCard);
  if (urls.length === 0) throw new Error(`${card.name} não tem imagem`);

  const images = [];
  for (const [index, url] of urls.entries()) {
    const fileName = `${card.id}${index === 0 ? '' : '-back'}.jpg`;
    if (await downloadImage(url, fileName)) {
      used.downloaded += 1;
      await sleep(DELAY_MS);
    }
    used.files.add(fileName);
    images.push(`img/cards/${fileName}`);
  }

  return {
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
    image_status: imageCard.image_status,
  };
}

async function removeUnusedImages(used) {
  let removed = 0;
  for (const fileName of await readdir(IMG_DIR)) {
    if (!used.files.has(fileName)) {
      await rm(join(IMG_DIR, fileName));
      removed += 1;
    }
  }
  return removed;
}

async function main() {
  const problems = [];
  const warnings = [];
  const rows = parseCsv(await readFile(CSV_PATH, 'utf8'), problems, warnings);
  await mkdir(IMG_DIR, { recursive: true });

  const cards = [];
  const used = { files: new Set(), downloaded: 0 };

  for (const [index, row] of rows.entries()) {
    try {
      const card = await buildCard(row, used);
      cards.push(card);
      if (!['highres_scan', 'lowres'].includes(card.image_status)) {
        warnings.push(`Linha ${row.line}: ${card.name} (${row.lang}) tem imagem "${card.image_status}"`);
      }
      console.log(`${String(index + 1).padStart(4)}/${rows.length}  ${card.name}`);
    } catch (error) {
      problems.push(`Linha ${row.line}: ${error.message}`);
    }
  }

  warnings.forEach((warning) => console.warn(`Aviso. ${warning}`));

  // Com qualquer problema nada é gravado, para o site não publicar uma coleção pela metade.
  if (problems.length > 0) {
    problems.forEach((problem) => console.error(`Erro. ${problem}`));
    console.error(`\n${problems.length} problema(s). data/cards.json não foi alterado.`);
    process.exitCode = 1;
    return;
  }

  await writeFile(JSON_PATH, `${JSON.stringify(cards.map(({ image_status, ...card }) => card), null, 2)}\n`);
  const removed = await removeUnusedImages(used);
  console.log(`\n${cards.length} cartas em data/cards.json, ${used.downloaded} imagens novas, ${removed} removidas.`);
}

main().catch((error) => {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
});
