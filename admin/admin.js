// Админка портфолио. Работает в браузере, без сервера. Содержимое (content/*.json и картинки) она умеет:
// — публиковать на сайт: одним коммитом в репозиторий на GitHub (см. github.js), сайт пересобирается сам;
// — читать и сохранять прямо в папке сайта на компьютере (Chrome, Edge);
// — отдавать архивом, если нет ни того ни другого.
import { toneInfo, contrastOf, LC_HEAD, LC_TEXT } from '../js/theme.js';
import { gh, gitSha, GhError, DEFAULT_REPO } from './github.js';
import { LINES, LINE_INFO } from '../js/lines.js';
import { HERO_DEFAULT } from '../js/catalog.js';
import { likesApi, likeCounts } from '../js/likes.js';
import { DEFAULT_STICKERS, dieCut } from '../js/stickers.js';
import { polaroidsApi, fetchList, setHidden, removePolaroid, modImage } from '../js/polaroids.js';
import { markOwner } from '../js/stats.js';
import { STYLE_GROUPS, STYLE_TOKENS, styleValue } from '../js/style.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const HAS_FS = 'showDirectoryPicker' in window;
const isAsset = (s) => typeof s === 'string' && /^assets\/.+\.[a-z0-9]{2,5}$/i.test(s);
const fileName = (p) => String(p || '').split('/').pop();
const fmtBytes = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1e3))} КБ`);
const SVG = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = { undo: SVG('<path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H6"/><path d="M6 4 3 7l3 3"/>'), up: SVG('<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>'), down: SVG('<path d="M8 3v10M3.5 8.5 8 13l4.5-4.5"/>'), x: SVG('<path d="m4 4 8 8M12 4l-8 8"/>'),
  dup: SVG('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M3 10.5V4a1.5 1.5 0 0 1 1.5-1.5H11"/>'), grip: SVG('<path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" stroke-width="2.2"/>') };

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slugify = (s) => String(s || '').toLowerCase().replace(/[а-яё]/g, (c) => TR[c] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// Виды блоков кейса: название, подсказка и заготовка. Как блок выглядит на сайте — см. js/case.js
const BLOCKS = {
  text: { name: 'Текст', hint: 'Заголовок и абзацы', make: () => ({ type: 'text', title: '', text: '' }) },
  image: { name: 'Картинка', hint: 'Одна работа крупно', make: () => ({ type: 'image', src: '', alt: '', caption: '', width: 'wide' }) },
  gallery: { name: 'Плитки', hint: 'Несколько работ: квадраты, телефоны или карточки с подписью', make: () => ({ type: 'gallery', columns: 2, items: [] }) },
  idea: { name: 'Идея и лесенка', hint: 'Текст сверху слева, три картинки растут вправо', make: () => ({ type: 'idea', title: '', text: '', items: [] }) },
  split: { name: 'Картинка и текст', hint: 'Телефон с одной стороны, глава — с другой', make: () => ({ type: 'split', title: '', text: '', src: '', alt: '', side: 'left', shape: 'phone' }) },
  links: { name: 'Финал со ссылками', hint: 'Заголовок, текст и кнопки: Figma, прототип', make: () => ({ type: 'links', title: '', text: '', items: [{ label: 'Figma', url: '' }] }) },
  metrics: { name: 'Цифры', hint: 'Результаты крупными числами', make: () => ({ type: 'metrics', items: [{ v: '', l: '' }] }) },
  quote: { name: 'Цитата', hint: 'Слова заказчика или коллеги', make: () => ({ type: 'quote', text: '', author: '', role: '' }) },
  steps: { name: 'Шаги', hint: 'Процесс по порядку', make: () => ({ type: 'steps', title: '', items: [{ title: '', text: '' }] }) },
  compare: { name: 'До / после', hint: 'Сравнение ползунком', make: () => ({ type: 'compare', before: { src: '', alt: '' }, after: { src: '', alt: '' }, caption: '' }) },
  video: { name: 'Видео', hint: 'Запись интерфейса или ролик', make: () => ({ type: 'video', src: '', poster: '', loop: true, caption: '' }) },
  palette: { name: 'Палитра', hint: 'Цвета проекта', make: () => ({ type: 'palette', title: '', colors: [{ hex: '#000000', name: '' }] }) },
  say: { name: 'Реплика головы', hint: 'Точка между блоками: докрутили до неё — голова говорит', make: () => ({ type: 'say', say: '' }) },
};
// Банк идей (админка → «Настройки» → «Заметки для себя»): концепции, которые ещё не собраны. key — выключатель, когда идея готова
const IDEAS = [];      // полароид собран — у него свой раздел настроек («Полароид»)
// Разделы админки — колонка слева. Внутри некоторых — вкладки (SUBS). Предпросмотр справа — только там, где он
// что-то показывает (hasPrev): кейсы, разделы главной, профиль и стиль; остальным разделам отдаётся вся ширина
const NAV = [
  { id: 'cases', name: 'Кейсы', hint: 'Проекты: тексты, обложки, блоки', ico: SVG('<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2"/><rect x="9" y="9" width="4.5" height="4.5" rx="1.2"/>') },
  { id: 'home', name: 'Главная', hint: 'Папки разделов, реплики головы, пасхалки', ico: SVG('<path d="M2.5 7.2 8 2.75l5.5 4.45v5.8a.75.75 0 0 1-.75.75H10V10H6v3.75H3.25a.75.75 0 0 1-.75-.75z"/>') },
  { id: 'pol', name: 'Полароиды', hint: 'Карточки гостей и наклейки', ico: SVG('<rect x="3" y="2" width="10" height="12" rx="1.2"/><rect x="4.8" y="3.8" width="6.4" height="6.4" rx=".4"/>') },
  { id: 'stats', name: 'Статистика', hint: 'Кто заходил и что смотрел', ico: SVG('<path d="M3 13.5V9.5M8 13.5V3M13 13.5V7"/>') },
  { id: 'profile', name: 'Профиль', hint: 'Имя, контакты, резюме, языки', ico: SVG('<circle cx="8" cy="5.4" r="2.7"/><path d="M2.8 13.8c.6-2.6 2.7-4 5.2-4s4.6 1.4 5.2 4"/>') },
  { id: 'style', name: 'Стиль', hint: 'Цвета и размеры сайта', ico: SVG('<path d="M8 2.3S3.8 6.6 3.8 9.5a4.2 4.2 0 0 0 8.4 0C12.2 6.6 8 2.3 8 2.3z"/>') },
  { id: 'settings', name: 'Настройки', hint: 'Подключение, функции, ключи, пароль', ico: SVG('<path d="M2.5 4.5h6.2M11.7 4.5h1.8M2.5 11.5h1.8M7.3 11.5h6.2"/><circle cx="10.2" cy="4.5" r="1.5"/><circle cx="5.8" cy="11.5" r="1.5"/>') },
];
const SUBS = { home: [['sections', 'Разделы'], ['lines', 'Реплики головы'], ['fun', 'Пасхалки и звук']], pol: [['cards', 'Карточки'], ['stickers', 'Наклейки']] };
const subOf = (page) => (SUBS[page] && SUBS[page].some(([k]) => k === st.sub[page]) ? st.sub[page] : SUBS[page] ? SUBS[page][0][0] : '');
// предпросмотру нужно хотя бы ~420 пикселей рядом со страницей; уже — он прячется сам (в «Кейсах» мешает ещё и список)
const narrowScreen = () => window.innerWidth - 84 - (st.page === 'cases' ? 272 : 0) - 440 < 420;
const hasPrev = () => (st.page === 'cases' ? st.idx >= 0 : st.page === 'home' ? subOf('home') === 'sections' : st.page === 'profile' || st.page === 'style');
const MAKE = { metric: () => ({ v: '', l: '' }), step: () => ({ title: '', text: '' }), color: () => ({ hex: '#000000', name: '' }), link: () => ({ label: '', url: '' }) };

const st = {
  site: null, projects: [], saved: '', dir: null, mtime: {},
  src: 'server',               // откуда открыто содержимое: 'dir' — папка, 'github' — репозиторий сайта, 'server' — копия рядом с админкой
  unpub: false,                // (папка + сайт) в папке лежит не то, что на сайте
  busy: false, pubNote: '', pubAt: '', pubSha: '',     // публикация: идёт ли, что написать в статусе, когда и какой коммит
  pending: new Map(),          // новые файлы, ещё не записанные в папку: путь → Blob
  urls: new Map(),             // путь → адрес для показа в админке и в предпросмотре
  idx: 0, tab: 'main', lang: 'ru', device: 'desktop', view: 'case',
  page: 'cases', sub: {}, lastIdx: 0,     // раздел админки (см. NAV), вкладка внутри раздела, последний открытый кейс
  prevOn: (() => { try { return localStorage.getItem('ph:admin-prev') !== '0'; } catch (_) { return true; } })(),     // предпросмотр не свёрнут
  open: new Set(), menu: false, undo: null,
};
const autoSlug = new WeakSet();   // у новых проектов адрес следует за названием, пока его не поправили руками
const cur = () => (st.idx < 0 ? st.site : st.projects[st.idx]);
const defLang = () => (st.site && st.site.defaultLang) || 'ru';
const isL = (v) => v && typeof v === 'object' && !Array.isArray(v);
const getL = (v) => (isL(v) ? (v[st.lang] ?? '') : (st.lang === defLang() ? (v ?? '') : ''));
const txDef = (v) => (isL(v) ? (v[defLang()] ?? '') : (v ?? ''));
const txAny = (v) => String(isL(v) ? (v[st.lang] || v[defLang()] || Object.values(v)[0] || '') : (v ?? ''));
function setL(old, text) {
  if (st.lang === defLang() && !isL(old)) return text;
  const o = isL(old) ? { ...old } : { [defLang()]: old ?? '' };
  o[st.lang] = text;
  return o;
}
const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, path, v) {
  const ks = path.split('.');
  let a = o;
  for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[ks[i]]; }
  a[ks[ks.length - 1]] = v;
}
function delPath(o, path) {
  const ks = path.split('.');
  const a = ks.slice(0, -1).reduce((x, k) => (x == null ? x : x[k]), o);
  if (a && typeof a === 'object') delete a[ks[ks.length - 1]];
}
const snapshot = () => JSON.stringify({ site: st.site, projects: st.projects });
const dirty = () => !!st.site && (snapshot() !== st.saved || st.pending.size > 0);
const secName = (id) => { const s = (st.site.sections || []).find((x) => x.id === id); return s ? txAny(s.label) : 'Без раздела'; };

// ---------- папка сайта на диске ----------
async function fsHandle(path, create = false) {
  const parts = path.split('/').filter(Boolean);
  let d = st.dir;
  for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i], { create });
  return d.getFileHandle(parts[parts.length - 1], { create });
}
const fsRead = async (path) => (await fsHandle(path)).getFile();
async function fsWrite(path, data) {
  const w = await (await fsHandle(path, true)).createWritable();
  await w.write(data);
  await w.close();
}
// выбранная папка запоминается, чтобы в следующий раз не искать её заново
const idb = {
  open: () => new Promise((res, rej) => { const r = indexedDB.open('ph-admin', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async get(k) { try { const db = await this.open(); return await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); }); } catch (_) { return undefined; } },
  async set(k, v) { try { const db = await this.open(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (_) { /* noop */ } },
};

// архив без сжатия — для браузеров, которые не умеют писать в папку
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// ---------- загрузка содержимого ----------
function normalize() {
  const obj = (a) => (typeof a === 'string' ? { src: a, alt: '' } : a);
  for (const p of st.projects) {
    p.artifacts = (p.artifacts || []).map(obj);
    p.blocks = p.blocks || [];
    p.theme = p.theme || {};
    for (const b of p.blocks) if (b.type === 'gallery') b.items = (b.items || []).map(obj);
  }
  st.site.sections = st.site.sections || [];
  st.site.languages = st.site.languages && st.site.languages.length ? st.site.languages : ['ru'];
  // наклейки полароида: десять мест; чего в содержимом нет — берём исходное (id, название, эмодзи)
  const pol = st.site.polaroid = st.site.polaroid && typeof st.site.polaroid === 'object' ? st.site.polaroid : {};
  const own = Array.isArray(pol.stickers) ? pol.stickers : [];
  pol.stickers = DEFAULT_STICKERS.map((d) => { const o = own.find((x) => x && x.id === d.id) || {}; return { id: d.id, name: o.name ?? d.name, emoji: o.emoji ?? d.emoji, image: o.image || '' }; });
}
function init(site, projects) {
  st.site = site; st.projects = projects;
  normalize();
  st.saved = snapshot();
  st.pending.clear();
  st.idx = projects.length ? 0 : -1;
  st.tab = 'main'; st.open.clear(); st.page = 'cases';
  st.lang = defLang();
  $('[data-gate]').hidden = true;
  $('[data-app]').hidden = false;
  renderAll();
  if (!readHash()) syncHash();
  sendPreview(true);
  loadLikes();
}
async function loadFromDir(dir) {
  st.dir = dir;
  let sf, pf;
  try { [sf, pf] = await Promise.all([fsRead('content/site.json'), fsRead('content/projects.json')]); } catch (e) {
    st.dir = null;
    throw new Error('В этой папке нет файлов сайта. Выберите папку, в которой лежит index.html и папка content.');
  }
  st.mtime = { site: sf.lastModified, projects: pf.lastModified };
  st.src = 'dir'; st.unpub = false;
  init(JSON.parse(await sf.text()), JSON.parse(await pf.text()).projects || []);
  idb.set('dir', dir);
  if (gh.on) syncCheck();
}
async function loadFromServer() {
  const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`Не открывается ${u}`); return r.json(); });
  const [site, data] = await Promise.all([get('../content/site.json'), get('../content/projects.json')]);
  st.dir = null; st.src = 'server';
  init(site, data.projects || []);
}
// Содержимое берётся прямо из репозитория сайта — самое свежее, даже если страницы сайта ещё пересобираются
const SITE_JSON = 'content/site.json', PROJ_JSON = 'content/projects.json';
async function loadFromGitHub() {
  const snap = await gh.snapshot();
  const a = snap.files.get(SITE_JSON), b = snap.files.get(PROJ_JSON);
  if (!a || !b) throw new GhError(`В «${gh.name}» нет файлов ${SITE_JSON} и ${PROJ_JSON} — похоже, это не репозиторий сайта.`);
  const [site, data] = await Promise.all([gh.readJSON(a), gh.readJSON(b)]);
  st.dir = null; st.src = 'github'; st.unpub = false;
  gh.base = { site: a, projects: b };
  init(site, data.projects || []);
}
// Папка и сайт подключены вместе: совпадает ли содержимое в папке с тем, что сейчас на сайте
async function syncCheck() {
  try {
    const bytes = async (path) => new Uint8Array(await (await fsRead(path)).arrayBuffer());
    const [a, b, snap] = await Promise.all([bytes(SITE_JSON).then(gitSha), bytes(PROJ_JSON).then(gitSha), gh.snapshot()]);
    const cur = { site: snap.files.get(SITE_JSON), projects: snap.files.get(PROJ_JSON) }, known = gh.base;
    if (a === cur.site && b === cur.projects) { gh.base = cur; st.unpub = false; }
    else {
      st.unpub = true;
      if (!known || known.site !== cur.site || known.projects !== cur.projects) toast('В папке и на сайте разное содержимое. Перед публикацией убедитесь, что в папке нужная версия');
    }
    renderBar();
  } catch (_) { /* нет связи — разницу увидим при публикации */ }
}

// ---------- картинки ----------
// Большие картинки уменьшаются и сохраняются в WebP: страница кейса должна открываться быстро.
async function prepFile(file, t) {
  const base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'file';
  const ext = ((file.name.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  if (t.kind === 'file' || t.kind === 'video' || ext === 'svg' || ext === 'gif') {
    let size = {};
    if (ext === 'gif') { try { const b = await createImageBitmap(file); size = { w: b.width, h: b.height }; } catch (_) { /* размеры не узнали — не страшно */ } }
    return { blob: file, name: `${base}.${ext || 'bin'}`, alpha: ext === 'svg', ...size, note: file.size > 15e6 ? `«${file.name}» весит ${fmtBytes(file.size)}: страница будет грузиться долго` : '' };
  }
  const bmp = await createImageBitmap(file);
  // Мелкие картинки (работы для папок, наклейка, малая обложка) ограничены по длинной стороне. У картинок кейса важна ширина:
  // длинный скриншот страницы не должен сжаться в узкую полоску. Высота — не больше четырёх ширин, всего — не больше 16 Мп
  // (такую картинку ещё спокойно открывает телефон).
  const max = Number(t.max) || 2400, big = max >= 2000;
  const k = big
    ? Math.min(1, max / bmp.width, (max * 4) / bmp.height, Math.sqrt(16e6 / (bmp.width * bmp.height)))
    : Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  // есть ли прозрачность (картинка «вырезана») — смотрим уменьшенную копию
  const s = document.createElement('canvas');
  s.width = s.height = 64;
  const sx = s.getContext('2d', { willReadFrequently: true });
  sx.drawImage(bmp, 0, 0, 64, 64);
  const px = sx.getImageData(0, 0, 64, 64).data;
  let alpha = false;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 245) { alpha = true; break; }
  let blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.86)), outExt = 'webp';
  if (!blob || blob.type !== 'image/webp') { blob = await new Promise((res) => c.toBlob(res, alpha ? 'image/png' : 'image/jpeg', 0.88)); outExt = alpha ? 'png' : 'jpg'; }
  if (k === 1 && file.size <= blob.size && /^(png|jpe?g|webp|avif)$/.test(ext)) { blob = file; outExt = ext; }    // и так лёгкая — не трогаем
  return { blob, name: `${base}.${outExt}`, alpha, w, h };
}
// Размеры картинки хранятся рядом с её адресом: страница кейса заранее оставляет под неё место и не «прыгает» при загрузке
function setDims(obj, path, size) {
  const base = path.replace(/src$/, '');
  if (base === path) return;
  if (size && size.w > 0 && size.h > 0) { setPath(obj, `${base}w`, size.w); setPath(obj, `${base}h`, size.h); } else { delPath(obj, `${base}w`); delPath(obj, `${base}h`); }
}
// Малая копия картинки (для обложки): в папках, «разлёте» работ и размытом фоне большая обложка не нужна —
// она весит в десять раз больше и тормозит главную и каталог. Большая остаётся для шапки кейса.
const THUMB_MAX = 720;
async function addThumb(obj, file, t, folder, out) {
  delPath(obj, t.thumb);
  if (!out.w || Math.max(out.w, out.h) <= THUMB_MAX * 1.25) return;       // и так небольшая (или SVG/GIF) — копия не нужна
  let small;
  try { small = await prepFile(file, { ...t, max: THUMB_MAX }); } catch (_) { return; }
  const path = uniquePath(`${folder}/${small.name.replace(/(\.[^.]+)$/, '-s$1')}`);
  st.pending.set(path, small.blob);
  st.urls.set(path, URL.createObjectURL(small.blob));
  setPath(obj, t.thumb, path);
}
function usedPaths() {
  const set = new Set(st.pending.keys());
  const walk = (o) => { for (const v of Object.values(o)) { if (isAsset(v)) set.add(v); else if (v && typeof v === 'object') walk(v); } };
  walk({ site: st.site, projects: st.projects });
  return set;
}
function uniquePath(path) {
  const used = usedPaths();
  if (!used.has(path)) return path;
  const m = /^(.*?)(\.[^.]+)$/.exec(path);
  for (let n = 2; ; n++) { const p = `${m[1]}-${n}${m[2]}`; if (!used.has(p)) return p; }
}
async function blobUrl(path) {
  if (st.urls.has(path)) return st.urls.get(path);
  if (!st.dir) return null;
  try { const u = URL.createObjectURL(await fsRead(path)); st.urls.set(path, u); return u; } catch (_) { return null; }
}
function hydrate(root) {
  $$('[data-src]', root).forEach(async (el) => {
    const p = el.dataset.src;
    el.src = /^(blob:|https?:|data:)/.test(p) ? p : ((await blobUrl(p)) || `../${p}`);
    // открыто с сайта: файла может не быть рядом с админкой (его добавили с другого компьютера) — берём из репозитория
    if (st.src === 'github' && gh.on && isAsset(p)) el.onerror = () => { el.onerror = null; gh.blobUrl(p).then((u) => { el.src = u || gh.rawUrl(p); }); };
  });
}
async function addFiles(files, t) {
  const obj = cur();
  const folder = t.folder || (st.idx < 0 ? 'assets' : `assets/cases/${obj.slug || 'project'}`);
  let n = 0;
  for (const file of files) {
    let out;
    try { out = await prepFile(file, t); } catch (e) { toast(`Не получилось прочитать «${file.name}»`); continue; }
    const path = t.fixed || uniquePath(`${folder}/${out.name}`);
    st.pending.set(path, out.blob);
    if (st.urls.has(path)) URL.revokeObjectURL(st.urls.get(path));
    st.urls.set(path, URL.createObjectURL(out.blob));
    if (t.kind === 'list') {
      const arr = getPath(obj, t.path) || [];
      arr.push({ src: path, alt: '', ...(t.dims && out.w ? { w: out.w, h: out.h } : {}), ...(out.alpha && t.cut ? { cut: true } : {}) });
      setPath(obj, t.path, arr);
    } else {
      setPath(obj, t.path, t.l ? setL(getPath(obj, t.path), path) : path);
      if (t.cut && out.alpha) setPath(obj, t.cut, true);
      if (t.dims) setDims(obj, t.path, out);
      if (t.thumb) await addThumb(obj, file, t, folder, out);
    }
    if (out.note) toast(out.note);
    n++;
    if (t.kind !== 'list') break;
  }
  if (!n) return;
  renderEdit();
  changed(t.path);
}

// ---------- поля формы ----------
const val = (path) => getPath(cur(), path);
function F(label, path, o = {}) {
  const v = val(path);
  let text = o.l ? getL(v) : (v ?? '');
  if (o.kind === 'list') text = (v || []).map((x) => (o.l ? getL(x) : x)).join(', ');
  const ph = o.l && st.lang !== defLang() && o.kind !== 'list' ? txDef(v) : (o.ph || '');     // при переводе исходный текст — подсказкой
  const a = `data-path="${path}"${o.l ? ' data-l="1"' : ''}${o.kind ? ` data-kind="${o.kind}"` : ''}`;
  let input;
  if (o.type === 'area') input = `<textarea ${a} rows="${o.rows || 3}" placeholder="${esc(ph)}">${esc(text)}</textarea>`;
  else if (o.type === 'select') input = `<select ${a}>${o.options.map(([k, n]) => `<option value="${esc(k)}"${String(v ?? '') === String(k) ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  else input = `<input type="${o.type === 'number' ? 'number' : 'text'}" ${a} value="${esc(text)}" placeholder="${esc(ph)}"${o.attrs ? ` ${o.attrs}` : ''}>`;
  return `<label class="f"><span>${esc(label)}</span>${input}${o.hint ? `<small class="hint">${esc(o.hint)}</small>` : ''}</label>`;
}
const CHECK = (label, path, on) => `<div class="f"><label class="switch"><input type="checkbox" data-path="${path}" data-kind="bool"${(on ?? val(path)) ? ' checked' : ''}><span>${esc(label)}</span></label></div>`;
function COLOR(label, path, o = {}) {
  const v = val(path) || '';
  const ph = o.def ? o.def : o.optional ? 'не задан' : '#RRGGBB';
  return `<div class="f"><span>${esc(label)}${o.def ? ` <small class="hint">по умолчанию ${esc(o.def)}</small>` : ''}</span><div class="color">
    <input type="color" data-path="${path}" data-kind="color" value="${/^#[0-9a-f]{6}$/i.test(v) ? v : (o.def || '#ffffff')}" aria-label="${esc(label)}: выбрать цвет">
    <input type="text" class="inp" data-path="${path}" data-kind="hex"${o.optional ? ' data-optional="1"' : ''} value="${esc(v)}" placeholder="${esc(ph)}" aria-label="${esc(label)}: код цвета" spellcheck="false">
    ${o.optional && v ? `<button class="ico x" type="button" data-act="clear" data-path="${path}" aria-label="Убрать цвет">${I.x}</button>` : ''}
  </div>${o.hint ? `<small class="hint">${esc(o.hint)}</small>` : ''}</div>`;
}
// Дизайн-токен из js/style.js: не задан — в поле значение по умолчанию (подписано), «Сбросить стиль» убирает все свои значения
function TOKEN(tok) {
  const path = `style.${tok.key}`, v = styleValue(st.site.style, tok.key);
  if (tok.type === 'color') return COLOR(tok.label, path, { optional: 1, def: tok.def });
  if (tok.type === 'select') {
    const defName = (tok.options.find(([k]) => k === tok.def) || [])[1] || tok.def;
    return `<label class="f"><span>${esc(tok.label)} <small class="hint">по умолчанию ${esc(defName)}</small></span><select data-path="${path}" data-kind="num">${tok.options.map(([k, n]) => `<option value="${k}"${Number(k) === Number(v) ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
  }
  return `<label class="f"><span>${esc(tok.label)} <small class="hint">по умолчанию ${tok.def}${tok.unit}</small></span><span class="range"><input type="range" data-path="${path}" data-kind="num" min="${tok.min}" max="${tok.max}" step="${tok.step}" value="${v}" data-unit="${tok.unit}"><output>${v}${tok.unit}</output></span></label>`;
}
function stylePane() {
  const own = st.site.style && Object.keys(st.site.style).length;
  return `${STYLE_GROUPS.map((g) => SEC(g.title, `<div class="grid2">${g.items.map(TOKEN).join('')}</div>`, g.hint ? esc(g.hint) : '')).join('')}
      ${own ? '<div class="f"><button class="btn btn--line btn--sm" type="button" data-act="style-reset">Сбросить к исходному</button></div>' : ''}`;
}
function RANGE(label, path, min, max, step, unit = '') {
  const v = Number(val(path)) || 0;
  return `<label class="f"><span>${esc(label)}</span><span class="range"><input type="range" data-path="${path}" data-kind="num" min="${min}" max="${max}" step="${step}" value="${v}" data-unit="${unit}"><output>${v}${unit}</output></span></label>`;
}
function IMG(label, path, o = {}) {
  const v = val(path);
  const src = o.l ? getL(v) : (v || '');
  const kind = o.kind || 'image';
  // «none» у визуала обложки кейса — визуала нет нарочно (обложка только с логотипом и слоганом), это не файл
  const none = src === 'none';
  const thumb = none ? 'без визуала' : !src ? 'нет файла' : kind === 'file' ? 'PDF' : kind === 'video' ? `<video data-src="${esc(src)}" muted preload="metadata"></video>` : `<img data-src="${esc(src)}" alt="">`;
  const data = `data-path="${path}" data-kind="${kind}" data-max="${o.max || 2400}"${o.l ? ' data-l="1"' : ''}${o.cut ? ` data-cut="${o.cut}"` : ''}${o.dims ? ' data-dims="1"' : ''}${o.thumb ? ` data-thumb="${o.thumb}"` : ''}${o.fixed ? ` data-fixed="${o.fixed}"` : ''}${o.folder ? ` data-folder="${o.folder}"` : ''}`;
  return `<div class="imgf${o.small ? ' imgf--sm' : ''}" data-drop ${data}>
    <div class="imgf-thumb">${thumb}</div>
    <div class="imgf-main"><span class="lbl">${esc(label)}</span><span class="imgf-name">${esc(none ? 'Без визуала: в обложке только логотип и слоган. «Убрать» — вернуть визуал из каталога.' : src ? src : (o.hint || ''))}</span>
      <div class="row"><button class="btn btn--line btn--sm" type="button" data-act="pick" ${data}>${src ? 'Заменить' : 'Выбрать файл'}</button>
      ${src ? `<button class="btn btn--line btn--sm" type="button" data-act="clear" data-path="${path}"${o.l ? ' data-l="1"' : ''}${o.dims ? ' data-dims="1"' : ''}${o.thumb ? ` data-thumb="${o.thumb}"` : ''}>Убрать</button>` : ''}</div>
    </div></div>`;
}
function HEROPOS(layout, label) {
  const h = cur().hero || {}, own = h[layout] && typeof h[layout] === 'object';
  const pos = { ...HERO_DEFAULT[layout], ...(own ? h[layout] : {}) };
  const r = (name, key, min, max, v) => `<label class="f"><span>${name}</span><span class="range"><input type="range" data-path="hero.${layout}.${key}" data-kind="${key === 's' ? 'num' : 'pct'}" min="${min}" max="${max}" step="${key === 's' ? 0.5 : 0.5}" value="${v}" data-unit="%"><output>${v}%</output></span></label>`;
  return `<div class="heropos" data-heropos="${layout}"><div class="heropos-h"><span class="lbl">${esc(label)}</span>
      ${own ? `<button class="btn btn--line btn--sm" type="button" data-act="hero-reset" data-layout="${layout}">Как по умолчанию</button>` : '<span class="hint">по умолчанию</span>'}</div>
    <div class="grid3">${r('По горизонтали', 'x', -20, 120, +(pos.x * 100).toFixed(1))}${r('По вертикали', 'y', -20, 120, +(pos.y * 100).toFixed(1))}${r('Размер', 's', 4, 160, pos.s)}</div></div>`;
}
function tools(path, i, n, what) {
  return `<span class="tools"><button class="ico" type="button" data-act="item-up" data-path="${path}" data-i="${i}" aria-label="Выше"${i ? '' : ' disabled'}>${I.up}</button>
    <button class="ico" type="button" data-act="item-down" data-path="${path}" data-i="${i}" aria-label="Ниже"${i < n - 1 ? '' : ' disabled'}>${I.down}</button>
    <button class="ico" type="button" data-act="item-del" data-path="${path}" data-i="${i}" aria-label="Убрать ${what}">${I.x}</button></span>`;
}
function IMGLIST(path, o = {}) {
  const items = val(path) || [];
  const data = `data-path="${path}" data-kind="list" data-max="${o.max || 2000}"${o.cut ? ' data-cut="1"' : ''}${o.dims ? ' data-dims="1"' : ''}`;
  return `<div class="imglist" data-drop ${data}>
    <ol>${items.map((it, i) => `<li>
      <span class="thumb"><img data-src="${esc(it.src)}" alt=""></span>
      <span><input type="text" class="inp" data-path="${path}.${i}.alt" data-l="1" value="${esc(getL(it.alt))}" placeholder="${esc(st.lang !== defLang() && txDef(it.alt) ? txDef(it.alt) : 'Что на картинке')}" aria-label="Описание картинки ${i + 1}">
        ${o.caption ? `<input type="text" class="inp" data-path="${path}.${i}.caption" data-l="1" value="${esc(getL(it.caption))}" placeholder="Подпись под картинкой (необязательно)" aria-label="Подпись к картинке ${i + 1}">` : ''}
        <span class="meta">${o.cut ? `<label><input type="checkbox" data-path="${path}.${i}.cut" data-kind="bool"${it.cut ? ' checked' : ''}> без фона</label>` : ''}<span>${esc(fileName(it.src))}</span></span></span>
      ${tools(path, i, items.length, 'картинку')}
    </li>`).join('')}</ol>
    <div class="imglist-add"><button class="btn btn--line btn--sm" type="button" data-act="pick" ${data}>Добавить картинки</button><span class="hint">или перетащите файлы сюда</span></div>
  </div>`;
}
function PAIRS(path, kind) {
  const items = val(path) || [];
  const cell = {
    metric: (it, i) => `<span class="cells"><input type="text" class="inp" data-path="${path}.${i}.v" data-l="1" value="${esc(getL(it.v))}" placeholder="+34%" aria-label="Цифра ${i + 1}">
      <input type="text" class="inp" data-path="${path}.${i}.l" data-l="1" value="${esc(getL(it.l))}" placeholder="что она значит" aria-label="Подпись к цифре ${i + 1}"></span>`,
    step: (it, i) => `<span class="cells col"><input type="text" class="inp" data-path="${path}.${i}.title" data-l="1" value="${esc(getL(it.title))}" placeholder="Шаг ${i + 1}" aria-label="Название шага ${i + 1}">
      <input type="text" class="inp" data-path="${path}.${i}.text" data-l="1" value="${esc(getL(it.text))}" placeholder="Что сделали и что это дало" aria-label="Описание шага ${i + 1}"></span>`,
    link: (it, i) => `<span class="cells"><input type="text" class="inp" data-path="${path}.${i}.label" data-l="1" value="${esc(getL(it.label))}" placeholder="Figma" aria-label="Надпись на кнопке ${i + 1}">
      <input type="text" class="inp" data-path="${path}.${i}.url" value="${esc(it.url || '')}" placeholder="https://…" aria-label="Адрес ссылки ${i + 1}" spellcheck="false" inputmode="url"></span>`,
    color: (it, i) => `<span class="cells hex"><input type="color" data-path="${path}.${i}.hex" data-kind="color" value="${/^#[0-9a-f]{6}$/i.test(it.hex || '') ? it.hex : '#000000'}" aria-label="Цвет ${i + 1}">
      <input type="text" class="inp" data-path="${path}.${i}.hex" data-kind="hex" value="${esc(it.hex || '')}" aria-label="Код цвета ${i + 1}" spellcheck="false">
      <input type="text" class="inp" data-path="${path}.${i}.name" data-l="1" value="${esc(getL(it.name))}" placeholder="Название" aria-label="Название цвета ${i + 1}"></span>`,
  }[kind];
  const word = { metric: ['цифру', 'Добавить цифру'], step: ['шаг', 'Добавить шаг'], color: ['цвет', 'Добавить цвет'], link: ['ссылку', 'Добавить ссылку'] }[kind];
  const full = kind === 'metric' && items.length >= 4;
  return `<ol class="pairs">${items.map((it, i) => `<li>${cell(it, i)}${tools(path, i, items.length, word[0])}</li>`).join('')}</ol>
    <div class="f">${full ? '<span class="hint">В ряд помещается четыре цифры.</span>' : `<button class="btn btn--line btn--sm" type="button" data-act="item-add" data-path="${path}" data-make="${kind}">${word[1]}</button>`}</div>`;
}
const SAY = (P) => F('Реплика головы', `${P}.say`, { l: 1, hint: 'Необязательно. Голова скажет её, когда блок доедет до середины экрана.' });
const WIDTH = (P) => F('Ширина', `${P}.width`, { type: 'select', options: [['text', 'В колонку текста'], ['wide', 'Широкая'], ['full', 'Во всю ширину экрана']] });

const BF = {
  say: (b, P) => F('Что скажет голова', `${P}.say`, { l: 1, type: 'area', rows: 2, hint: 'Голова в углу скажет это, когда посетитель докрутит до этого места — оно между соседними блоками, на странице его не видно. Коротко, до 90 знаков: «О, тут я жёстко заебался», «А вот это душниловка».' }),
  text: (b, P) => F('Заголовок', `${P}.title`, { l: 1, ph: 'Проблема: «Родитель выбирает из двух плохих вариантов»' }) + F('Текст', `${P}.text`, { l: 1, type: 'area', rows: 6, hint: 'Пустая строка — новый абзац.' })
    + F('Выравнивание', `${P}.align`, { type: 'select', kind: 'opt', options: [['', 'Само: короткий текст — по центру, длинный — слева'], ['center', 'По центру'], ['left', 'Слева']], hint: 'Глава по центру держится вместе со следующей картинкой или плитками.' }) + SAY(P),
  image: (b, P) => IMG('Картинка', `${P}.src`, { cut: `${P}.cut`, dims: 1 }) + F('Что на картинке', `${P}.alt`, { l: 1, hint: 'Для незрячих и поисковиков.' })
    + F('Подпись', `${P}.caption`, { l: 1 }) + WIDTH(P) + CHECK('Картинка без фона — положить на подложку', `${P}.cut`) + COLOR('Цвет подложки', `${P}.bg`, { optional: 1 }) + SAY(P),
  gallery: (b, P) => F('Заголовок', `${P}.title`, { l: 1 })
    + `<div class="grid3">${F('Форма плиток', `${P}.shape`, { type: 'select', kind: 'opt', options: [['', 'По картинке'], ['square', 'Квадрат'], ['phone', 'Телефон 330×574'], ['card', 'Карточка с подписью 287×363']] })}${F('Колонок', `${P}.columns`, { type: 'select', kind: 'num', options: [[1, '1'], [2, '2'], [3, '3'], [4, '4']] })}${F('Картинка в плитке', `${P}.fit`, { type: 'select', kind: 'opt', options: [['', 'Вписать целиком'], ['cover', 'Заполнить плитку']] })}</div>`
    + COLOR('Цвет плиток', `${P}.bg`, { optional: 1, hint: 'Пусто — основной цвет на 10%, как в дизайн-системе.' }) + IMGLIST(`${P}.items`, { dims: 1, caption: 1 }) + SAY(P),
  idea: (b, P) => F('Заголовок', `${P}.title`, { l: 1, ph: 'Идея: «Родитель управляет доверием, а не запретами»' }) + F('Текст', `${P}.text`, { l: 1, type: 'area', rows: 4 })
    + `<p class="hint">Три картинки встают лесенкой: низкая, средняя, высокая (как три уровня доверия). Картинка или короткое видео заполняют плитку.</p>` + IMGLIST(`${P}.items`, { dims: 1 }) + COLOR('Цвет плиток', `${P}.bg`, { optional: 1 }) + SAY(P),
  split: (b, P) => F('Заголовок', `${P}.title`, { l: 1, ph: 'Решение: «Отказ — это маршрут, а не тупик»' }) + F('Текст', `${P}.text`, { l: 1, type: 'area', rows: 4 })
    + IMG('Картинка или видео', `${P}.src`, { kind: 'image', dims: 1, hint: 'Экран телефона или короткая запись интерфейса.' }) + F('Что на картинке', `${P}.alt`, { l: 1 })
    + `<div class="grid2">${F('Картинка', `${P}.side`, { type: 'select', kind: 'opt', options: [['left', 'Слева'], ['right', 'Справа']] })}${F('Форма', `${P}.shape`, { type: 'select', kind: 'opt', options: [['phone', 'Телефон 330×574'], ['square', 'Квадрат']] })}</div>` + COLOR('Цвет плитки', `${P}.bg`, { optional: 1 }) + SAY(P),
  links: (b, P) => F('Заголовок', `${P}.title`, { l: 1, ph: 'Границы и следующий шаг' }) + F('Текст', `${P}.text`, { l: 1, type: 'area', rows: 3 }) + PAIRS(`${P}.items`, 'link') + SAY(P),
  metrics: (b, P) => F('Заголовок', `${P}.title`, { l: 1, ph: 'Метрики: «Как понять, что это работает»' }) + `<p class="hint">Цифры ещё нет (концепт, не мерили) — оставьте цифру пустой: встанет кружок и подпись «что будем мерить».</p>` + PAIRS(`${P}.items`, 'metric') + SAY(P),
  quote: (b, P) => F('Цитата', `${P}.text`, { l: 1, type: 'area', rows: 4 }) + `<div class="grid2">${F('Кто сказал', `${P}.author`, { l: 1 })}${F('Должность, компания', `${P}.role`, { l: 1 })}</div>` + SAY(P),
  steps: (b, P) => F('Заголовок', `${P}.title`, { l: 1, ph: 'Как решал' }) + PAIRS(`${P}.items`, 'step') + SAY(P),
  compare: (b, P) => F('Заголовок', `${P}.title`, { l: 1 }) + IMG('До', `${P}.before.src`, { dims: 1 }) + F('Что на картинке «до»', `${P}.before.alt`, { l: 1 })
    + IMG('После', `${P}.after.src`) + F('Что на картинке «после»', `${P}.after.alt`, { l: 1 }) + F('Подпись', `${P}.caption`, { l: 1 }) + WIDTH(P) + SAY(P),
  video: (b, P) => IMG('Видео', `${P}.src`, { kind: 'video', hint: 'MP4 или WebM. Короткая запись — до 15 МБ.' }) + IMG('Заставка до запуска', `${P}.poster`)
    + CHECK('Короткая запись: крутить по кругу без звука', `${P}.loop`) + F('Что в ролике', `${P}.alt`, { l: 1 }) + F('Подпись', `${P}.caption`, { l: 1 }) + WIDTH(P) + SAY(P),
  palette: (b, P) => F('Заголовок', `${P}.title`, { l: 1 }) + PAIRS(`${P}.colors`, 'color') + SAY(P),
};
function summaryOf(b) {
  const cut = (s) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 46 ? `${s.slice(0, 46)}…` : s; };
  const n = (a, one, few, many) => { const k = (a || []).length; const d = k % 10, h = k % 100; return `${k} ${d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many}`; };
  switch (b.type) {
    case 'text': return cut(txAny(b.title) || txAny(b.text));
    case 'say': return cut(txAny(b.say) || 'текст не задан');
    case 'image': return cut(txAny(b.caption) || txAny(b.alt) || fileName(b.src) || 'картинка не выбрана');
    case 'gallery': return cut(txAny(b.title)) || n(b.items, 'картинка', 'картинки', 'картинок');
    case 'idea': case 'split': case 'links': return cut(txAny(b.title) || txAny(b.text));
    case 'metrics': return cut((b.items || []).map((m) => txAny(m.v)).filter(Boolean).join(', '));
    case 'quote': return cut(txAny(b.author) || txAny(b.text));
    case 'steps': return cut(txAny(b.title)) || n(b.items, 'шаг', 'шага', 'шагов');
    case 'compare': return cut(txAny(b.title) || txAny(b.caption));
    case 'video': return cut(txAny(b.caption) || fileName(b.src) || 'файл не выбран');
    case 'palette': return cut(txAny(b.title)) || n(b.colors, 'цвет', 'цвета', 'цветов');
    default: return '';
  }
}

// ---------- проверка перед публикацией ----------
function allImages(p) {
  const out = [...(p.artifacts || [])];
  for (const b of p.blocks || []) {
    if (b.type === 'image' && b.src) out.push(b);
    if (b.type === 'gallery') out.push(...(b.items || []));
    if (b.type === 'compare') { if (b.before && b.before.src) out.push(b.before); if (b.after && b.after.src) out.push(b.after); }
  }
  return out;
}
function checks(p) {
  const out = [];
  const add = (ok, text, tab) => out.push({ ok: !!ok, text, tab });
  add(txAny(p.title).trim(), 'Название', 'main');
  add(txAny(p.summary).trim(), 'Короткое описание под заголовком', 'main');
  add(p.cover, 'Обложка', 'look');
  add(p.sticker, 'Наклейка на папке', 'look');
  const c = p.theme && p.theme.color, tone = (p.theme && p.theme.tone) || toneInfo(c).tone, k = contrastOf(c, tone);
  add(c && k >= LC_HEAD, c ? `Текст на фоне проекта читается: контраст Lc ${Math.round(k)}` : 'Цвет фона проекта', 'look');
  add((p.artifacts || []).length, 'Работы, которые выглядывают из папки', 'look');
  add((p.metrics || []).some((m) => txAny(m.v).trim()), 'Результаты в цифрах', 'results');
  add(['task', 'did', 'result'].every((x) => txAny((p.tldr || {})[x]).trim()), 'Задача, решение и результат', 'results');
  const noAlt = allImages(p).filter((x) => !txAny(x.alt).trim()).length;
  add(!noAlt, noAlt ? `Описания картинок: не хватает ${noAlt}` : 'Описания у всех картинок', 'blocks');
  return out;
}
function checksHTML(p) {
  const list = checks(p), todo = list.filter((c) => !c.ok).length;
  return `<h2>${todo ? `До готового кейса осталось: ${todo}` : 'Кейс готов к публикации'}</h2>
    <ul>${list.map((c) => `<li class="${c.ok ? '' : 'is-todo'}">${c.ok ? esc(c.text) : `<button type="button" data-act="tab" data-tab="${c.tab}">${esc(c.text)}</button>`}</li>`).join('')}</ul>`;
}
function contrastHTML(p) {
  const c = p.theme && p.theme.color;
  if (!/^#[0-9a-f]{6}$/i.test(c || '')) return { cls: '', html: 'Задайте цвет — в него окрасится фон каталога при наведении и шапка кейса.' };
  // правило контраста — в js/theme.js: светлый текст, если он набирает Lc 45 и читается не хуже тёмного (с форой 5)
  const info = toneInfo(c), tone = p.theme.tone || info.tone, k = Math.round(contrastOf(c, tone)), word = tone === 'dark' ? 'Белый' : 'Чёрный';
  const sw = `<i class="swatch" style="background:${esc(c)}"></i>`;
  const why = p.theme.tone ? '' : ` Подобран по правилу: у белого Lc ${Math.round(info.light)}, у чёрного Lc ${Math.round(info.dark)}${info.tone === 'dark' && info.light < info.dark ? ' — у белого фора: на насыщенном цвете чёрный выглядит грязно' : ''}.`;
  if (k >= LC_TEXT) return { cls: 'is-ok', html: `${sw}${word} текст читается хорошо: контраст Lc ${k}.${why}` };
  if (k >= LC_HEAD) return { cls: 'is-ok', html: `${sw}${word} текст: контраст Lc ${k} — хватает для заголовков, описание под ними будет без прозрачности.${why}` };
  return { cls: 'is-bad', html: `${sw}${word} текст читается плохо: контраст Lc ${k}, нужно от ${LC_HEAD}. ${p.theme.tone ? 'Поставьте «Подобрать по цвету» или возьмите' : 'Возьмите'} цвет ${tone === 'dark' ? 'темнее' : 'светлее'}.` };
}

// ---------- отрисовка ----------
const onSite = () => st.src === 'github' && gh.on;         // содержимое открыто с сайта и публикуется туда же
function renderBar() {
  // куда уходят правки — одной строкой; подключить или отключить сайт и папку — в «Настройках» (клик по строке ведёт туда)
  const where = st.dir ? `Папка «${st.dir.name}»${gh.on ? ` · сайт ${gh.name}` : ''}` : gh.on ? `Сайт ${gh.name}` : 'Без папки — изменения скачиваются архивом';
  const fb = $('[data-folder]');
  fb.textContent = where;
  fb.classList.toggle('is-warn', !st.dir && !gh.on);
  const langs = (st.site.languages || []).filter((l) => l === 'ru' || l === 'en');
  $('[data-langs]').innerHTML = langs.length > 1 ? langs.map((l) => `<button type="button" data-act="lang" data-lang="${l}" aria-pressed="${l === st.lang}">${l === 'ru' ? 'Русский' : 'English'}</button>`).join('') : '';
  $('[data-langs]').hidden = langs.length < 2;
  const save = $('[data-act="save"]'), pub = $('[data-act="publish"]');
  save.textContent = st.dir ? 'Сохранить' : 'Скачать изменения';
  save.hidden = onSite();                                  // с сайта сохраняют одной кнопкой — «Опубликовать»
  save.className = gh.on ? 'btn btn--line' : 'btn';
  pub.hidden = !gh.on;
  // «Открыть сайт»: с подключённым сайтом — настоящий сайт в интернете, иначе — копия рядом с админкой
  const live = gh.on ? gh.siteUrl : '';
  $('[data-open-site]').href = live && new URL(live).hostname !== location.hostname ? live : '../';
  updateStatus();
}
function updateStatus() {
  const d = dirty(), el = $('[data-status]'), both = !!st.dir && gh.on;
  let text;
  if (st.pubNote) text = st.pubNote;
  else if (d) text = onSite() ? 'Есть неопубликованные изменения' : 'Есть несохранённые изменения';
  else if (both && st.unpub) text = st.savedAt ? `Сохранено в ${st.savedAt}, на сайт не отправлено` : 'На сайте другая версия';
  else if (st.pubAt) text = st.pubAt;
  else text = st.savedAt ? `Сохранено в ${st.savedAt}` : 'Изменений нет';
  el.textContent = text;
  el.classList.toggle('is-dirty', !st.pubNote && (d || (both && st.unpub)));
  $('[data-act="save"]').disabled = !d || st.busy;
  // с папкой кнопка публикации доступна всегда: в папке могло накопиться то, чего нет на сайте
  $('[data-act="publish"]').disabled = st.busy || (!st.dir && !d);
}
function renderNav() {
  $('[data-nav]').innerHTML = NAV.map((n) => `<button class="rail-it${st.page === n.id ? ' is-cur' : ''}" type="button" data-act="page" data-page="${n.id}" title="${esc(n.hint)}"${st.page === n.id ? ' aria-current="page"' : ''}>${n.ico}<span>${esc(n.name)}</span></button>`).join('');
}
function renderSide() {
  renderNav();
  const side = $('[data-side]');
  if (st.page !== 'cases') { side.innerHTML = ''; return; }
  side.innerHTML = `
    <div class="side-head"><h2>Кейсы <span class="side-n">${st.projects.length}</span></h2><button class="btn btn--sm" type="button" data-act="new">Новый</button></div>
    <ol class="plist">${st.projects.map((p, i) => `
      <li class="pitem${i === st.idx ? ' is-cur' : ''}${p.published === false ? ' is-draft' : ''}" data-i="${i}" draggable="true">
        <button class="pitem-main" type="button" data-act="open" data-i="${i}"${i === st.idx ? ' aria-current="true"' : ''}>
          <span class="pitem-thumb">${p.sticker ? `<img data-src="${esc(p.sticker)}" alt="">` : ''}</span>
          <span class="pitem-text"><span class="pitem-title">${esc(txAny(p.title) || 'Без названия')}</span>
            <span class="pitem-meta">${esc(secName(p.section))}${p.year ? `, ${esc(p.year)}` : ''}${p.published === false ? ' — черновик' : ''}${st.likes && p.slug in st.likes ? ` · <span class="pitem-likes" title="Лайков на сайте">♥ ${st.likes[p.slug]}</span>` : ''}</span></span>
        </button>
        <span class="pitem-move"><button class="ico" type="button" data-act="up" data-i="${i}" aria-label="Поднять в списке"${i ? '' : ' disabled'}>${I.up}</button>
          <button class="ico" type="button" data-act="down" data-i="${i}" aria-label="Опустить в списке"${i < st.projects.length - 1 ? '' : ' disabled'}>${I.down}</button></span>
      </li>`).join('')}</ol>
    <p class="side-note hint">Порядок здесь — порядок в каталоге. Перетащите кейс или наведите на него и нажмите стрелку.</p>`;
  hydrate(side);
}
const PANES = {
  main: (p) => `
    ${F('Название', 'title', { l: 1, ph: 'Онбординг в банке за 3 минуты' })}
    <div class="grid2">${F('Раздел', 'section', { type: 'select', options: (st.site.sections || []).map((s) => [s.id, txAny(s.label)]) })}${F('Год', 'year', { type: 'number', kind: 'num' })}</div>
    ${F('Коротко о проекте', 'summary', { l: 1, type: 'area', rows: 2, hint: 'Одна-две фразы: видны в каталоге под названием (на телефоне — до трёх строк).' })}
    ${F('Слоган в обложке кейса', 'tagline', { l: 1, ph: 'Детский банкинг как модель финансового взросления', hint: 'Под логотипом проекта в цветной обложке кейса. Пусто — берётся «Коротко о проекте».' })}
    <div class="grid2">${F('Роль', 'role', { l: 1, ph: 'Lead Product Designer' })}${F('Клиент', 'client', { l: 1, ph: 'Финтех, B2C' })}</div>
    <div class="grid2">${F('Команда', 'team', { l: 1, ph: '2 дизайнера, 6 разработчиков' })}${F('Срок', 'duration', { l: 1, ph: '4 месяца' })}</div>
    ${IMG('Логотип клиента', 'clientLogo', { small: 1, max: 600, hint: 'Необязательно. В карточке фактов вместо названия клиента — PNG или SVG на прозрачном фоне, светлый на тёмном цвете проекта.' })}
    ${F('Теги', 'tags', { kind: 'list', l: 1, hint: 'Через запятую.' })}
    ${F('Адрес страницы', 'slug', { kind: 'slug', attrs: 'spellcheck="false"', hint: 'Латиницей. Кейс открывается по адресу …/#/work/адрес. Если поменять его после публикации, старые ссылки перестанут работать.' })}`,
  look: (p) => {
    const c = contrastHTML(p);
    const kind = (p.bg && p.bg.kind) || 'color';
    return `
    <fieldset class="fs"><legend>Логотип проекта</legend>
      <p class="hint">Надпись-логотип проекта картинкой (PNG или SVG на прозрачном фоне, как «СВОИ ДЕНЬГИ» в макете). Стоит в цветной обложке кейса и на телефоне в каталоге вместо названия. Пусто — там будет название текстом.</p>
      ${IMG('Логотип проекта', 'logo', { max: 1600 })}
    </fieldset>
    <fieldset class="fs"><legend>Карточка в каталоге</legend>
      <p class="hint">Карточка в ленте внизу каталога. Картинка или короткое видео без звука. Видео — как анимации на сайте Apple: проигрывается один раз, когда карточка впервые выехала на экран, и замирает на последнем кадре; выбрали проект — снова с начала. До запуска видна картинка карточки. Нет ни того ни другого — берётся малая копия обложки. На телефоне карточек нет: там проект на весь экран, внизу точки.</p>
      ${IMG('Картинка карточки', 'card.image', { max: 1400, hint: 'Горизонтальная, как карточка в макете: 364×287 (около 5:4), экспорт @2x — 728×574. Главное — по центру.' })}
      ${IMG('Видео карточки', 'card.video', { kind: 'video', hint: 'MP4 или WebM без звука, 3–8 секунд, до 3 МБ. Последний кадр должен быть хорош сам по себе — на нём ролик останавливается.' })}
      ${IMG('Что выглядывает за край карточки', 'card.over', { max: 1400, hint: 'Необязательно. PNG или WebP с прозрачным фоном той же ширины, что картинка карточки, совмещённый с ней сверху; может быть выше неё — тогда свисает за нижний край (как лапы свиньи у «Своих денег»).' })}
      ${COLOR('Свечение выбранной карточки', 'glow', { optional: 1, hint: 'Пусто — светлое на тёмном фоне, синее (#5B7FFF) на светлом, как в дизайн-системе.' })}
    </fieldset>
    <fieldset class="fs"><legend>Фон в каталоге</legend>
      <p class="hint">Весь экран каталога, пока выбран этот проект.</p>
      ${F('Фон', 'bg.kind', { type: 'select', kind: 'opt', options: [['', 'Цвет'], ['image', 'Картинка'], ['video', 'Видео']] })}
      <div class="grid2">${COLOR('Цвет фона', 'theme.color')}${F('Текст на фоне', 'theme.tone', { type: 'select', kind: 'opt', options: [['', 'Подобрать по цвету'], ['dark', 'Белый'], ['light', 'Чёрный']] })}</div>
      <p class="contrast ${c.cls}" data-contrast>${c.html}</p>
      ${kind === 'image' || kind === 'video' ? IMG('Картинка фона', 'bg.image', { max: 2400, hint: kind === 'video' ? 'Кадр, который виден, пока видео грузится.' : 'Во весь экран, лучше 16:9, от 1920 px.' }) : ''}
      ${kind === 'video' ? IMG('Видео фона', 'bg.video', { kind: 'video', hint: 'MP4 или WebM без звука, 5–15 секунд, до 6 МБ. Играет один раз и замирает на последнем кадре; пока грузится — цвет фона и картинка выше.' }) : ''}
      ${kind !== 'color' ? '<p class="hint">Цвет фона всё равно задайте: по нему выбирается цвет текста, им же закрашен экран, пока картинка или видео грузятся.</p>' : ''}
    </fieldset>
    <fieldset class="fs"><legend>Визуал на фоне</legend>
      <p class="hint">Картинка (лучше PNG без фона) или короткое видео поверх фона каталога. Расставьте его прямо в предпросмотре: вид «Каталог», визуал тянется мышью, колёсико — размер. Для широких экранов и для телефона место своё — переключите устройство над предпросмотром. Пунктиром там обведён текст проекта: на него визуал лучше не заводить. На телефоне визуал сам вписывается в просвет между логотипом и текстом — на низком экране он станет меньше, но на текст не наедет. Пусто — берётся первая работа проекта без фона.</p>
      ${IMG('Картинка', 'hero.image', { max: 1800 })}
      ${IMG('Видео', 'hero.video', { kind: 'video', hint: 'MP4 или WebM без звука, до 4 МБ. Играет один раз и замирает на последнем кадре; до запуска — картинка выше.' })}
      ${HEROPOS('desk', 'Компьютер и планшет горизонтально')}
      ${HEROPOS('phone', 'Телефон и планшет вертикально')}
    </fieldset>
    ${IMG('Визуал обложки кейса', 'caseVisual', { max: 1800, hint: 'Справа в цветной обложке кейса, может выходить за её край (как свинка в макете). PNG без фона или короткое видео. Пусто — берётся визуал из каталога.' })}
    ${IMG('Обложка', 'cover', { thumb: 'thumb', hint: 'Запасная картинка проекта, лучше 4:3: её малая копия — карточка в каталоге, если своей нет; она же — визуал кейса, если не задан другой.' })}
    ${IMG('Наклейка на папке', 'sticker', { small: 1, max: 480, hint: 'Знак или иконка проекта на прозрачном фоне: PNG или SVG.' })}
    ${COLOR('Цвет папки', 'folder', { optional: 1, hint: 'Пусто — нейтральное матовое стекло.' })}
    <fieldset class="fs"><legend>Работы проекта</legend>
      <p class="hint">Разлетаются по главной при наведении на раздел и выглядывают из папки. По центру папки встаёт первая картинка с фоном, за ней — обложка.</p>
      ${IMGLIST('artifacts', { cut: 1, dims: 1, max: 900 })}
    </fieldset>`;
  },
  results: () => `
    <fieldset class="fs"><legend>Результаты в цифрах</legend>
      <p class="hint">Первое, что видят на белом листе кейса. Лучше три цифры: что выросло, что упало, сколько заняло.</p>
      ${PAIRS('metrics', 'metric')}
    </fieldset>
    <fieldset class="fs"><legend>Суть в трёх абзацах</legend>
      <p class="hint">Для тех, кто читает по диагонали: по одной-две фразы.</p>
      ${F('Задача', 'tldr.task', { l: 1, type: 'area', rows: 2 })}${F('Что сделал', 'tldr.did', { l: 1, type: 'area', rows: 2 })}${F('Результат', 'tldr.result', { l: 1, type: 'area', rows: 2 })}
    </fieldset>`,
  blocks: (p) => `
    <ol class="blks">${(p.blocks || []).map((b, i, a) => {
    const def = BLOCKS[b.type] || { name: b.type }, open = st.open.has(i);
    return `<li class="blk${open ? ' is-open' : ''}" data-i="${i}">
        <div class="blk-head">
          <span class="blk-grip" draggable="true" title="Перетащите, чтобы поменять порядок">${I.grip}</span>
          <button class="blk-toggle" type="button" data-act="blk-toggle" data-i="${i}" aria-expanded="${open}"><span class="blk-type">${esc(def.name)}</span><span class="blk-sum">${esc(summaryOf(b))}</span></button>
          <span class="blk-tools"><button class="ico" type="button" data-act="blk-up" data-i="${i}" aria-label="Поднять блок"${i ? '' : ' disabled'}>${I.up}</button>
            <button class="ico" type="button" data-act="blk-down" data-i="${i}" aria-label="Опустить блок"${i < a.length - 1 ? '' : ' disabled'}>${I.down}</button>
            <button class="ico" type="button" data-act="blk-dup" data-i="${i}" aria-label="Дублировать блок">${I.dup}</button>
            <button class="ico" type="button" data-act="blk-del" data-i="${i}" aria-label="Удалить блок">${I.x}</button></span>
        </div>
        ${open && BF[b.type] ? `<div class="blk-body">${BF[b.type](b, `blocks.${i}`)}</div>` : ''}
      </li>`;
  }).join('')}</ol>
    <div class="add">
      <button class="btn" type="button" data-act="menu" aria-expanded="${st.menu}">Добавить блок</button>
      ${st.menu ? `<ul class="add-menu">${Object.entries(BLOCKS).map(([k, d]) => `<li><button type="button" data-act="blk-add" data-type="${k}">${esc(d.name)}<span>${esc(d.hint)}</span></button></li>`).join('')}</ul>` : ''}
    </div>`,
};
// Секция страницы: заголовок, пояснение одной-двумя строками и поля
const SEC = (title, body, hint = '') => `<section class="sec"><h2 class="sec-h">${esc(title)}</h2>${hint ? `<p class="hint sec-hint">${hint}</p>` : ''}${body}</section>`;
function profilePane() {
  const s = st.site, en = (s.languages || []).includes('en');
  return SEC('Кто вы', `
      <div class="grid2">${F('Имя', 'name', { l: 1 })}${F('Имя в родительном падеже', 'nameGen', { l: 1, hint: 'Для реплики «Привет! Я голова …».' })}</div>
      ${F('Роль', 'role', { l: 1, ph: 'продуктовый дизайнер' })}
      ${F('Описание для поисковиков', 'description', { l: 1, type: 'area', rows: 2 })}
      ${IMG('Логотип', 'logo', { kind: 'logo', hint: 'SVG или PNG с прозрачным фоном.' })}`)
    + SEC('Контакты и резюме', `
      <div class="grid2">${F('Почта для связи', 'email', { ph: 'hello@example.com', attrs: 'spellcheck="false"' })}${F('Telegram', 'telegram', { ph: '@username', attrs: 'spellcheck="false"' })}</div>
      ${IMG('Резюме, PDF', 'cv', { kind: 'file', l: 1, fixed: st.lang === defLang() ? 'assets/cv.pdf' : `assets/cv-${st.lang}.pdf`, hint: 'Пока файла нет, кнопка CV на сайте скрыта.' })}
      ${F('Имя файла при скачивании', 'cvFileName', { ph: 'Pavel-Nemchenko-CV.pdf', attrs: 'spellcheck="false"' })}`, 'Почта и Telegram — в конце каждого кейса. Пустые поля на сайте не появляются.')
    + SEC('Языки', `<div class="f"><label class="switch"><input type="checkbox" data-toggle="en"${en ? ' checked' : ''}><span>Английская версия сайта</span></label>
        <small class="hint">Посетитель увидит переключатель RU / EN. После включения вверху появится выбор языка: переведите тексты — поля без перевода покажутся по-русски.</small></div>`);
}
function sectionsPane() {
  const s = st.site, used = (id) => st.projects.some((p) => p.section === id);
  return SEC('Папки на главной', F('Где показывать', 'heroFolders', { type: 'select', kind: 'opt', options: [['', 'На компьютере — да, на телефоне — нет'], ['all', 'Везде: на телефоне — лентой над кнопками'], ['none', 'Нигде'] ],
        hint: 'Без папок главный экран чище; в разделы посетитель попадает через «Все работы». Папки можно расставить мышью прямо в предпросмотре — положение запомнится.' }))
    + SEC('Разделы каталога', `<ol class="cards">${(s.sections || []).map((sec, i) => `<li class="card">
        <div class="card-h"><b>${esc(txAny(sec.label) || 'Раздел')}</b><span class="hint">${st.projects.filter((p) => p.section === sec.id).length} в разделе</span></div>
        ${F('Название', `sections.${i}.label`, { l: 1 })}
        <div class="grid2">${RANGE('Наклон папки', `sections.${i}.tilt`, -20, 20, 1, '°')}${COLOR('Цвет папки', `sections.${i}.folder`, { optional: 1 })}</div>
        ${used(sec.id) ? '<p class="hint">В разделе есть кейсы — удалить его нельзя.</p>' : `<div class="f"><button class="btn btn--line btn--sm" type="button" data-act="sec-del" data-i="${i}">Удалить раздел</button></div>`}
      </li>`).join('')}</ol>
      <div class="f"><button class="btn btn--line btn--sm" type="button" data-act="sec-add">Добавить раздел</button></div>`);
}
function funPane() {
  return SEC('Плевки', F('Через сколько минут бездействия', 'spitAfter', { type: 'number', kind: 'num', ph: '10', attrs: 'min="0" step="0.1" inputmode="decimal"', hint: '0 — выключить. Плевки идут неторопливо, примерно раз в минуту. В предпросмотре головы нет: смотрите на сайте с ?spit=5 в адресе (начнёт через 5 секунд).' }),
      'Если посетитель долго ничего не делает, голова заплёвывает экран. Любое его действие всё стирает.')
    + SEC('Звук', CHECK('Показывать кнопку «Звук»', 'soundOn'), 'Кнопка в шапке включает голос головы — записанные реплики. По макету её пока нет: голова говорит субтитрами.');
}
function settingsPane() {
  const s = st.site, api = polaroidsApi(s);
  const site = gh.on
    ? `<div class="kv"><span>Сайт</span><b>${esc(gh.name)}</b><button class="btn btn--line btn--sm" type="button" data-act="gh-off">Отключить</button></div>`
    : gh.secure ? `<div class="kv"><span>Сайт</span><b class="hint">не подключён</b><button class="btn btn--sm" type="button" data-act="gh-open">Подключить</button></div>` : '';
  const dir = st.dir
    ? `<div class="kv"><span>Папка</span><b>${esc(st.dir.name)}</b><button class="btn btn--line btn--sm" type="button" data-act="pick-dir">Сменить</button></div>`
    : HAS_FS ? `<div class="kv"><span>Папка</span><b class="hint">не выбрана</b><button class="btn btn--line btn--sm" type="button" data-act="pick-dir">Выбрать</button></div>` : '';
  return SEC('Подключение', `<div class="kvs">${site}${dir}</div>`, gh.on ? 'Правки уходят на сайт кнопкой «Опубликовать» — через минуту-две они видны всем.' : 'Подключите сайт — правки будут публиковаться прямо отсюда. Без сайта и папки изменения скачиваются архивом.')
    + SEC('Архив полароидов и статистика', F('Адрес функции', 'polaroidsApi', { ph: 'https://functions.yandexcloud.net/…', attrs: 'spellcheck="false" inputmode="url"' })
      + `<label class="f"><span>Ключ модератора</span><input type="password" class="inp" data-modkey value="${esc(modKey())}" autocomplete="off" spellcheck="false"><small class="hint">Тот же, что в переменной MOD_KEY функции. Нужен для модерации полароидов и статистики. Хранится только в этом браузере.</small></label>`,
      `Одна облачная функция хранит карточки полароидов и считает посещения (server/polaroids/README.md в репозитории).${api ? '' : ' Пока адреса нет, карточку видит только её автор, а статистика не собирается.'}`)
    + SEC('Лайки', CHECK('Показывать лайки на сайте', 'likesOn')
      + F('Адрес счётчика', 'likesApi', { ph: 'https://functions.yandexcloud.net/…', attrs: 'spellcheck="false" inputmode="url"' })
      + `<div class="row">${likesApi(s) ? '<button class="btn btn--line btn--sm" type="button" data-act="likes-refresh">Обновить числа</button>' : ''}<span class="hint" data-likes-note>${esc(st.likesNote || '')}</span></div>`,
      'Сердечко на карточке кейса видит только сам посетитель; сколько лайков у кейса — видно в списке кейсов (server/likes/README.md).')
    + SEC('Пароль админки', `<div class="row">
        <button class="btn btn--line btn--sm" type="button" data-act="pass-set">${s.adminLock ? 'Сменить пароль' : 'Задать пароль'}</button>
        ${s.adminLock ? '<button class="btn btn--line btn--sm" type="button" data-act="pass-off">Убрать пароль</button>' : ''}</div>`,
      s.adminLock ? 'Пароль задан: без него админка не открывается.' : 'Пароля нет: админку откроет любой, кто знает адрес. Изменить сайт без токена GitHub он всё равно не сможет.')
    + SEC('Заметки для себя', `${IDEAS.length ? `<ul class="ideas">${IDEAS.map((it) => `<li><b>${esc(it.title)}</b> <span class="hint">— ${esc(it.status)}</span><br><span>${esc(it.text)}</span>${it.key ? CHECK('Включить на сайте', it.key) : ''}</li>`).join('')}</ul>` : ''}
      ${F('Банк идей', 'ideaNotes', { type: 'area', rows: 4, hint: 'На сайт не выводится.' })}`);
}
// ---------- полароид: наклейки и модерация архива ----------
// Наклейки — в настройках сайта (site.polaroid.stickers): название, эмодзи и своя картинка, которая заменяет эмодзи.
// Модерация — запросы к функции архива с ключом модератора. Ключ живёт только в этом браузере (localStorage) и в
// содержимое сайта не попадает: на сайте его не увидит никто.
const MODKEY = 'ph:modkey';
const modKey = () => { try { return localStorage.getItem(MODKEY) || ''; } catch (_) { return ''; } };
st.pol = { items: [], next: '', note: '', busy: false, urls: new Map() };
function stickerPrev(stk) {
  const src = stk.image || (stk.emoji ? dieCut(stk.emoji, 120) : '');
  return src ? `<img data-src="${esc(src)}" alt="">` : '<span class="hint">пусто</span>';
}
function polaroidPane() {
  const s = st.site, api = polaroidsApi(s), key = modKey();
  if (subOf('pol') === 'stickers') {
    return `<p class="hint sec-hint">Десять наклеек по бокам карточки. Без своей картинки наклейка — эмодзи системы (на iPhone и Mac — Apple, на Android и Windows — свои). Своя картинка — PNG или WebP с прозрачным фоном, квадратная, от 240 пикселей — заменяет эмодзи везде, и на сохранённых карточках тоже.</p>
      <ol class="stk-list">${(s.polaroid.stickers || []).map((stk, i) => `<li class="stk-row">
        <span class="stk-prev" aria-hidden="true">${stickerPrev(stk)}</span>
        <div class="stk-fields"><div class="grid2">${F('Название', `polaroid.stickers.${i}.name`, { l: 1 })}${F('Эмодзи', `polaroid.stickers.${i}.emoji`, { attrs: 'maxlength="16" spellcheck="false" autocomplete="off"' })}</div>
          ${IMG('Своя картинка', `polaroid.stickers.${i}.image`, { small: 1, max: 480, folder: 'assets/polaroid/stickers', hint: 'необязательно' })}</div>
      </li>`).join('')}</ol>`;
  }
  if (!api) return `<div class="empty"><p>Архив не подключён: без него карточку видит только её автор.</p><button class="btn btn--sm" type="button" data-act="page" data-page="settings">Вписать адрес функции</button></div>`;
  const bad = /ключ/i.test(st.pol.note) && !st.pol.items.length;
  const keyRow = !key || bad ? `<div class="keyrow"><label class="f"><span>Ключ модератора</span><input type="password" class="inp" data-modkey value="${esc(key)}" autocomplete="off" spellcheck="false"></label><button class="btn btn--sm" type="button" data-act="pol-load">Показать карточки</button>
      <span class="${bad ? 'error' : 'hint'}">${bad ? esc(st.pol.note) : 'Тот же, что в MOD_KEY функции; запомнится в этом браузере.'}</span></div>` : '';
  return `${keyRow}${key && !bad ? `<div class="toolbar"><button class="btn btn--line btn--sm" type="button" data-act="pol-load"${st.pol.busy ? ' disabled' : ''}>${st.pol.busy ? 'Загружаю…' : 'Обновить'}</button><span class="hint" data-pol-note>${esc(st.pol.note)}</span></div>` : ''}
    <ul class="pol-mod" data-pol-list>${polItemsHTML()}</ul>
    ${st.pol.next ? '<div class="f"><button class="btn btn--line btn--sm" type="button" data-act="pol-more">Показать ещё</button></div>' : ''}
    <p class="hint sec-hint">Новые карточки появляются в архиве сразу; с матом в подписи архив скрывает сам — такую можно вернуть. «Скрыть» обратимо, «Удалить» — насовсем.</p>`;
}
const polDate = (ms) => { try { return new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
function polItemsHTML() {
  return st.pol.items.map((it) => `<li class="pol-mod-it${it.h ? ' is-hidden' : ''}" data-pid="${esc(it.id)}">
      <span class="pol-mod-img">${st.pol.urls.get(it.id) ? `<img src="${esc(st.pol.urls.get(it.id))}" alt="">` : ''}</span>
      <span class="pol-mod-txt"><b>${it.c ? esc(it.c) : '<i>без подписи</i>'}</b>
        <span class="hint">${esc(polDate(it.t))} · наклеек: ${(it.s || []).length}${it.h ? ' · скрыта' : ''}${it.f ? ' · скрыта проверкой на мат' : ''}</span></span>
      <span class="row"><button class="btn btn--line btn--sm" type="button" data-act="${it.h ? 'pol-show' : 'pol-hide'}" data-pid="${esc(it.id)}">${it.h ? 'Показать' : 'Скрыть'}</button>
        <button class="btn btn--line btn--sm" type="button" data-act="pol-del" data-pid="${esc(it.id)}">Удалить</button></span>
    </li>`).join('');
}
function polRedraw() {
  const box = $('[data-pol-pane]');
  if (!box) return;
  const keep = $('[data-edit]').scrollTop;
  box.innerHTML = polaroidPane();
  hydrate(box);
  $('[data-edit]').scrollTop = keep;
}
async function polLoad(more = false) {
  const api = polaroidsApi(st.site), key = modKey();
  if (!api) return;
  if (!key) { st.pol.note = 'Вставьте ключ модератора.'; polRedraw(); return; }
  if (st.pol.busy) return;
  st.pol.busy = true; st.pol.note = 'Загружаю…'; polRedraw();
  try {
    const page = await fetchList(api, { all: true, key, n: 24, before: more ? st.pol.next : '' });
    if (!more) st.pol.items = [];
    st.pol.items.push(...page.items);
    st.pol.next = page.next;
    const hidden = st.pol.items.filter((x) => x.h).length;
    st.pol.note = st.pol.items.length ? `Карточек: ${st.pol.items.length}${page.next ? '+' : ''}, скрытых: ${hidden}` : 'В архиве пока пусто.';
    // картинки — с ключом (у скрытых без него их не отдают)
    await Promise.all(page.items.map(async (it) => { if (!st.pol.urls.has(it.id)) { try { st.pol.urls.set(it.id, await modImage(api, key, it.id)); } catch (_) { /* без картинки */ } } }));
  } catch (e) {
    st.pol.note = e.status === 401 || e.status === 403 ? 'Ключ модератора не подошёл.' : 'Архив не ответил. Проверьте адрес и что функция публичная.';
  }
  st.pol.busy = false;
  polRedraw();
}
async function polModerate(id, act) {
  const api = polaroidsApi(st.site), key = modKey(), it = st.pol.items.find((x) => x.id === id);
  if (!api || !key || !it) return;
  try {
    if (act === 'del') {
      if (!window.confirm('Удалить карточку из архива совсем? Вернуть её будет нельзя. Скрыть — можно вернуть.')) return;
      await removePolaroid(api, key, id);
      st.pol.items = st.pol.items.filter((x) => x.id !== id);
      toast('Карточка удалена');
    } else {
      const res = await setHidden(api, key, id, act === 'hide');
      it.h = res && typeof res.h === 'number' ? res.h : (act === 'hide' ? 1 : 0);
      if (!it.h) it.f = 0;
      toast(it.h ? 'Карточка скрыта: в архиве её больше не видно' : 'Карточка снова в архиве');
    }
  } catch (e) { toast(e.status === 401 || e.status === 403 ? 'Ключ модератора не подошёл' : 'Архив не ответил — попробуйте ещё раз'); }
  polRedraw();
}

// ---------- статистика: дашборд ----------
// Свой счётчик без cookie: сайт шлёт события визитов в функцию архива полароидов (js/stats.js), отчёт — с ключом
// модератора. Дашборд: период сверху, ниже всё считается по нему — показатели с прошлым периодом, визиты по дням,
// воронка, отклики (?from=…), источники и устройства, кейсы, когда заходят, последние визиты и таблица по дням.
// Для сравнения грузим вдвое больше периода; «Всё время» — без сравнения, по дням или (если долго) по неделям.
// Админка помечает этот браузер как ваш — свои заходы на сайт не считаются.
const PERIODS = [[1, '24 часа'], [7, '7 дней'], [30, '30 дней'], [90, '90 дней'], [0, 'Всё время']];      // 0 — за всё время
const VS_PREV = { 1: 'с предыдущими 24 часами', 7: 'с предыдущими 7 днями', 30: 'с предыдущими 30 днями', 90: 'с предыдущими 90 днями' };
const want = (d) => (d ? d * 2 : 'all');                                        // сколько грузить: период и прошлый — для сравнения
const enough = (have, d) => have === 'all' || (d !== 0 && Number(have) >= d * 2);
st.stats = { days: 30, data: null, note: '', busy: false, co: '', me: true, more: 0, keyOpen: false, err: '' };
markOwner(true);
const coSlug = (v) => String(v || '').toLowerCase().replace(/[а-яё]/g, (c) => TR[c] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const siteUrl = () => { const h = location.hostname; return /^(localhost|127\.)/.test(h) ? 'https://pnemchenko.ru/' : `${location.origin}/`; };
const statsLink = () => { const c = coSlug(st.stats.co); return c ? `${siteUrl()}?from=${c}` : ''; };
const REF = [[/(^|\.)hh\.ru$|headhunter/, 'hh.ru'], [/^t\.me$|telegram/, 'Telegram'], [/linkedin|^lnkd\.in$/, 'LinkedIn'], [/instagram/, 'Instagram'], [/facebook/, 'Facebook'], [/(^|\.)google\./, 'Google'], [/yandex\.|^ya\.ru$/, 'Яндекс'], [/(^|\.)vk\.com$/, 'ВКонтакте'], [/behance/, 'Behance'], [/dribbble/, 'Dribbble'], [/habr/, 'Хабр'], [/github/, 'GitHub']];
const refName = (h) => { for (const [re, n] of REF) if (re.test(h)) return n; return h; };
const srcOf = (x) => (x.from ? `ссылка «${x.from}»` : x.ref ? refName(x.ref) : 'прямой заход');
const DEV = { phone: 'Телефон', tablet: 'Планшет', desktop: 'Компьютер' };
const WD = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const dur = (s) => { s = Math.round(s || 0); if (s < 60) return `${s} с`; const m = Math.floor(s / 60); return m < 60 ? `${m} мин${s % 60 && m < 10 ? ` ${s % 60} с` : ''}` : `${Math.floor(m / 60)} ч ${m % 60} мин`; };
const when = (ms) => { try { return new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
const dmy = (ms) => new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const caseName = (slug) => { const p = st.projects.find((x) => x.slug === slug); return p ? txAny(p.title) || slug : slug; };
const pl = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many; };
const VIS = (n) => pl(n, 'визит', 'визита', 'визитов');
const PPL = (n) => pl(n, 'человек', 'человека', 'человек');
const pctN = (n, all) => (all ? Math.round((n / all) * 100) : 0);
const num = (n) => Number(n || 0).toLocaleString('ru-RU');
const tip = (title, rows) => `data-tip="${esc(title)}" data-tip-rows="${esc(rows.map(([v, l]) => `${v}~${l}`).join('|'))}"`;
const vTime = (v) => v.act || Math.round((v.t1 - v.t0) / 1000);
const watched = (v) => Object.values(v.c || {}).some((s) => s >= 30);
const reached = (v) => v.cv || v.ct.length;
const median = (a) => { const s = a.filter((x) => x > 0).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Сводные числа одного периода
function summary(vs) {
  return {
    n: vs.length,
    people: new Set(vs.flatMap((v) => v.u.map((u) => `${dayKey(v.t0)}|${u}`))).size,
    cases: vs.filter((v) => v.open.length).length,
    watched: vs.filter(watched).length,
    cv: vs.filter((v) => v.cv).length,
    ct: vs.filter((v) => v.ct.length).length,
    reached: vs.filter(reached).length,
    time: median(vs.map(vTime)),
  };
}
// Корзины времени для графика: по часам за 24 часа, иначе по дням
function buckets(days, now) {
  const out = [];
  if (days > 120) {                                       // долгий период — по неделям, с понедельника
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
    for (let i = Math.ceil(days / 7) - 1; i >= 0; i--) { const s = new Date(d0); s.setDate(s.getDate() - i * 7); const e = new Date(s); e.setDate(e.getDate() + 7); out.push({ t: s.getTime(), end: e.getTime(), label: dmy(s.getTime()), week: 1 }); }
  } else if (days === 1) {
    const h0 = new Date(now); h0.setMinutes(0, 0, 0);
    for (let i = 23; i >= 0; i--) { const t = h0.getTime() - i * 36e5; out.push({ t, end: t + 36e5, label: `${String(new Date(t).getHours()).padStart(2, '0')}:00` }); }
  } else {
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) { const s = new Date(d0); s.setDate(s.getDate() - i); const e = new Date(s); e.setDate(e.getDate() + 1); out.push({ t: s.getTime(), end: e.getTime(), label: dmy(s.getTime()) }); }
  }
  return out;
}
const fill = (bs, vs) => bs.map((b) => { const list = vs.filter((v) => v.t0 >= b.t && v.t0 < b.end); return { ...b, n: list.length, s: summary(list) }; });

// ---- показатели ----
function deltaHTML(cur, prev, has, fmt = num) {
  if (!has) return '';
  const d = cur - prev;
  if (!prev && !cur) return '<span class="db-delta">как в прошлый период: 0</span>';
  const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  const mark = d > 0 ? '▲' : d < 0 ? '▼' : '=';
  const rel = prev ? ` · ${d > 0 ? '+' : ''}${Math.round((d / prev) * 100)}%` : '';
  return `<span class="db-delta is-${dir}"><span aria-hidden="true">${mark}</span> было ${esc(fmt(prev))}${rel}</span>`;
}
function spark(series) {
  if (series.length < 2) return '';
  const max = Math.max(1, ...series), n = series.length - 1;
  const pts = series.map((v, i) => `${((i / n) * 100).toFixed(2)},${(22 - (v / max) * 20).toFixed(2)}`);
  const last = series[series.length - 1] / max;
  return `<svg class="db-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" vector-effect="non-scaling-stroke"/></svg><i class="db-spark-dot" style="bottom:${(12 + ((2 + last * 20) / 24) * 20 - 4).toFixed(1)}px"></i>`;
}
function kpi(label, value, cur, prev, has, series, opts = {}) {
  return `<div class="db-kpi${opts.hero ? ' db-kpi--hero' : ''}">
    <span class="db-kpi-l">${esc(label)}</span>
    <b class="db-kpi-v">${esc(value)}</b>
    ${opts.sub ? `<span class="db-kpi-sub">${esc(opts.sub)}</span>` : ''}
    ${deltaHTML(cur, prev, has, opts.fmt)}
    ${spark(series)}
  </div>`;
}

// ---- визиты по времени: столбики этого периода, чёрточки — прошлого ----
function niceMax(m) { if (m <= 4) return 4; const p = 10 ** Math.floor(Math.log10(m)), f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
function trendHTML(cur, prev, has, days) {
  const top = niceMax(Math.max(1, ...cur.map((b) => b.n), ...(has ? prev.map((b) => b.n) : [])));
  const ticks = [0, top / 2, top];
  const every = Math.ceil(cur.length / 8);
  const unit = days === 1 ? 'час' : cur[0] && cur[0].week ? 'недел' : 'день';
  return `<div class="db-trend">
    <div class="db-legend"><span><i class="db-lk db-lk--bar"></i>этот период</span>${has ? '<span><i class="db-lk db-lk--tick"></i>прошлый период</span>' : ''}<span class="hint">по ${unit === 'недел' ? 'неделям' : `${unit}ам`}, наведите на столбик</span></div>
    <div class="db-plot">
      <div class="db-yaxis" aria-hidden="true">${ticks.slice().reverse().map((t) => `<span>${num(t)}</span>`).join('')}</div>
      <div class="db-area">
        ${ticks.map((t) => `<i class="db-grid" style="bottom:${(t / top) * 100}%"></i>`).join('')}
        <div class="db-cols">${cur.map((b, i) => {
    const p = has ? prev[i] : null;
    const rows = [[b.n, VIS(b.n)], [b.s.people, PPL(b.s.people)], [b.s.cases, 'открыли кейс'], [b.s.cv, 'скачали резюме'], [b.s.ct, 'нажали на контакт']];
    if (p) rows.push([p.n, `${VIS(p.n)} в прошлый период (${p.label})`]);
    return `<span class="db-col" tabindex="0" ${tip(days === 1 ? `${dmy(b.t)}, ${b.label}` : b.week ? `неделя с ${b.label}` : `${WD[(new Date(b.t).getDay() + 6) % 7]}, ${b.label}`, rows)}>
            <i class="db-bar" style="height:${(b.n / top) * 100}%"></i>${p ? `<i class="db-tick" style="bottom:${(p.n / top) * 100}%"></i>` : ''}</span>`;
  }).join('')}</div>
      </div>
    </div>
    <div class="db-xaxis" aria-hidden="true">${cur.map((b, i) => `<span>${(cur.length - 1 - i) % every === 0 ? esc(b.label) : ''}</span>`).join('')}</div>
  </div>`;
}

// ---- воронка ----
function funnelHTML(s) {
  const steps = [['Зашли на сайт', s.n], ['Открыли кейс', s.cases], ['Смотрели кейс дольше 30 с', s.watched], ['Скачали резюме или написали', s.reached]];
  return `<ol class="db-funnel">${steps.map(([l, n]) => `<li tabindex="0" ${tip(l, [[n, VIS(n)], [`${pctN(n, s.n)}%`, 'от всех визитов']])}>
      <span class="db-f-l">${esc(l)}</span><span class="db-f-track"><i style="width:${s.n ? (n / s.n) * 100 : 0}%"></i></span><b>${num(n)}</b><span class="db-f-p">${pctN(n, s.n)}%</span></li>`).join('')}</ol>`;
}

// ---- разбивки: откуда, устройство… ----
function tally(list, keyOf) {
  const m = new Map();
  for (const v of list) for (const k of [].concat(keyOf(v)).filter(Boolean)) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function barsHTML(title, rows, all, max = 6) {
  let shown = rows;
  if (rows.length > max) { const rest = rows.slice(max - 1).reduce((a, [, n]) => a + n, 0); shown = [...rows.slice(0, max - 1), ['другое', rest]]; }
  return `<section class="db-card"><h3>${esc(title)}</h3>${shown.length
    ? `<ul class="db-bars">${shown.map(([k, n]) => `<li tabindex="0" ${tip(k, [[n, VIS(n)], [`${pctN(n, all)}%`, 'от всех']])}><span class="db-b-l">${esc(k)}</span><b>${num(n)}</b><span class="db-b-p">${pctN(n, all)}%</span><span class="db-b-track"><i style="width:${all ? (n / all) * 100 : 0}%"></i></span></li>`).join('')}</ul>`
    : '<p class="hint">Пока нет данных.</p>'}</section>`;
}

// ---- когда заходят: дни недели × часы ----
function heatHTML(vs) {
  const g = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const v of vs) { const d = new Date(v.t0); g[(d.getDay() + 6) % 7][d.getHours()]++; }
  const max = Math.max(1, ...g.flat());
  const lvl = (n) => (n ? Math.min(4, Math.ceil((n / max) * 4)) : 0);
  return `<div class="db-heat" role="img" aria-label="Визиты по дням недели и часам">
    <span></span>${Array.from({ length: 24 }, (_, h) => `<span class="db-h-x">${h % 3 === 0 ? h : ''}</span>`).join('')}
    ${g.map((row, d) => `<span class="db-h-y">${WD[d]}</span>${row.map((n, h) => `<i class="db-cell l${lvl(n)}" tabindex="${n ? 0 : -1}" ${tip(`${WD[d]}, ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`, [[n, VIS(n)]])}></i>`).join('')}`).join('')}
  </div>
  <div class="db-heat-key hint">меньше <i class="db-cell l1"></i><i class="db-cell l2"></i><i class="db-cell l3"></i><i class="db-cell l4"></i> больше · время — ваше местное</div>`;
}

// ---- отклики: ссылки ?from= ----
function fromsHTML(vs) {
  const m = new Map();
  for (const v of vs) if (v.x.from) { const a = m.get(v.x.from) || []; a.push(v); m.set(v.x.from, a); }
  const rows = [...m.entries()].map(([f, list]) => ({ f, list, last: Math.max(...list.map((v) => v.t0)), first: Math.min(...list.map((v) => v.t0)) })).sort((a, b) => b.last - a.last);
  const ok = '<span class="db-yes">да</span>';
  return rows.length ? `<table class="db-table"><thead><tr><th>Ссылка</th><th>Визитов</th><th>Первый заход</th><th>Последний</th><th>Что смотрели</th><th>Резюме</th><th>Контакт</th></tr></thead><tbody>
    ${rows.map(({ f, list, first, last }) => {
    const opened = [...new Set(list.flatMap((v) => v.open))];
    return `<tr><td><b>${esc(f)}</b></td><td>${list.length}</td><td>${esc(when(first))}</td><td>${esc(when(last))}</td><td class="db-wrap">${opened.length ? esc(opened.map(caseName).join(', ')) : '<span class="hint">кейсы не открывали</span>'}</td><td>${list.some((v) => v.cv) ? ok : '—'}</td><td>${list.some((v) => v.ct.length) ? ok : '—'}</td></tr>`;
  }).join('')}</tbody></table>`
    : '<p class="hint">За этот период по ссылкам из откликов не заходили. Ссылку для отклика можно сделать прямо здесь, ниже.</p>';
}

// ---- кейсы ----
function casesHTML(vs) {
  const m = new Map();
  for (const v of vs) {
    for (const s of v.open) { const c = m.get(s) || { n: 0, sec: [], w: 0, lk: 0 }; c.n++; if (v.c[s]) c.sec.push(v.c[s]); if ((v.c[s] || 0) >= 30) c.w++; m.set(s, c); }
    for (const s of v.lk) { const c = m.get(s) || { n: 0, sec: [], w: 0, lk: 0 }; c.lk++; m.set(s, c); }
  }
  const rows = [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  const top = Math.max(1, ...rows.map(([, c]) => c.n));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return rows.length ? `<table class="db-table db-table--cases"><thead><tr><th>Кейс</th><th>Открыли</th><th>Доля визитов</th><th>Смотрят в среднем</th><th>Дольше 30 с</th><th>Лайки</th></tr></thead><tbody>
    ${rows.map(([s, c]) => `<tr><td>${esc(caseName(s))}</td><td><span class="db-inline"><i style="width:${(c.n / top) * 100}%"></i></span>${c.n}</td><td>${pctN(c.n, vs.length)}%</td><td>${c.sec.length ? esc(dur(avg(c.sec))) : '—'}</td><td>${c.w}</td><td>${c.lk || '—'}</td></tr>`).join('')}</tbody></table>`
    : '<p class="hint">Кейсы за этот период не открывали.</p>';
}

// ---- последние визиты ----
function visitHTML(v) {
  const tags = [v.x.from ? `ссылка «${v.x.from}»` : '', v.cv ? 'резюме' : '', v.ct.length ? `написал: ${v.ct.join(', ')}` : '', v.pol ? 'полароид' : ''].filter(Boolean);
  return `<li class="db-visit">
    <span class="db-v-when">${esc(when(v.t0))}</span>
    <span class="db-v-main"><b>${esc(v.x.from ? `ссылка «${v.x.from}»` : srcOf(v.x))}</b> · ${esc([DEV[v.x.dev], v.x.os, v.x.br].filter(Boolean).join(', ') || 'устройство неизвестно')}${v.x.scr ? ` · ${esc(v.x.scr)}` : ''}${v.x.tz ? ` · ${esc(v.x.tz.replace(/_/g, ' '))}` : ''}
      <span class="hint">${esc(dur(vTime(v)))} на сайте · ${v.open.length ? `кейсы: ${esc(v.open.map((s) => `${caseName(s)}${v.c[s] ? ` (${dur(v.c[s])})` : ''}`).join(', '))}` : 'кейсы не открывал'}${v.fun.includes('glasses') ? ' · снял очки' : ''}${v.fun.includes('spit') ? ' · дождался плевков' : ''}</span></span>
    <span class="db-v-tags">${tags.filter((t) => !t.startsWith('ссылка')).map((t) => `<span class="db-tag">${esc(t)}</span>`).join('')}</span>
  </li>`;
}

// ---- таблица по дням (то же, что на графике, — числами) ----
function dayTableHTML(cur, days) {
  const wk = cur[0] && cur[0].week;
  return `<details class="db-details"><summary>Таблица ${days === 1 ? 'по часам' : wk ? 'по неделям' : 'по дням'}</summary>
    <table class="db-table"><thead><tr><th>${days === 1 ? 'Час' : wk ? 'Неделя с' : 'День'}</th><th>Визиты</th><th>Люди</th><th>Открыли кейс</th><th>Резюме</th><th>Контакт</th></tr></thead><tbody>
    ${cur.slice().reverse().map((b) => `<tr><td>${esc(days === 1 ? `${dmy(b.t)}, ${b.label}` : b.label)}</td><td>${b.n}</td><td>${b.s.people}</td><td>${b.s.cases}</td><td>${b.s.cv}</td><td>${b.s.ct}</td></tr>`).join('')}
    </tbody></table></details>`;
}

function dashBody(d) {
  const S = st.stats, ever = S.days === 0, now = d.now || Date.now(), all = d.visits || [];
  // «всё время» — с дня первого визита (не меньше недели)
  const first = all.length ? Math.min(...all.map((v) => v.t0)) : now;
  const days = ever ? Math.max(7, Math.ceil((now - new Date(first).setHours(0, 0, 0, 0)) / 864e5)) : S.days, span = days * 864e5;
  const vs = ever ? all : all.filter((v) => v.t0 >= now - span);
  const has = !ever && enough(d.days, S.days);                // прошлый период целиком попал в выборку
  const pv = has ? all.filter((v) => v.t0 >= now - 2 * span && v.t0 < now - span) : [];
  const s = summary(vs), p = summary(pv);
  const cur = fill(buckets(days, now), vs), prev = has ? fill(buckets(days, now - span), pv) : [];
  const ser = (k) => cur.map((b) => (k === 'n' ? b.n : b.s[k]));
  const shown = vs.slice(0, 20 + S.more);
  return `
    <div class="db-kpis">
      ${kpi('Визиты', num(s.n), s.n, p.n, has, ser('n'), { hero: 1 })}
      ${kpi('Людей', num(s.people), s.people, p.people, has, ser('people'), { sub: 'разных за день' })}
      ${kpi('Открыли кейс', `${pctN(s.cases, s.n)}%`, s.cases, p.cases, has, ser('cases'), { sub: `${num(s.cases)} визитов` })}
      ${kpi('Скачали резюме', num(s.cv), s.cv, p.cv, has, ser('cv'))}
      ${kpi('Нажали на контакт', num(s.ct), s.ct, p.ct, has, ser('ct'))}
      ${kpi('Время на сайте', dur(s.time), s.time, p.time, has, [], { sub: 'медиана визита', fmt: dur })}
    </div>
    ${s.n ? '' : `<p class="db-empty">${ever ? 'Пока' : `За ${esc(PERIODS.find(([v]) => v === S.days)[1])}`} заходов не было — или функция ещё не получила ни одного события. Откройте сайт с телефона (не из этого браузера) и обновите через минуту.</p>`}
    <section class="db-card db-card--wide"><h3>Визиты${ever ? ` с ${esc(dmy(first))}` : ''}</h3>${trendHTML(cur, prev, has, days)}${dayTableHTML(cur, days)}</section>
    <div class="db-row">
      <section class="db-card"><h3>Воронка</h3>${funnelHTML(s)}<p class="hint">Доля — от всех визитов за период.</p></section>
      <section class="db-card"><h3>Когда заходят</h3>${heatHTML(vs)}</section>
    </div>
    <section class="db-card db-card--wide"><h3>Отклики — заходы по вашим ссылкам</h3>${fromsHTML(vs)}
      <div class="db-link"><label class="f st-co"><span>Ссылка для нового отклика: компания</span><input type="text" data-stats-co value="${esc(S.co)}" placeholder="Например, Яндекс" autocomplete="off"></label>
        <code class="st-link" data-stats-link>${esc(statsLink() || '—')}</code><button class="btn btn--sm" type="button" data-act="stats-copy">Скопировать</button></div>
    </section>
    <div class="db-grid4">
      ${barsHTML('Откуда', tally(vs, (v) => srcOf(v.x)), s.n)}
      ${barsHTML('Устройство', tally(vs, (v) => DEV[v.x.dev] || 'неизвестно'), s.n)}
      ${barsHTML('Система', tally(vs, (v) => v.x.os || 'неизвестно'), s.n)}
      ${barsHTML('Браузер', tally(vs, (v) => v.x.br || 'другой'), s.n)}
      ${barsHTML('Часовой пояс', tally(vs, (v) => (v.x.tz || 'неизвестно').replace(/_/g, ' ')), s.n)}
      ${barsHTML('Экран', tally(vs, (v) => v.x.scr || 'неизвестно'), s.n)}
    </div>
    <section class="db-card db-card--wide"><h3>Кейсы</h3>${casesHTML(vs)}</section>
    <section class="db-card db-card--wide"><h3>Последние визиты</h3>
      ${shown.length ? `<ul class="db-visits">${shown.map(visitHTML).join('')}</ul>` : '<p class="hint">Пока пусто.</p>'}
      ${vs.length > shown.length ? `<button class="btn btn--line btn--sm" type="button" data-act="stats-more">Показать ещё (${vs.length - shown.length})</button>` : ''}
    </section>`;
}
function statsPane() {
  const api = polaroidsApi(st.site), S = st.stats, key = modKey();
  if (!api) return '<div class="empty"><p>Счётчик работает через функцию архива полароидов — её адрес ещё не вписан.</p><button class="btn btn--sm" type="button" data-act="page" data-page="settings">Открыть настройки</button></div>';
  const keyField = `<label class="f db-key"><span>Ключ модератора</span><input type="password" data-modkey value="${esc(key)}" autocomplete="off" spellcheck="false"></label>`;
  return `<div class="db-filters" role="group" aria-label="Период">
      <div class="seg db-seg">${PERIODS.map(([v, l]) => `<button type="button" data-act="stats-days" data-days="${v}" aria-pressed="${S.days === v}">${esc(l)}</button>`).join('')}</div>
      <button class="btn btn--line btn--sm" type="button" data-act="stats-load"${S.busy ? ' disabled' : ''}>${S.busy ? 'Загружаю…' : 'Обновить'}</button>
      <span class="hint" data-stats-note>${esc([VS_PREV[S.days] ? `сравниваем ${VS_PREV[S.days]}` : '', S.note].filter(Boolean).join(' · '))}</span>
      <span class="db-filters-end">${key && !S.keyOpen && !S.err ? '<button class="linkish" type="button" data-act="stats-key">Ключ модератора</button>' : ''}</span>
    </div>
    ${!key || S.keyOpen || S.err ? `<div class="db-keyrow">${keyField}<button class="btn btn--sm" type="button" data-act="stats-load">Показать</button>${S.err ? `<span class="error">${esc(S.err)}</span>` : '<span class="hint">Тот же ключ, что в переменной MOD_KEY функции. Хранится только в этом браузере.</span>'}</div>` : ''}
    <div class="db-body${S.busy && S.data ? ' is-busy' : ''}" data-stats-body>${S.data ? dashBody(S.data) : (S.busy ? '<p class="hint">Загружаю…</p>' : '')}</div>
    <p class="hint db-me">${S.me ? 'Этот браузер помечен как ваш — ваши заходы на сайт с него не считаются.' : 'Этот браузер сейчас считается как обычный посетитель.'}
      <button class="linkish" type="button" data-act="stats-me">${S.me ? 'Считать и его' : 'Не считать мои заходы'}</button>
      Телефон: откройте один раз ${esc(siteUrl())}?me=1 — и его заходы тоже перестанут считаться. Cookie нет; IP и данные браузера не хранятся.</p>`;
}
function statsRedraw() {
  const box = $('[data-stats-pane]');
  if (!box) return;
  const keep = $('[data-edit]').scrollTop;
  box.innerHTML = statsPane();
  $('[data-edit]').scrollTop = keep;
}
async function statsLoad() {
  const api = polaroidsApi(st.site), key = modKey(), S = st.stats;
  if (!api) return;
  if (!key) { S.err = 'Вставьте ключ модератора.'; statsRedraw(); return; }
  if (S.busy) return;
  S.busy = true; S.err = ''; statsRedraw();
  try {
    const r = await fetch(`${api}?stats=1&days=${want(S.days)}`, { cache: 'no-store', mode: 'cors', credentials: 'omit', headers: { 'x-mod-key': key } });
    if (!r.ok) { const e = new Error(String(r.status)); e.status = r.status; throw e; }
    S.data = await r.json();
    S.keyOpen = false;
    S.note = `обновлено в ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    S.err = e.status === 401 || e.status === 403 ? 'Ключ модератора не подошёл.' : 'Функция не ответила — попробуйте ещё раз.';
  }
  S.busy = false;
  statsRedraw();
}
// подсказка у графиков: наведение и фокус с клавиатуры — одна и та же
function tipShow(el) {
  const box = $('[data-dbtip]') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'db-tip' }));
  box.setAttribute('data-dbtip', '');
  box.replaceChildren();
  const h = document.createElement('div'); h.className = 'db-tip-h'; h.textContent = el.dataset.tip; box.append(h);
  for (const row of (el.dataset.tipRows || '').split('|').filter(Boolean)) {
    const [v, l] = row.split('~'), r = document.createElement('div'), b = document.createElement('b');
    b.textContent = v; r.append(b, document.createTextNode(` ${l || ''}`)); box.append(r);
  }
  box.hidden = false;
  const rc = el.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
  let x = rc.left + rc.width / 2 - bw / 2, y = rc.top - bh - 8;
  if (y < 64) y = rc.bottom + 8;
  x = Math.max(8, Math.min(innerWidth - bw - 8, x));
  box.style.left = `${x}px`; box.style.top = `${y}px`;
}
const tipHide = () => { const b = $('[data-dbtip]'); if (b) b.hidden = true; };
document.addEventListener('pointerover', (e) => { const el = e.target.closest && e.target.closest('[data-stats-pane] [data-tip]'); if (el) tipShow(el); else tipHide(); });
document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-stats-pane] [data-tip]'); if (el) tipShow(el); else tipHide(); });
document.addEventListener('scroll', tipHide, true);

// ---------- реплики головы ----------
// Исходные тексты — в js/lines.js. Свои правки хранятся в настройках сайта (site.lines[язык][id]) и ложатся поверх;
// пустая строка — «в этой ситуации промолчать». Совпало с исходным — правка не хранится вовсе.
const lineDef = (id) => (LINES[st.lang] || {})[id] ?? '';
const lineOwn = (id) => { const m = st.site.lines && st.site.lines[st.lang]; return m && id in m ? m[id] : undefined; };
function lineRow(id, when) {
  const def = lineDef(id), own = lineOwn(id), text = own ?? def;
  return `<div class="ln${own !== undefined ? ' is-own' : ''}${text === '' ? ' is-mute' : ''}" data-line-row="${esc(id)}">
    <div class="ln-when">${esc(when)}</div>
    <div class="ln-text"><textarea data-line="${esc(id)}" rows="1" placeholder="Голова промолчит" aria-label="${esc(when)}">${esc(text)}</textarea>
      <button class="ico" type="button" data-act="line-reset" data-id="${esc(id)}" title="Вернуть исходную реплику" aria-label="Вернуть исходную реплику: ${esc(when)}"${own === undefined ? ' hidden' : ''}>${I.undo}</button></div>
  </div>`;
}
// поле реплики — ровно по высоте текста
const fitLine = (t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
function linesPane() {
  const secs = st.site.sections || [], en = st.lang !== defLang();
  const group = (g) => `<section class="sec ln-group"><h2 class="sec-h">${esc(g.title)}</h2>${g.note ? `<p class="hint sec-hint">${esc(g.note)}</p>` : ''}
    ${g.items.map(([id, when]) => (id.includes('*')
    ? secs.map((sec) => lineRow(id.replace('*', sec.id), when.replace('{section}', txAny(sec.label) || sec.id))).join('')
    : lineRow(id, when))).join('')}</section>`;
  const own = Object.keys((st.site.lines && st.site.lines[st.lang]) || {}).length;
  return `<div class="toolbar toolbar--sticky"><input type="search" class="inp ln-find" data-line-find placeholder="Найти реплику или ситуацию" aria-label="Найти реплику">
      <span class="hint">${own ? `Своих правок: ${own}` : 'Все реплики — исходные'}${en ? ' · английские' : ''}</span></div>
    <p class="hint sec-hint">Слева — когда голова это говорит, справа — что. Пустое поле — промолчит, стрелка — вернуть исходный текст.
      Можно вставлять {name}, {nameGen} и {role}. Короче читается лучше: до 80–90 знаков. Если для реплики записан голос, после правки запись нужно обновить.</p>
    ${LINE_INFO.map(group).join('')}
    <p class="hint" data-line-none hidden>Ничего не нашлось.</p>`;
}

// Шапка страницы: заголовок, действия справа от него, пояснение и вкладки раздела
function head(title, { lead = '', actions = '', h1 = false } = {}) {
  const tabs = SUBS[st.page] ? `<div class="tabs" role="tablist">${SUBS[st.page].map(([id, name]) => `<button type="button" role="tab" aria-selected="${subOf(st.page) === id}" data-act="sub" data-sub="${id}">${esc(name)}</button>`).join('')}</div>` : '';
  return `<div class="edit-head"><div class="edit-title"><h1${h1 ? ' data-h1' : ''}>${esc(title)}</h1>${actions ? `<div class="edit-actions">${actions}</div>` : ''}</div>${lead ? `<p class="lead">${lead}</p>` : ''}</div>${tabs}`;
}
function casePage() {
  if (st.idx < 0) return `${head('Кейсы')}<div class="empty"><p>Кейсов пока нет.</p><button class="btn btn--sm" type="button" data-act="new">Новый кейс</button></div>`;
  const p = cur();
  const tabs = [['main', 'Основное'], ['look', 'Каталог и обложка'], ['results', 'Результаты'], ['blocks', `Блоки: ${(p.blocks || []).length}`]];
  return `${head(txAny(p.title) || 'Без названия', { h1: true, actions: `
          <label class="switch"><input type="checkbox" data-path="published" data-kind="bool"${p.published !== false ? ' checked' : ''}><span>На сайте</span></label>
          <button class="btn btn--line btn--sm" type="button" data-act="dup">Дублировать</button>
          <button class="btn btn--line btn--sm" type="button" data-act="del">Удалить</button>` })}
      <div class="tabs" role="tablist">${tabs.map(([id, name]) => `<button type="button" role="tab" aria-selected="${st.tab === id}" data-act="tab" data-tab="${id}">${esc(name)}</button>`).join('')}</div>
      <div class="pane">${PANES[st.tab](p)}</div>
      <div class="checks" data-checks>${checksHTML(p)}</div>`;
}
function pageHTML() {
  const sw = (path, label) => `<label class="switch"><input type="checkbox" data-path="${path}" data-kind="bool"${st.site[path] ? ' checked' : ''}><span>${esc(label)}</span></label>`;
  switch (st.page) {
    case 'home': {
      const t = subOf('home');
      return `${head('Главная', { lead: 'Папки разделов на главном экране, что говорит голова и её пасхалки.' })}
        <div class="pane${t === 'lines' ? ' pane--lines' : ''}">${t === 'lines' ? linesPane() : t === 'fun' ? funPane() : sectionsPane()}</div>`;
    }
    case 'pol': return `${head('Полароиды', { actions: sw('polaroidOn', 'На сайте'), lead: 'Голову растянули и подержали — она фоткается. Гости подписывают карточку, лепят наклейки и оставляют в архиве.' })}
        <div class="pane" data-pol-pane>${polaroidPane()}</div>`;
    case 'stats': return `${head('Статистика')}<div class="pane pane--stats" data-stats-pane>${statsPane()}</div>`;
    case 'profile': return `${head('Профиль', { lead: 'Кто вы и как с вами связаться: это видно на главной, в каждом кейсе и в поисковиках.' })}<div class="pane">${profilePane()}</div>`;
    case 'style': return `${head('Стиль', { lead: 'Дизайн-токены сайта. Правки сразу видны в предпросмотре; пустой цвет — значение по умолчанию.' })}<div class="pane">${stylePane()}</div>`;
    case 'settings': return `${head('Настройки', { lead: 'Подключение сайта, облачные функции и доступ к админке.' })}<div class="pane">${settingsPane()}</div>`;
    default: return casePage();
  }
}
function renderEdit() {
  const root = $('[data-edit]');
  const keep = root.scrollTop;
  root.innerHTML = `<div class="edit-in${st.page === 'stats' ? ' edit-in--wide' : ''}">${pageHTML()}</div>`;
  layout();
  for (const t of $$('.ln textarea', root)) fitLine(t);
  root.scrollTop = keep;
  hydrate(root);
}
// Колонки: разделы | список кейсов (только в «Кейсах») | страница | предпросмотр (где он нужен и не свёрнут)
function layout() {
  const app = $('[data-app]'), pv = hasPrev(), show = pv && st.prevOn && !narrowScreen();
  app.dataset.list = st.page === 'cases' ? '1' : '0';
  app.dataset.prev = show ? '1' : '0';
  const btn = $('[data-prev-show]');
  if (btn) btn.hidden = !(pv && !st.prevOn && !narrowScreen());
  if (show) requestAnimationFrame(fitFrame);
}
// раздел админки — в адресе: обновили страницу — остались там же, кнопка «назад» работает
function pageHash() {
  if (st.page !== 'cases') return `#/${st.page}${SUBS[st.page] ? `/${subOf(st.page)}` : ''}`;
  const p = st.idx >= 0 && st.projects[st.idx];
  return p && p.slug ? `#/cases/${encodeURIComponent(p.slug)}` : '#/cases';
}
function syncHash(push = false) { const h = pageHash(); if (location.hash !== h) history[push ? 'pushState' : 'replaceState'](null, '', h); }
function readHash() {
  const [page, rest] = location.hash.replace(/^#\/?/, '').split('/').map((x) => decodeURIComponent(x || ''));
  if (!NAV.some((n) => n.id === page)) return false;
  if (page === 'cases') { const i = st.projects.findIndex((p) => p.slug === rest); go('cases', { idx: i >= 0 ? i : undefined, quiet: true }); }
  else go(page, { sub: rest || undefined, quiet: true });
  return true;
}
function go(page, { sub, idx, quiet = false } = {}) {
  if (page === 'cases') {
    st.idx = idx ?? (st.idx >= 0 ? st.idx : st.lastIdx);
    if (st.idx >= st.projects.length) st.idx = st.projects.length - 1;
    if (!PANES[st.tab]) st.tab = 'main';
  } else {
    if (st.idx >= 0) st.lastIdx = st.idx;
    st.idx = -1;
  }
  const same = st.page === page && (!sub || subOf(page) === sub);
  st.page = page;
  if (sub && SUBS[page]) st.sub[page] = sub;
  st.open.clear(); st.menu = false;
  syncHash(!quiet);
  renderSide(); renderEdit(); renderViews(); sendPreview(false);
  if (!same && !quiet) $('[data-edit]').scrollTop = 0;
  if (page === 'stats' && !st.stats.data && !st.stats.busy && modKey()) statsLoad();
  if (page === 'pol' && subOf('pol') === 'cards' && !st.pol.items.length && !st.pol.busy && !st.pol.note && modKey() && polaroidsApi(st.site)) polLoad(false);
}
function renderViews() {
  const list = st.idx < 0 ? [['home', 'Главная'], ['archive', 'Архив']] : [['catalog', 'Каталог'], ['case', 'Кейс']];
  if (!list.some(([k]) => k === st.view)) st.view = list[0][0];
  $('[data-views]').innerHTML = list.map(([k, n]) => `<button type="button" data-act="view" data-view="${k}" aria-pressed="${k === st.view}">${n}</button>`).join('');
}
function renderAll() { renderBar(); renderSide(); renderEdit(); renderViews(); fitFrame(); }
window.addEventListener('resize', () => { if (st.site) layout(); });
window.addEventListener('popstate', () => { if (st.site) readHash(); });

// после любой правки: статус, заголовки, проверка и предпросмотр
function changed(path = '') {
  updateStatus();
  if (st.idx >= 0) {
    const p = cur(), h1 = $('[data-h1]'), ch = $('[data-checks]'), ct = $('[data-contrast]');
    if (h1) h1.textContent = txAny(p.title) || 'Без названия';
    if (ch) ch.innerHTML = checksHTML(p);
    if (ct) { const c = contrastHTML(p); ct.className = `contrast ${c.cls}`; ct.innerHTML = c.html; }
    const sum = /^blocks\.(\d+)\./.exec(path);
    if (sum) { const el = $(`.blk[data-i="${sum[1]}"] .blk-sum`); if (el) el.textContent = summaryOf(p.blocks[Number(sum[1])]); }
  }
  if (/^(title|section|year|published|sticker|sections)/.test(path)) renderSide();
  schedulePreview();
}

// ---------- предпросмотр ----------
let prevT = 0;
function schedulePreview() { clearTimeout(prevT); prevT = setTimeout(() => sendPreview(false), 240); }
async function draftForPreview() {
  const d = clone({ site: st.site, projects: st.projects });
  const jobs = [];
  const walk = (o) => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (isAsset(v)) jobs.push(blobUrl(v).then((u) => { if (u) o[k] = u; }));
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(d);
  await Promise.all(jobs);
  return d;
}
const previewHash = () => (st.idx < 0 ? (st.view === 'archive' ? '#/archive' : '#/') : st.view === 'catalog' ? '#/work' : `#/work/${encodeURIComponent(cur().slug || '')}`);
async function sendPreview(reload) {
  if (!st.site) return;
  const frame = $('[data-frame]');
  try { localStorage.setItem('ph:draft', JSON.stringify(await draftForPreview())); } catch (_) { /* noop */ }
  const hash = previewHash();
  const focus = st.idx >= 0 && st.view === 'catalog' ? cur().slug : null;
  if (reload || frame.dataset.key !== st.lang) {
    frame.dataset.key = st.lang; frame.dataset.ready = '';
    frame.src = `../index.html?preview=1&lang=${st.lang}${hash}`;
  } else if (frame.dataset.ready) {
    frame.contentWindow.postMessage({ type: 'ph:draft', hash, focus, block: st.showBlock }, location.origin);
    st.showBlock = null;
  }
  // пока предпросмотр грузится, он сам возьмёт свежий черновик; как загрузится — пришлёт ph:ready
}
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data) return;
  const frame = $('[data-frame]');
  if (e.data.type === 'ph:ready') { frame.dataset.ready = '1'; sendPreview(false); }
  // визуал проекта передвинули или увеличили в предпросмотре каталога — запоминаем для этого типа экрана
  if (e.data.type === 'ph:hero' && st.site) {
    const p = st.projects.find((x) => x.slug === e.data.slug);
    const L = e.data.layout === 'phone' ? 'phone' : 'desk', pos = e.data.pos || {};
    if (!p || ![pos.x, pos.y, pos.s].every(Number.isFinite)) return;
    p.hero = p.hero || {};
    p.hero[L] = { x: pos.x, y: pos.y, s: pos.s };
    if (cur() === p && st.tab === 'look') renderEdit();
    changed('hero');
    return;
  }
  // папку на главной перетащили в предпросмотре — запоминаем её место
  if (e.data.type === 'ph:folder' && st.site) {
    const sec = (st.site.sections || []).find((s) => s.id === e.data.id);
    if (!sec || !Array.isArray(e.data.pos)) return;
    sec.pos = e.data.pos.map((v) => Math.round(v * 1000) / 1000);
    changed('sections');
    toast('Положение папки запомнено');
  }
});
function fitFrame() {
  const wrap = $('[data-frame-wrap]'), frame = $('[data-frame]');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;
  wrap.classList.toggle('is-phone', st.device !== 'desktop');
  const SIZES = { phone: [390, 844], tablet: [820, 1180], laptop: [1280, 720] };
  if (SIZES[st.device]) {
    // устройство показывается в настоящем размере экрана, уменьшенным, если не помещается
    const [w, h] = SIZES[st.device], k = Math.min(1, (W - 24) / w, (H - 40) / h);
    frame.style.cssText = `width:${w}px;height:${h}px;left:${Math.round((W - w * k) / 2)}px;top:20px;transform:scale(${k});transform-origin:0 0`;
  } else {
    // компьютерная вёрстка показывается целиком, просто уменьшенной
    const w = Math.max(1280, W), k = W / w;
    frame.style.cssText = `width:${w}px;height:${Math.ceil(H / k)}px;left:0;top:0;transform:scale(${k});transform-origin:0 0`;
  }
}
window.addEventListener('resize', fitFrame);

// ---------- сохранение ----------
function tidy() {
  for (const p of st.projects) {
    p.slug = uniqueSlug(slugify(p.slug) || slugify(txAny(p.title)) || 'project', p);
    if (p.theme && !p.theme.color) delete p.theme.color;
  }
}
async function save() {
  if (!dirty()) return;
  tidy();
  const siteText = `${JSON.stringify(st.site, null, 1)}\n`, projText = `${JSON.stringify({ projects: st.projects }, null, 1)}\n`;
  const btn = $('[data-act="save"]');
  btn.disabled = true;
  try {
    if (st.dir) {
      const [sf, pf] = await Promise.all([fsRead('content/site.json'), fsRead('content/projects.json')]);
      if ((sf.lastModified !== st.mtime.site || pf.lastModified !== st.mtime.projects)
        && !window.confirm('Файлы содержимого изменились на диске, пока была открыта админка (например, вы правили их вручную). Заменить их вашей версией?')) { updateStatus(); return; }
      // прежняя версия остаётся в content/backup — на случай, если захочется вернуться
      const d = new Date(), z = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
      await fsWrite(`content/backup/${stamp}-site.json`, await sf.text());
      await fsWrite(`content/backup/${stamp}-projects.json`, await pf.text());
      for (const [path, blob] of st.pending) await fsWrite(path, blob);
      await fsWrite('content/site.json', siteText);
      await fsWrite('content/projects.json', projText);
      const [s2, p2] = await Promise.all([fsRead('content/site.json'), fsRead('content/projects.json')]);
      st.mtime = { site: s2.lastModified, projects: p2.lastModified };
      pruneBackups().catch(() => {});
      if (gh.on) st.unpub = true;
      if (!st.busy) toast(gh.on ? 'Сохранено в папку. На сайт правки уйдут по кнопке «Опубликовать»' : 'Сохранено в папку сайта');
    } else {
      const enc = new TextEncoder();
      const files = [{ name: 'content/site.json', data: enc.encode(siteText) }, { name: 'content/projects.json', data: enc.encode(projText) }];
      for (const [path, blob] of st.pending) files.push({ name: path, data: new Uint8Array(await blob.arrayBuffer()) });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(makeZip(files));
      a.download = 'portfolio-changes.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Архив скачан. Распакуйте его в папку сайта с заменой файлов');
    }
    st.pending.clear();
    st.saved = snapshot();
    const t = new Date();
    st.savedAt = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  } catch (e) {
    console.error(e);
    toast(`Не сохранилось: ${e && e.message ? e.message : 'ошибка записи'}. Проверьте, что папка сайта доступна, и нажмите «Сохранить» ещё раз`);
  }
  renderSide();
  updateStatus();
}
// ---------- публикация на сайт ----------
// Содержимое и новые файлы уходят одним коммитом в репозиторий сайта; GitHub Pages сам пересобирает сайт за минуту-две.
// С папкой: сначала сохраняем в неё, потом отправляем содержимое и все картинки, на которые оно ссылается
// (отличающиеся от лежащих на сайте). Без папки — содержимое и файлы, добавленные в этом сеансе.
const clock = () => { const t = new Date(); return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
function pubNote(text) { st.pubNote = text; updateStatus(); }
async function publish() {
  if (st.busy || !gh.on || !st.site) return;
  st.busy = true;
  updateStatus();
  try {
    if (st.dir && dirty()) { await save(); if (dirty()) return; }        // не сохранилось в папку — на сайт не отправляем
    tidy();
    pubNote('Готовлю файлы…');
    const enc = new TextEncoder();
    const files = [
      { path: SITE_JSON, bytes: enc.encode(`${JSON.stringify(st.site, null, 1)}\n`) },
      { path: PROJ_JSON, bytes: enc.encode(`${JSON.stringify({ projects: st.projects }, null, 1)}\n`) },
    ];
    for (const f of files) f.sha = await gitSha(f.bytes);
    const mine = { site: files[0].sha, projects: files[1].sha };
    if (st.dir) {
      for (const path of usedPaths()) {
        try { files.push({ path, bytes: new Uint8Array(await (await fsRead(path)).arrayBuffer()) }); } catch (_) { /* файла нет в папке — значит, он уже на сайте или ссылка пустая */ }
      }
    } else {
      for (const [path, blob] of st.pending) files.push({ path, blob, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    const snapWas = snapshot();
    const res = await gh.commit(files, {
      message: 'Админка: правки содержимого',
      onProgress: (n, all) => pubNote(`Отправляю на сайт: ${n} из ${all}`),
      // на сайте не та версия, от которой мы шли (правили с другого компьютера?) — без спроса не затираем
      check: (snap) => {
        const cur = { site: snap.files.get(SITE_JSON), projects: snap.files.get(PROJ_JSON) }, known = gh.base;
        const same = cur.site === mine.site && cur.projects === mine.projects;
        const moved = !known || known.site !== cur.site || known.projects !== cur.projects;
        return same || !moved || window.confirm('На сайте сейчас не та версия содержимого, которую вы открывали или публиковали отсюда: её могли поменять с другого компьютера. Опубликовать вашу версию поверх?');
      },
    });
    if (res.cancelled) { pubNote(''); return; }
    gh.base = mine;
    st.unpub = false;
    if (!st.dir) {
      // пока файлы уходили, могли добавить новые — они остаются ждать следующей публикации
      for (const f of files) if (f.blob && st.pending.get(f.path) === f.blob) st.pending.delete(f.path);
      st.saved = snapWas;
    }
    if (!res.changed.length) { pubNote(''); toast('На сайте уже эта версия — отправлять нечего'); return; }
    st.pubSha = res.sha; st.pubAt = '';
    pubNote('Отправлено. Сайт обновляется…');
    toast('Отправлено. Правки появятся на сайте через минуту-две');
    // по каким файлам потом узнаем, что правки дошли до сайта: содержимое, а если менялись только картинки — самая лёгкая из них
    const sent = files.filter((f) => res.changed.includes(f.path) && f.sha);
    const json = sent.filter((f) => f.path === SITE_JSON || f.path === PROJ_JSON);
    const probes = (json.length ? json : sent.sort((a, b) => a.bytes.length - b.bytes.length).slice(0, 1)).map((f) => ({ path: f.path, sha: f.sha }));
    watchDeploy(res.sha, probes);
  } catch (e) {
    console.error(e);
    pubNote('');
    toast(e instanceof GhError ? e.message : `Не опубликовалось: ${e && e.message ? e.message : 'неизвестная ошибка'}. Нажмите «Опубликовать» ещё раз`);
    if (e instanceof GhError && e.code === 'auth') { gh.forget(); renderBar(); }
  } finally {
    st.busy = false;
    renderSide();
    updateStatus();
  }
}
// Дошли ли правки до сайта. Админка открыта на самом сайте — спрашиваем его: там должен лежать ровно тот файл, который мы отправили.
// Так ответ не зависит от хостинга (сайт может раздавать не GitHub). С компьютера (localhost) сайт не спросить —
// тогда смотрим, выложил ли коммит GitHub Pages.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
async function liveHas(probes, alive, { timeout = 300000, every = 6000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout && alive()) {
    await sleep(every);
    try {
      let same = true;
      for (const f of probes) {
        const r = await fetch(`../${f.path}?v=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok || (await gitSha(new Uint8Array(await r.arrayBuffer()))) !== f.sha) { same = false; break; }
      }
      if (same) return true;
    } catch (_) { /* сайт на секунду пропал (хостинг переключает версию) — спросим ещё раз */ }
  }
  return false;
}
// ждём, пока правки появятся на сайте; работать в админке это не мешает
async function watchDeploy(sha, probes = []) {
  const live = !isLocal() && probes.length > 0;
  const state = live
    ? ((await liveHas(probes, () => st.pubSha === sha)) ? 'done' : 'late')
    : await gh.deployed(sha).catch(() => 'unknown');
  if (st.pubSha !== sha) return;                 // за это время опубликовали что-то новее — отчитается та публикация
  if (state === 'done') { st.pubAt = `Опубликовано в ${clock()}`; pubNote(''); toast('Опубликовано: правки уже на сайте'); }
  else if (state === 'failed') { st.pubAt = ''; pubNote('GitHub не собрал сайт'); toast('GitHub не смог собрать сайт. Причина видна в репозитории на вкладке Actions'); }
  else if (state === 'late') { st.pubAt = `Отправлено в ${clock()}`; pubNote(''); toast('Отправлено, но сайт пока отдаёт прежнюю версию. Хостинг обновляет его сам: загляните через несколько минут. Не обновился — проверьте деплой в панели хостинга'); }
  else { st.pubAt = `Отправлено в ${clock()}`; pubNote(''); toast('Отправлено. Если правок на сайте ещё нет, обновите страницу через пару минут'); }
}

// в content/backup хранятся последние 12 сохранений
async function pruneBackups() {
  const dir = await (await st.dir.getDirectoryHandle('content')).getDirectoryHandle('backup');
  const names = [];
  for await (const [name, h] of dir.entries()) if (h.kind === 'file' && /^\d{8}-\d{6}-(site|projects)\.json$/.test(name)) names.push(name);
  names.sort();
  for (const name of names.slice(0, Math.max(0, names.length - 24))) await dir.removeEntry(name);
}

// ---------- действия ----------
function uniqueSlug(base, self) {
  const taken = new Set(st.projects.filter((p) => p !== self).map((p) => p.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
function newProject() {
  const p = {
    slug: uniqueSlug('novyy-proekt'), section: (st.site.sections[0] || {}).id || '', year: new Date().getFullYear(),
    title: 'Новый проект', summary: '', client: '', role: '', team: '', duration: '',
    cover: '', sticker: '', artifacts: [], theme: { color: '#1F3BD9' },
    metrics: [{ v: '', l: '' }, { v: '', l: '' }, { v: '', l: '' }], tldr: { task: '', did: '', result: '' },
    // скелет кейса: контекст → решение крупно → процесс → детали → отзыв. Лишнее удалите, пустые блоки на сайте не показываются
    blocks: [
      { type: 'text', title: 'Что было не так', text: '' },
      { type: 'image', src: '', alt: '', caption: '', width: 'wide' },
      { type: 'steps', title: 'Как решал', items: [{ title: '', text: '' }, { title: '', text: '' }, { title: '', text: '' }] },
      { type: 'gallery', columns: 2, items: [] },
      { type: 'quote', text: '', author: '', role: '' },
    ],
    tags: [], published: false,
  };
  autoSlug.add(p);
  return p;
}
function move(arr, from, to) { if (to < 0 || to >= arr.length || from === to) return false; arr.splice(to, 0, arr.splice(from, 1)[0]); return true; }
function openProject(i) { if (!PANES[st.tab]) st.tab = 'main'; go('cases', { idx: i }); }
let toastT = 0;
function toast(text, undo) {
  const el = $('[data-toast]');
  el.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button" data-act="undo">Вернуть</button>' : ''}`;
  el.hidden = false;
  st.undo = undo || null;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; st.undo = null; }, undo ? 9000 : 4200);
}

let pick = null;
const targetOf = (el) => ({ path: el.dataset.path, kind: el.dataset.kind || 'image', max: el.dataset.max, cut: el.dataset.cut, dims: el.dataset.dims, thumb: el.dataset.thumb, fixed: el.dataset.fixed, folder: el.dataset.folder, l: !!el.dataset.l });
function openPicker(t) {
  pick = t;
  const inp = $('[data-file]');
  inp.value = '';
  inp.multiple = t.kind === 'list';
  inp.accept = t.kind === 'file' ? 'application/pdf' : t.kind === 'video' ? 'video/mp4,video/webm' : 'image/*';
  inp.click();
}
$('[data-file]').addEventListener('change', (e) => { if (pick && e.target.files.length) addFiles([...e.target.files], pick); });

const ACT = {
  async 'pick-dir'() {
    try {
      const dir = await window.showDirectoryPicker({ id: 'ph-site', mode: 'readwrite' });
      if (dirty() && !window.confirm('Несохранённые изменения пропадут. Открыть другую папку?')) return;
      await loadFromDir(dir);
    } catch (e) { if (e && e.name !== 'AbortError') gateError(e.message); }
  },
  async 'resume-dir'() {
    try {
      const dir = await idb.get('dir');
      if (!dir) return;
      if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      await loadFromDir(dir);
    } catch (e) { gateError(e.message); }
  },
  async 'no-dir'() { try { await loadFromServer(); } catch (e) { gateError('Не получилось открыть содержимое сайта. Админку нужно открывать по адресу сайта, а не как файл с диска.'); } },
  save,
  publish,
  // сайт уже подключён, а мы на первом экране — открываем содержимое с сайта; иначе спрашиваем токен
  async 'gh-open'() {
    if (gh.on && !st.site) { try { await loadFromGitHub(); } catch (e) { ghGateError(e); } return; }
    openGhDialog();
  },
  'gh-cancel'() { ghDlg.close(); },
  'gh-off'() {
    if (st.busy) return;
    gh.forget();
    st.unpub = false; st.pubNote = ''; st.pubAt = '';
    if (st.site) { renderBar(); if (st.page === 'settings') renderEdit(); } else gateButtons();
    toast('Сайт отключён, токен удалён из этого браузера');
  },
  new() { st.projects.unshift(newProject()); st.tab = 'main'; openProject(0); changed('title'); const t = $('[data-path="title"]'); if (t) { t.focus(); t.select(); } },
  open(el) { openProject(Number(el.dataset.i)); },
  page(el) { if (st.site) go(el.dataset.page); },
  sub(el) { go(st.page, { sub: el.dataset.sub }); },
  'prev-toggle'() { st.prevOn = !st.prevOn; try { localStorage.setItem('ph:admin-prev', st.prevOn ? '1' : '0'); } catch (_) { /* не запомнится */ } layout(); if (st.prevOn) sendPreview(false); },
  'stats-load'() { statsLoad(); },
  'stats-copy'() {
    const url = statsLink();
    if (!url) { toast('Впишите название компании'); return; }
    const ok = () => toast('Ссылка скопирована — вставьте её в отклик');
    try { navigator.clipboard.writeText(url).then(ok, () => toast(url)); } catch (_) { toast(url); }
  },
  'stats-me'() { st.stats.me = !st.stats.me; markOwner(st.stats.me); statsRedraw(); },
  'stats-days'(el) { const S = st.stats, d = Number(el.dataset.days); if (S.days === d) return; S.days = d; S.more = 0; statsRedraw(); if (!S.data || !enough(S.data.days, d)) statsLoad(); },
  'stats-more'() { st.stats.more += 40; statsRedraw(); },
  'stats-key'() { st.stats.keyOpen = true; statsRedraw(); const i = $('[data-modkey]'); if (i) i.focus(); },
  'line-reset'(el) {
    const id = el.dataset.id, L = st.site.lines, m = L && L[st.lang];
    if (!m || !(id in m)) return;
    delete m[id];
    if (!Object.keys(m).length) delete L[st.lang];
    if (!Object.keys(L).length) delete st.site.lines;
    renderEdit(); changed('lines');
    const t = $(`[data-line="${CSS.escape(id)}"]`); if (t) t.focus();
  },
  up(el) { const i = Number(el.dataset.i); if (move(st.projects, i, i - 1)) { if (st.idx === i) st.idx = i - 1; else if (st.idx === i - 1) st.idx = i; renderSide(); changed(); } },
  down(el) { const i = Number(el.dataset.i); if (move(st.projects, i, i + 1)) { if (st.idx === i) st.idx = i + 1; else if (st.idx === i + 1) st.idx = i; renderSide(); changed(); } },
  dup() {
    const p = clone(cur());
    p.title = isL(p.title) ? { ...p.title, [st.lang]: `${txAny(p.title)} (копия)` } : `${p.title} (копия)`;
    p.slug = uniqueSlug(`${p.slug}-copy`); p.published = false;
    st.projects.splice(st.idx + 1, 0, p);
    openProject(st.idx + 1); changed('title');
  },
  del() {
    const back = { projects: st.projects.slice(), idx: st.idx };
    const name = txAny(cur().title) || 'Без названия';
    st.projects.splice(st.idx, 1);
    openProject(Math.min(st.idx, st.projects.length - 1));
    changed('title');
    toast(`Проект «${name}» удалён. Его картинки остались в папке`, () => { st.projects = back.projects; openProject(back.idx); changed('title'); });
  },
  undo() { const u = st.undo; $('[data-toast]').hidden = true; st.undo = null; if (u) u(); },
  tab(el) { st.tab = el.dataset.tab; st.menu = false; renderEdit(); $('[data-edit]').scrollTop = 0; },
  lang(el) { st.lang = el.dataset.lang; renderAll(); sendPreview(true); },
  view(el) { st.view = el.dataset.view; renderViews(); sendPreview(false); },
  device(el) { st.device = el.dataset.device; $$('[data-act="device"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el))); fitFrame(); },
  pick(el) { openPicker(targetOf(el)); },
  clear(el) {
    const o = cur(), path = el.dataset.path;
    if (el.dataset.l) setPath(o, path, setL(getPath(o, path), '')); else if (/\.(bg|folder)$|^folder$/.test(path)) delPath(o, path); else setPath(o, path, '');
    if (el.dataset.dims) setDims(o, path, null);
    if (el.dataset.thumb) delPath(o, el.dataset.thumb);
    renderEdit(); changed(path);
  },
  menu() { st.menu = !st.menu; renderEdit(); if (st.menu) { const b = $('.add-menu button'); if (b) b.focus(); } },
  'blk-add'(el) { const p = cur(); p.blocks.push(BLOCKS[el.dataset.type].make()); st.menu = false; st.open = new Set([p.blocks.length - 1]); renderEdit(); changed('blocks'); const li = $('.blk.is-open'); if (li) li.scrollIntoView({ block: 'nearest' }); },
  // открыли блок — предпросмотр кейса прокручивается к нему
  'blk-toggle'(el) {
    const i = Number(el.dataset.i);
    if (st.open.has(i)) st.open.delete(i); else { st.open.add(i); if (st.view === 'case') { st.showBlock = i; schedulePreview(); } }
    renderEdit();
  },
  'blk-up'(el) { const i = Number(el.dataset.i); if (move(cur().blocks, i, i - 1)) { st.open = new Set(st.open.has(i) ? [i - 1] : []); renderEdit(); changed('blocks'); } },
  'blk-down'(el) { const i = Number(el.dataset.i); if (move(cur().blocks, i, i + 1)) { st.open = new Set(st.open.has(i) ? [i + 1] : []); renderEdit(); changed('blocks'); } },
  'blk-dup'(el) { const i = Number(el.dataset.i), p = cur(); p.blocks.splice(i + 1, 0, clone(p.blocks[i])); st.open = new Set([i + 1]); renderEdit(); changed('blocks'); },
  'blk-del'(el) {
    const i = Number(el.dataset.i), p = cur(), back = p.blocks.slice();
    p.blocks.splice(i, 1); st.open.clear(); renderEdit(); changed('blocks');
    toast('Блок удалён', () => { p.blocks = back; renderEdit(); changed('blocks'); });
  },
  'item-add'(el) { const o = cur(), arr = getPath(o, el.dataset.path) || []; arr.push(MAKE[el.dataset.make]()); setPath(o, el.dataset.path, arr); renderEdit(); changed(el.dataset.path); },
  'item-up'(el) { const i = Number(el.dataset.i); if (move(getPath(cur(), el.dataset.path), i, i - 1)) { renderEdit(); changed(el.dataset.path); } },
  'item-down'(el) { const i = Number(el.dataset.i); if (move(getPath(cur(), el.dataset.path), i, i + 1)) { renderEdit(); changed(el.dataset.path); } },
  'item-del'(el) { getPath(cur(), el.dataset.path).splice(Number(el.dataset.i), 1); renderEdit(); changed(el.dataset.path); },
  'sec-add'() {
    const label = window.prompt('Название нового раздела');
    if (!label || !label.trim()) return;
    let id = slugify(label) || 'section';
    const ids = new Set(st.site.sections.map((s) => s.id));
    for (let n = 2; ids.has(id); n++) id = `${slugify(label) || 'section'}-${n}`;
    st.site.sections.push({ id, label: label.trim(), pos: [0.5, 0.86], tilt: 0 });
    renderEdit(); changed('sections');
  },
  'sec-del'(el) { st.site.sections.splice(Number(el.dataset.i), 1); renderEdit(); changed('sections'); },
  'pass-set'() { openPassDialog(); },
  'style-reset'() { delete st.site.style; renderEdit(); changed('style'); },
  'hero-reset'(el) { const h = cur().hero; if (h) { delete h[el.dataset.layout]; if (!Object.keys(h).length) delete cur().hero; } renderEdit(); changed('hero'); },
  'likes-refresh'() { loadLikes(true); },
  'pol-load'() { polLoad(false); },
  'pol-more'() { polLoad(true); },
  'pol-hide'(el) { polModerate(el.dataset.pid, 'hide'); },
  'pol-show'(el) { polModerate(el.dataset.pid, 'show'); },
  'pol-del'(el) { polModerate(el.dataset.pid, 'del'); },
  'pass-cancel'() { passDlg.close(); },
  'pass-off'() {
    if (!window.confirm('Убрать пароль? После публикации админка будет открываться без него.')) return;
    delete st.site.adminLock; renderEdit(); changed('adminLock');
    toast(st.dir && !gh.on ? 'Пароль уберётся после «Сохранить»' : 'Пароль уберётся после «Опубликовать»');
  },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) { if (st.menu && !e.target.closest('.add')) { st.menu = false; renderEdit(); } return; }
  const fn = ACT[el.dataset.act];
  if (fn) fn(el);
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.toggle === 'en') {
    st.site.languages = el.checked ? ['ru', 'en'] : ['ru'];
    if (!el.checked) st.lang = defLang();
    renderBar(); changed('languages');
    return;
  }
  if (el.dataset.line) {
    // реплика головы: совпала с исходной — правку не храним; пустая — «промолчать»
    const id = el.dataset.line, def = lineDef(id);
    const L = st.site.lines = st.site.lines || {}, m = L[st.lang] = L[st.lang] || {};
    if (el.value === def) delete m[id]; else m[id] = el.value;
    if (!Object.keys(m).length) delete L[st.lang];
    if (!Object.keys(L).length) delete st.site.lines;
    const row = el.closest('.ln'), own = lineOwn(id) !== undefined;
    row.classList.toggle('is-own', own); row.classList.toggle('is-mute', el.value === '');
    row.querySelector('[data-act="line-reset"]').hidden = !own;
    fitLine(el);
    changed('lines');
    return;
  }
  if (el.matches && el.matches('[data-stats-co]')) { st.stats.co = el.value; const o = $('[data-stats-link]'); if (o) o.textContent = statsLink() || '—'; return; }
  if (el.matches && el.matches('[data-modkey]')) { try { localStorage.setItem(MODKEY, el.value.trim()); } catch (_) { /* не запомнится */ } st.pol.note = ''; return; }
  if (el.matches && el.matches('[data-line-find]')) {
    const q = el.value.trim().toLowerCase();
    let any = false;
    for (const g of $$('.ln-group')) {
      let n = 0;
      for (const row of $$('.ln', g)) { const hit = !q || row.textContent.toLowerCase().includes(q) || row.querySelector('textarea').value.toLowerCase().includes(q); row.hidden = !hit; if (hit) n++; }
      g.hidden = !n; if (n) any = true;
    }
    $('[data-line-none]').hidden = any;
    return;
  }
  const path = el.dataset.path;
  if (!path || el.type === 'file') return;
  const obj = cur(), kind = el.dataset.kind || '';
  let v = el.value;
  if (kind === 'bool') v = el.checked;
  else if (kind === 'num') v = el.value === '' ? '' : Number(el.value);
  else if (kind === 'pct') v = el.value === '' ? '' : Math.round(Number(el.value) * 10) / 1000;
  else if (kind === 'color') { v = el.value.toUpperCase(); const t = el.parentNode.querySelector('[data-kind="hex"]'); if (t) t.value = v; }
  else if (kind === 'hex') {
    const m = /^#?([0-9a-f]{6})$/i.exec(el.value.trim());
    if (!m) { if (el.value.trim() === '' && el.dataset.optional) { delPath(obj, path); changed(path); } return; }      // пока код набран не до конца — ждём
    v = `#${m[1].toUpperCase()}`;
    const c = el.parentNode.querySelector('[data-kind="color"]'); if (c) c.value = v;
  } else if (kind === 'list') {
    const old = getPath(obj, path) || [];
    v = el.value.split(',').map((s) => s.trim()).filter(Boolean).map((s, i) => (el.dataset.l ? setL(old[i], s) : s));
  } else if (kind === 'slug') { v = slugify(el.value); autoSlug.delete(obj); }
  if (el.dataset.l && kind !== 'list') v = setL(getPath(obj, path), v);
  if (kind === 'opt' && v === '') delPath(obj, path); else setPath(obj, path, v);
  if (path.startsWith('style.') && obj.style) {
    // токен вернули к значению по умолчанию — не храним его (в содержимом только свои значения)
    const key = path.slice(6), tok = STYLE_TOKENS.find((x) => x.key === key);
    if (tok && String(styleValue(obj.style, key)) === String(tok.def)) delete obj.style[key];
    if (!Object.keys(obj.style).length) delete obj.style;
  }
  if (path === 'bg.kind') { renderEdit(); changed(path); return; }
  if (path === 'title' && autoSlug.has(obj)) {
    obj.slug = uniqueSlug(slugify(txAny(obj.title)) || 'project', obj);
    const s = $('[data-path="slug"]');
    if (s) s.value = obj.slug;
  }
  if (el.type === 'range') { const out = el.parentNode.querySelector('output'); if (out) out.textContent = `${el.value}${el.dataset.unit || ''}`; }
  // эмодзи наклейки поменяли — превью рядом обновляется сразу
  const sm = /^polaroid\.stickers\.(\d+)\.emoji$/.exec(path);
  if (sm) { const row = el.closest('.stk-row'), stk = obj.polaroid.stickers[Number(sm[1])]; if (row && stk) { row.querySelector('.stk-prev').innerHTML = stickerPrev(stk); hydrate(row); } }
  changed(path);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  // адрес страницы приводим в порядок, когда поле оставили
  if (el.dataset && el.dataset.kind === 'slug') { const p = cur(); p.slug = uniqueSlug(slugify(el.value) || slugify(txAny(p.title)) || 'project', p); el.value = p.slug; changed('slug'); }
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (st.site) (onSite() ? publish : save)(); }
  if (e.key === 'Escape' && st.menu) { st.menu = false; renderEdit(); const b = $('[data-act="menu"]'); if (b) b.focus(); }
});
window.addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });

// перетаскивание: порядок проектов и блоков, файлы — в поля картинок
let drag = null;
const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
document.addEventListener('dragstart', (e) => {
  const li = e.target.closest && e.target.closest('.pitem, .blk');
  if (!li) return;
  drag = { kind: li.classList.contains('pitem') ? 'p' : 'b', from: Number(li.dataset.i) };
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', String(drag.from)); } catch (_) { /* noop */ }
});
document.addEventListener('dragover', (e) => {
  if (hasFiles(e)) {
    e.preventDefault();
    $$('.is-drop').forEach((z) => z.classList.remove('is-drop'));
    const z = e.target.closest && e.target.closest('[data-drop]');
    if (z) z.classList.add('is-drop');
    return;
  }
  if (!drag) return;
  const li = e.target.closest && e.target.closest(drag.kind === 'p' ? '.pitem' : '.blk');
  if (!li) return;
  e.preventDefault();
  $$('.is-over').forEach((x) => x.classList.remove('is-over'));
  li.classList.add('is-over');
});
document.addEventListener('drop', (e) => {
  $$('.is-drop,.is-over').forEach((z) => z.classList.remove('is-drop', 'is-over'));
  if (hasFiles(e)) {
    e.preventDefault();
    const z = e.target.closest && e.target.closest('[data-drop]');
    if (z && st.site) addFiles([...e.dataTransfer.files], targetOf(z));
    return;
  }
  if (!drag) return;
  const li = e.target.closest && e.target.closest(drag.kind === 'p' ? '.pitem' : '.blk');
  if (!li) return;
  e.preventDefault();
  const to = Number(li.dataset.i), from = drag.from;
  if (drag.kind === 'p') {
    const curObj = cur();
    if (move(st.projects, from, to)) { if (st.idx >= 0) st.idx = st.projects.indexOf(curObj); renderSide(); changed(); }
  } else if (move(cur().blocks, from, to)) { st.open.clear(); renderEdit(); changed('blocks'); }
  drag = null;
});
document.addEventListener('dragend', () => { drag = null; $$('.is-drop,.is-over').forEach((z) => z.classList.remove('is-drop', 'is-over')); });

// ---------- подключение сайта ----------
const ghDlg = $('[data-gh-dlg]'), ghForm = $('[data-gh-form]');
function openGhDialog() {
  $('[data-gh-error]').hidden = true;
  $('[data-gh-fields]').hidden = !gh.secure;
  $('[data-gh-insecure]').hidden = gh.secure;
  $('[data-gh-submit]').hidden = !gh.secure;
  ghForm.repo.value = gh.name || DEFAULT_REPO;
  ghForm.token.value = '';
  if (ghDlg.showModal) ghDlg.showModal(); else ghDlg.setAttribute('open', '');
  if (gh.secure) ghForm.token.focus();
}
ghForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('[data-gh-submit]'), err = $('[data-gh-error]');
  if (btn.disabled || !gh.secure) return;
  btn.disabled = true; btn.textContent = 'Проверяю…'; err.hidden = true;
  try {
    await gh.connect(ghForm.token.value, ghForm.repo.value);
    ghForm.token.value = '';
    ghDlg.close();
    await afterConnect();
  } catch (e2) {
    err.textContent = e2 instanceof GhError ? e2.message : 'Не получилось подключиться. Попробуйте ещё раз.';
    err.hidden = false;
  }
  btn.disabled = false; btn.textContent = 'Подключить';
});
// Подключили сайт. Если правок ещё нет — открываем содержимое прямо с сайта; если есть (или открыта папка) —
// остаёмся в том же сеансе, просто появляется кнопка «Опубликовать».
async function afterConnect() {
  const hint = 'Сайт подключён. Правки уходят на него по кнопке «Опубликовать»';
  if (!st.site || (st.src === 'server' && !dirty())) {
    try { await loadFromGitHub(); toast(hint); } catch (e) { ghGateError(e); }
    return;
  }
  if (st.src === 'server') st.src = 'github';
  renderBar();
  if (st.dir) syncCheck();
  toast(hint);
}
function ghGateError(e) {
  const text = e instanceof GhError ? e.message : 'Не получилось открыть содержимое с сайта. Попробуйте ещё раз.';
  if (e instanceof GhError && e.code === 'auth') gh.forget();
  if (st.site) toast(text); else { gateError(text); gateButtons(); }
}
// первый экран: главная кнопка зависит от того, подключён ли сайт
function gateButtons() {
  const b = $('[data-gate-site]');
  b.textContent = gh.on ? `Открыть с сайта ${gh.name}` : 'Подключить сайт';
}

// ---------- лайки: числа со счётчика ----------
async function loadLikes(loud = false) {
  const url = st.site && likesApi(st.site);
  if (!url) { st.likes = null; return; }
  try {
    st.likes = await likeCounts(url);
    const total = Object.values(st.likes).reduce((a, b) => a + b, 0);
    st.likesNote = `Всего лайков: ${total}. Обновлено в ${clock()}`;
  } catch (e) {
    st.likes = null;
    st.likesNote = 'Счётчик не ответил. Проверьте адрес и что функция публичная.';
  }
  renderSide();
  const n = $('[data-likes-note]'); if (n) n.textContent = st.likesNote;
  if (loud) toast(st.likesNote);
}

// ---------- пароль админки ----------
// Простая дверь: пока пароль не введён, админка не открывается. Хранится не пароль, а его «отпечаток» (PBKDF2-SHA-256,
// 310 000 повторов, своя соль) — в настройках сайта, site.adminLock: так он сам доезжает до сайта при публикации.
// Это защита от случайного посетителя, а не от взломщика: файлы сайта открыты всем, а код страницы можно прочитать.
// Изменить сайт по-прежнему можно только с токеном GitHub — он и есть настоящий ключ. Вход помнится до закрытия вкладки.
const LOCK_ITER = 310000, LOCK_KEY = 'ph:admin-ok';
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
async function lockHash(pass, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return b64(new Uint8Array(bits));
}
async function makeLock(pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, salt: b64(salt), iter: LOCK_ITER, hash: await lockHash(pass, salt, LOCK_ITER) };
}
const validLock = (l) => !!(l && typeof l.hash === 'string' && typeof l.salt === 'string' && Number(l.iter) > 0);
const sessionOk = (l) => { try { return sessionStorage.getItem(LOCK_KEY) === l.hash; } catch (_) { return false; } };
const rememberOk = (l) => { try { sessionStorage.setItem(LOCK_KEY, l.hash); } catch (_) { /* не запомнится — спросим снова */ } };
async function readLock() {
  try {
    const r = await fetch('../content/site.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const site = await r.json();
    return validLock(site.adminLock) ? site.adminLock : null;
  } catch (_) { return null; }
}
function showLogin(lock) {
  document.body.classList.add('is-locked');
  const box = $('[data-login]'), form = $('[data-login-form]'), err = $('[data-login-error]'), btn = $('[data-login-submit]');
  box.hidden = false;
  if (!(window.crypto && crypto.subtle)) {
    err.textContent = 'Пароль можно проверить только по защищённому адресу: откройте админку по https.'; err.hidden = false; btn.disabled = true; return;
  }
  let fails = 0;
  form.pass.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = 'Проверяю…'; err.hidden = true;
    let ok = false;
    try { ok = (await lockHash(form.pass.value, unb64(lock.salt), Number(lock.iter))) === lock.hash; } catch (_) { ok = false; }
    if (ok) {
      rememberOk(lock);
      form.pass.value = '';
      box.hidden = true;
      document.body.classList.remove('is-locked');
      start();
      return;
    }
    fails++;
    err.textContent = 'Неверный пароль'; err.hidden = false;
    form.pass.select();
    // каждая ошибка — чуть дольше ждать следующей попытки
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Войти'; }, Math.min(8000, 400 * fails * fails));
  });
}
const passDlg = $('[data-pass-dlg]'), passForm = $('[data-pass-form]');
function openPassDialog() {
  passForm.p1.value = ''; passForm.p2.value = '';
  $('[data-pass-error]').hidden = true;
  if (passDlg.showModal) passDlg.showModal(); else passDlg.setAttribute('open', '');
  passForm.p1.focus();
}
passForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('[data-pass-error]'), btn = $('[data-pass-submit]');
  const p1 = passForm.p1.value, p2 = passForm.p2.value;
  const fail = (t) => { err.textContent = t; err.hidden = false; };
  if (!(window.crypto && crypto.subtle)) return fail('Задать пароль можно только по защищённому адресу (https) или на localhost.');
  if (p1.length < 8) return fail('Пароль короче 8 знаков.');
  if (p1 !== p2) return fail('Пароли не совпадают.');
  btn.disabled = true;
  try {
    st.site.adminLock = await makeLock(p1);
    rememberOk(st.site.adminLock);              // в этой вкладке заново не спросим
    passForm.p1.value = ''; passForm.p2.value = '';
    passDlg.close();
    renderEdit(); changed('adminLock');
    toast(st.dir && !gh.on ? 'Пароль задан. Он заработает после «Сохранить»' : 'Пароль задан. Он заработает после «Опубликовать»');
  } catch (_) { fail('Не получилось задать пароль. Попробуйте ещё раз.'); }
  btn.disabled = false;
});

// ---------- старт ----------
function gateError(text) { const el = $('[data-gate-error]'); el.textContent = text; el.hidden = false; }
async function boot() {
  const lock = await readLock();
  if (lock && !sessionOk(lock)) { showLogin(lock); return; }
  start();
}
async function start() {
  $('[data-gate]').hidden = false;
  gh.restore();
  gateButtons();
  if (!HAS_FS) {
    $('[data-gate-text]').textContent = 'Подключите сайт — правки будут публиковаться прямо отсюда. С папкой на компьютере этот браузер работать не умеет (для этого нужен Chrome или Edge), но изменения можно скачивать архивом.';
    $('[data-need-fs]').hidden = true;
    $('[data-act="no-dir"]').textContent = 'Работать без сайта';
    if (gh.on) { try { await loadFromGitHub(); } catch (e) { ghGateError(e); } }
    return;
  }
  const dir = await idb.get('dir');
  if (!dir) {
    // папки нет, а сайт подключён — сразу открываем с сайта
    if (gh.on) { try { await loadFromGitHub(); } catch (e) { ghGateError(e); } }
    return;
  }
  try {
    if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') { await loadFromDir(dir); return; }
  } catch (_) { /* папку могли удалить или переименовать */ }
  const b = $('[data-act="resume-dir"]');
  b.textContent = `Продолжить с папкой «${dir.name}»`;
  b.hidden = false;
  b.className = 'btn';
  $('[data-gate-site]').className = 'btn btn--line';
  $('[data-need-fs]').textContent = 'Выбрать другую папку';
}
boot();
