const POCKETS_PER_PAGE = 9;
const FLIP_MS = 820;
const LIGA_URL = 'https://www.ligamagic.com.br/?view=cards/card&card=';
const SOUND_KEY = 'pasta:som';

const RARITIES = { common: 'Comum', uncommon: 'Incomum', rare: 'Rara', mythic: 'Mítica', special: 'Especial', bonus: 'Bônus' };
const LANGUAGES = { en: 'Inglês', pt: 'Português', es: 'Espanhol', fr: 'Francês', de: 'Alemão', it: 'Italiano', ja: 'Japonês' };

const $ = (id) => document.getElementById(id);
const book = $('book');
const indicator = $('indicator');
const prevButton = $('prev');
const nextButton = $('next');
const soundButton = $('sound');

const mobile = matchMedia('(max-width: 767px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let cards = [];
let pageCount = 0;
let leafCount = 0; // a capa é a folha 0

// O estado é a página em foco: 0 é a pasta fechada, 1..pageCount são as páginas.
// Páginas ímpares ficam à direita da lombada, pares à esquerda.
let page = 0;

const leaves = new Map();
let flipsRunning = 0;
let topLayer = 1000;

// Quantas folhas já viraram para mostrar a página p.
const spreadOf = (p) => (p === 0 ? 0 : Math.floor(p / 2) + 1);

// Modelo das folhas

function restingLayer(index, turned) {
  return turned ? index + 1 : leafCount - index + 1;
}

function createPocket(card) {
  if (!card) {
    const empty = document.createElement('div');
    empty.className = 'pocket';
    return empty;
  }

  const pocket = document.createElement('button');
  pocket.type = 'button';
  pocket.className = 'pocket';
  pocket.dataset.index = cards.indexOf(card);
  pocket.setAttribute('aria-label', `Ampliar ${displayName(card)}`);

  const frame = document.createElement('span');
  frame.className = 'card';

  const image = document.createElement('img');
  image.src = card.images[0];
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.draggable = false;
  frame.append(image);

  if (card.foil) {
    const foil = document.createElement('span');
    foil.className = 'foil-layer';
    frame.append(foil);
  }
  pocket.append(frame);

  if (card.qty > 1) {
    const qty = document.createElement('span');
    qty.className = 'qty';
    qty.textContent = `×${card.qty}`;
    pocket.append(qty);
  }
  return pocket;
}

function createSheet(pageNumber, side) {
  const sheet = document.createElement('div');
  sheet.className = `face face-${side} sheet`;
  const start = (pageNumber - 1) * POCKETS_PER_PAGE;
  for (let slot = 0; slot < POCKETS_PER_PAGE; slot += 1) {
    sheet.append(createPocket(cards[start + slot]));
  }
  return sheet;
}

function createCover() {
  const front = document.createElement('div');
  front.className = 'face face-front cover-front';
  front.innerHTML = `
    <span class="cover-stitch"></span>
    <h1 class="cover-title">Pasta de Magic<small>Toque para abrir</small></h1>`;

  const inside = document.createElement('div');
  inside.className = 'face face-back cover-inside';
  const paragraph = document.createElement('p');
  paragraph.textContent = collectionSummary();
  inside.append(paragraph);

  return [front, inside];
}

function createLeaf(index) {
  const leaf = document.createElement('div');
  leaf.className = index === 0 ? 'leaf leaf-cover' : 'leaf';
  leaf.append(...(index === 0 ? createCover() : [createSheet(index * 2 - 1, 'front'), createSheet(index * 2, 'back')]));

  const turned = index < spreadOf(page);
  leaf.classList.toggle('turned', turned);
  leaf.style.zIndex = restingLayer(index, turned);
  book.append(leaf);
  leaves.set(index, leaf);
  return leaf;
}

// Mantém no DOM só as folhas perto da atual, para a coleção real não pesar.
function syncLeaves() {
  const spread = spreadOf(page);
  const first = Math.max(0, spread - 3);
  const last = Math.min(leafCount - 1, spread + 2);

  for (let index = first; index <= last; index += 1) {
    if (!leaves.has(index)) createLeaf(index);
  }
  if (flipsRunning === 0) {
    for (const [index, leaf] of leaves) {
      if (index < first || index > last) {
        leaf.remove();
        leaves.delete(index);
      }
    }
  }
}

function turnLeaf(index, turned) {
  const leaf = leaves.get(index) ?? createLeaf(index);
  leaf.getBoundingClientRect(); // garante que a folha recém-criada anime

  flipsRunning += 1;
  topLayer += 1;
  leaf.style.zIndex = topLayer;
  leaf.classList.add('flipping');
  leaf.classList.toggle('turned', turned);
  playFlip();

  setTimeout(() => {
    // Se a folha foi virada de volta no meio do caminho, a última virada é quem assenta.
    if (leaf.classList.contains('turned') === turned) {
      leaf.classList.remove('flipping');
      leaf.style.zIndex = restingLayer(index, turned);
    }
    flipsRunning -= 1;
    if (flipsRunning === 0) syncLeaves();
  }, reducedMotion.matches ? 0 : FLIP_MS);
}

// Navegação

function goTo(target) {
  const next = Math.max(0, Math.min(pageCount, target));
  if (next === page) return;

  const from = spreadOf(page);
  const to = spreadOf(next);
  page = next;
  syncLeaves();

  if (to > from) for (let index = from; index < to; index += 1) turnLeaf(index, true);
  if (to < from) for (let index = from - 1; index >= to; index -= 1) turnLeaf(index, false);

  render();
}

function step(direction) {
  if (mobile.matches) return goTo(page + direction);

  const spread = spreadOf(page);
  if (direction > 0) {
    const target = page === 0 ? 1 : spread * 2;
    if (target <= pageCount) goTo(target);
  } else {
    goTo(spread <= 2 ? spread - 1 : (spread - 2) * 2);
  }
}

function canStep(direction) {
  if (direction < 0) return page > 0;
  return mobile.matches ? page < pageCount : page === 0 || spreadOf(page) * 2 <= pageCount;
}

function indicatorText() {
  if (page === 0) return 'Capa';
  if (mobile.matches) return `Página ${page} de ${pageCount}`;

  const spread = spreadOf(page);
  const left = (spread - 1) * 2;
  const right = spread * 2 - 1;
  const visible = [left, right].filter((p) => p >= 1 && p <= pageCount);
  return visible.length === 2
    ? `Páginas ${visible[0]}–${visible[1]} de ${pageCount}`
    : `Página ${visible[0]} de ${pageCount}`;
}

function render() {
  const side = page % 2 === 1 ? 'right' : 'left';
  book.dataset.view = page === 0 ? 'closed' : side;

  indicator.textContent = indicatorText();
  prevButton.disabled = !canStep(-1);
  nextButton.disabled = !canStep(1);

  // Tira do Tab e dos leitores de tela o que está escondido atrás de outras folhas.
  const spread = spreadOf(page);
  for (const [index, leaf] of leaves) {
    const [front, back] = leaf.children;
    front.inert = index !== spread || (mobile.matches && side === 'left');
    back.inert = index !== spread - 1 || (mobile.matches && side === 'right');
  }
}

// Som da folha: ruído filtrado gerado na hora, sem arquivo de áudio.

let audio = null;
let noise = null;
let soundOn = readSoundPreference();

function readSoundPreference() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

function setSound(on) {
  soundOn = on;
  soundButton.setAttribute('aria-pressed', String(on));
  soundButton.setAttribute('aria-label', on ? 'Desligar som da folha' : 'Ligar som da folha');
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Sem armazenamento a escolha só vale até recarregar.
  }
}

function crinkle(at, duration, peak, fromHz, toHz) {
  const source = audio.createBufferSource();
  source.buffer = noise;

  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = .9;
  filter.frequency.setValueAtTime(fromHz, at);
  filter.frequency.exponentialRampToValueAtTime(toHz, at + duration);

  const gain = audio.createGain();
  gain.gain.setValueAtTime(.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + duration * .25);
  gain.gain.exponentialRampToValueAtTime(.0001, at + duration);

  source.connect(filter).connect(gain).connect(audio.destination);
  source.start(at, Math.random() * .3, duration);
}

function playFlip() {
  if (!soundOn) return;
  const AudioEngine = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioEngine) return;

  if (!audio) {
    audio = new AudioEngine();
    noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
  }
  audio.resume();

  const now = audio.currentTime;
  crinkle(now, .26, .16, 3200, 1100);
  crinkle(now + .42, .2, .22, 1500, 500);
}

// Carta ampliada

const zoom = $('zoom');
const zoomCard = $('zoomCard');
const zoomInfo = $('zoomInfo');
const zoomFlip = $('zoomFlip');
let zoomSource = null;
let zoomClosing = false;

function displayName(card) {
  return card.printed_name ?? card.name.split(' // ')[0];
}

function zoomFromSource() {
  const from = zoomSource.getBoundingClientRect();
  const to = zoomCard.getBoundingClientRect();
  const x = from.left + from.width / 2 - (to.left + to.width / 2);
  const y = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${x}px, ${y}px) scale(${from.width / to.width})`;
}

function openZoom(card, source) {
  const original = card.name.split(' // ')[0];
  const double = card.images.length > 1;

  $('zoomFront').src = card.images[0];
  $('zoomFront').alt = displayName(card);
  $('zoomBack').src = double ? card.images[1] : '';
  $('zoomBack').alt = double ? `${displayName(card)}, verso` : '';
  $('zoomName').textContent = displayName(card);
  $('zoomOriginal').textContent = card.printed_name && card.printed_name !== original ? original : '';

  const facts = [
    ['Edição', card.set_name],
    ['Número', `${card.set.toUpperCase()} ${card.collector_number}`],
    ['Raridade', RARITIES[card.rarity] ?? card.rarity],
    ['Idioma', LANGUAGES[card.lang] ?? card.lang.toUpperCase()],
    ['Acabamento', card.foil ? 'Foil' : 'Normal'],
    ['Quantidade', card.qty],
  ];
  $('zoomFacts').replaceChildren(...facts.flatMap(([label, value]) => {
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    return [term, detail];
  }));

  $('priceLink').href = LIGA_URL + encodeURIComponent(original).replace(/%20/g, '+');

  zoomCard.classList.remove('flipped');
  zoomCard.classList.toggle('is-foil', card.foil);
  zoomCard.classList.toggle('is-double', double);
  zoomFlip.hidden = !double;

  zoomSource = source;
  zoom.showModal();

  if (!reducedMotion.matches) {
    zoomCard.animate(
      [{ transform: zoomFromSource() }, { transform: 'none' }],
      { duration: 340, easing: 'cubic-bezier(.2, .8, .2, 1)' },
    );
    zoomInfo.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 340, easing: 'ease-out' });
  }
}

async function closeZoom() {
  if (zoomClosing || !zoom.open) return;
  zoomClosing = true;

  if (!reducedMotion.matches) {
    zoomCard.classList.remove('flipped');
    zoomInfo.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    const out = zoomCard.animate(
      [{ transform: 'none' }, { transform: zoomFromSource() }],
      { duration: 240, easing: 'ease-in', fill: 'forwards' },
    );
    await out.finished;
    out.cancel();
    zoomInfo.getAnimations().forEach((animation) => animation.cancel());
  }

  zoom.close();
  zoomSource?.focus({ preventScroll: true });
  zoomClosing = false;
}

function trackFoil(event, element) {
  const box = element.getBoundingClientRect();
  element.style.setProperty('--mx', ((event.clientX - box.left) / box.width).toFixed(3));
  element.style.setProperty('--my', ((event.clientY - box.top) / box.height).toFixed(3));
}

// Eventos

let swipeStart = null;
let swiped = false;

book.addEventListener('pointerdown', (event) => {
  swipeStart = { x: event.clientX, y: event.clientY };
  swiped = false;
});

book.addEventListener('pointerup', (event) => {
  if (!swipeStart) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    swiped = true;
    step(dx < 0 ? 1 : -1);
  }
});

book.addEventListener('click', (event) => {
  if (swiped) {
    swiped = false;
    return;
  }

  const pocket = event.target.closest('button.pocket');
  if (pocket) {
    openZoom(cards[Number(pocket.dataset.index)], pocket);
    return;
  }

  if (page === 0 || mobile.matches) return step(1);
  const box = book.getBoundingClientRect();
  step(event.clientX < box.left + box.width / 2 ? -1 : 1);
});

book.addEventListener('pointermove', (event) => {
  const foil = event.target.closest('.pocket')?.querySelector('.foil-layer');
  if (foil) trackFoil(event, foil.parentElement);
});

zoomCard.addEventListener('pointermove', (event) => trackFoil(event, zoomCard));

prevButton.addEventListener('click', () => step(-1));
nextButton.addEventListener('click', () => step(1));
soundButton.addEventListener('click', () => setSound(!soundOn));

document.addEventListener('keydown', (event) => {
  if (zoom.open) return;
  if (event.key === 'ArrowRight') step(1);
  if (event.key === 'ArrowLeft') step(-1);
});

zoom.addEventListener('cancel', (event) => {
  event.preventDefault();
  closeZoom();
});

zoom.addEventListener('click', (event) => {
  if (event.target === zoom || event.target.classList.contains('zoom-layout')) closeZoom();
});

$('zoomClose').addEventListener('click', closeZoom);
zoomFlip.addEventListener('click', () => zoomCard.classList.toggle('flipped'));

mobile.addEventListener('change', render);

// Início

function collectionSummary() {
  const total = cards.reduce((sum, card) => sum + card.qty, 0);
  const kinds = cards.length === 1 ? '1 carta diferente' : `${cards.length} cartas diferentes`;
  const pages = pageCount === 1 ? '1 página' : `${pageCount} páginas`;
  return `${total} ${total === 1 ? 'carta' : 'cartas'} na coleção, ${kinds}, em ${pages}.`;
}

async function start() {
  setSound(soundOn);

  try {
    const response = await fetch('data/cards.json');
    if (!response.ok) throw new Error(String(response.status));
    cards = await response.json();
  } catch {
    const message = $('statusMessage');
    message.textContent = 'Não consegui carregar a coleção. Se abriu o arquivo direto do disco, use um servidor local (veja o README).';
    message.hidden = false;
    book.hidden = true;
    return;
  }

  pageCount = Math.max(1, Math.ceil(cards.length / POCKETS_PER_PAGE));
  leafCount = 1 + Math.ceil(pageCount / 2);
  $('endNote').textContent = `Fim da pasta. ${collectionSummary()}`;

  syncLeaves();
  render();
}

start();
