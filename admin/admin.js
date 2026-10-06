// Админка портфолио. Работает в браузере, без сервера. Содержимое (content/*.json и картинки) она умеет:
// — публиковать на сайт: одним коммитом в репозиторий на GitHub (см. github.js), сайт пересобирается сам;
// — читать и сохранять прямо в папке сайта на компьютере (Chrome, Edge);
// — отдавать архивом, если нет ни того ни другого.
import { toneOf, contrastOf } from '../js/theme.js';
import { gh, gitSha, GhError, DEFAULT_REPO } from './github.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const HAS_FS = 'showDirectoryPicker' in window;
const isAsset = (s) => typeof s === 'string' && /^assets\/.+\.[a-z0-9]{2,5}$/i.test(s);
const fileName = (p) => String(p || '').split('/').pop();
const fmtBytes = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1e3))} КБ`);
const SVG = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = { up: SVG('<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>'), down: SVG('<path d="M8 3v10M3.5 8.5 8 13l4.5-4.5"/>'), x: SVG('<path d="m4 4 8 8M12 4l-8 8"/>'),
  dup: SVG('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M3 10.5V4a1.5 1.5 0 0 1 1.5-1.5H11"/>'), grip: SVG('<path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" stroke-width="2.2"/>') };

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slugify = (s) => String(s || '').toLowerCase().replace(/[а-яё]/g, (c) => TR[c] ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// Виды блоков кейса: название, подсказка и заготовка. Как блок выглядит на сайте — см. js/case.js
const BLOCKS = {
  text: { name: 'Текст', hint: 'Заголовок и абзацы', make: () => ({ type: 'text', title: '', text: '' }) },
  image: { name: 'Картинка', hint: 'Одна работа крупно', make: () => ({ type: 'image', src: '', alt: '', caption: '', width: 'wide' }) },
  gallery: { name: 'Галерея', hint: 'Несколько работ плиткой', make: () => ({ type: 'gallery', columns: 2, items: [] }) },
  metrics: { name: 'Цифры', hint: 'Результаты крупными числами', make: () => ({ type: 'metrics', items: [{ v: '', l: '' }] }) },
  quote: { name: 'Цитата', hint: 'Слова заказчика или коллеги', make: () => ({ type: 'quote', text: '', author: '', role: '' }) },
  steps: { name: 'Шаги', hint: 'Процесс по порядку', make: () => ({ type: 'steps', title: '', items: [{ title: '', text: '' }] }) },
  compare: { name: 'До / после', hint: 'Сравнение ползунком', make: () => ({ type: 'compare', before: { src: '', alt: '' }, after: { src: '', alt: '' }, caption: '' }) },
  video: { name: 'Видео', hint: 'Запись интерфейса или ролик', make: () => ({ type: 'video', src: '', poster: '', loop: true, caption: '' }) },
  palette: { name: 'Палитра', hint: 'Цвета проекта', make: () => ({ type: 'palette', title: '', colors: [{ hex: '#000000', name: '' }] }) },
};
const MAKE = { metric: () => ({ v: '', l: '' }), step: () => ({ title: '', text: '' }), color: () => ({ hex: '#000000', name: '' }) };

const st = {
  site: null, projects: [], saved: '', dir: null, mtime: {},
  src: 'server',               // откуда открыто содержимое: 'dir' — папка, 'github' — репозиторий сайта, 'server' — копия рядом с админкой
  unpub: false,                // (папка + сайт) в папке лежит не то, что на сайте
  busy: false, pubNote: '', pubAt: '', pubSha: '',     // публикация: идёт ли, что написать в статусе, когда и какой коммит
  pending: new Map(),          // новые файлы, ещё не записанные в папку: путь → Blob
  urls: new Map(),             // путь → адрес для показа в админке и в предпросмотре
  idx: 0, tab: 'main', lang: 'ru', device: 'desktop', view: 'case',
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
}
function init(site, projects) {
  st.site = site; st.projects = projects;
  normalize();
  st.saved = snapshot();
  st.pending.clear();
  st.idx = projects.length ? 0 : -1;
  st.tab = 'main'; st.open.clear();
  st.lang = defLang();
  $('[data-gate]').hidden = true;
  $('[data-app]').hidden = false;
  renderAll();
  sendPreview(true);
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
    return { blob: file, name: `${base}.${ext || 'bin'}`, alpha: ext === 'svg', note: file.size > 15e6 ? `«${file.name}» весит ${fmtBytes(file.size)}: страница будет грузиться долго` : '' };
  }
  const bmp = await createImageBitmap(file);
  const max = Number(t.max) || 2400, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
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
    if (st.src === 'github' && gh.on && isAsset(p)) el.onerror = () => { el.onerror = null; el.src = gh.rawUrl(p); };
  });
}
async function addFiles(files, t) {
  const obj = cur();
  const folder = st.idx < 0 ? 'assets' : `assets/cases/${obj.slug || 'project'}`;
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
  return `<div class="f"><span>${esc(label)}</span><div class="color">
    <input type="color" data-path="${path}" data-kind="color" value="${/^#[0-9a-f]{6}$/i.test(v) ? v : '#ffffff'}" aria-label="${esc(label)}: выбрать цвет">
    <input type="text" class="inp" data-path="${path}" data-kind="hex"${o.optional ? ' data-optional="1"' : ''} value="${esc(v)}" placeholder="${o.optional ? 'не задан' : '#RRGGBB'}" aria-label="${esc(label)}: код цвета" spellcheck="false">
    ${o.optional && v ? `<button class="ico x" type="button" data-act="clear" data-path="${path}" aria-label="Убрать цвет">${I.x}</button>` : ''}
  </div>${o.hint ? `<small class="hint">${esc(o.hint)}</small>` : ''}</div>`;
}
function RANGE(label, path, min, max, step, unit = '') {
  const v = Number(val(path)) || 0;
  return `<label class="f"><span>${esc(label)}</span><span class="range"><input type="range" data-path="${path}" data-kind="num" min="${min}" max="${max}" step="${step}" value="${v}" data-unit="${unit}"><output>${v}${unit}</output></span></label>`;
}
function IMG(label, path, o = {}) {
  const v = val(path);
  const src = o.l ? getL(v) : (v || '');
  const kind = o.kind || 'image';
  const thumb = !src ? 'нет файла' : kind === 'file' ? 'PDF' : kind === 'video' ? `<video data-src="${esc(src)}" muted preload="metadata"></video>` : `<img data-src="${esc(src)}" alt="">`;
  const data = `data-path="${path}" data-kind="${kind}" data-max="${o.max || 2400}"${o.l ? ' data-l="1"' : ''}${o.cut ? ` data-cut="${o.cut}"` : ''}${o.fixed ? ` data-fixed="${o.fixed}"` : ''}`;
  return `<div class="imgf${o.small ? ' imgf--sm' : ''}" data-drop ${data}>
    <div class="imgf-thumb">${thumb}</div>
    <div class="imgf-main"><span class="lbl">${esc(label)}</span><span class="imgf-name">${esc(src ? src : (o.hint || ''))}</span>
      <div class="row"><button class="btn btn--line btn--sm" type="button" data-act="pick" ${data}>${src ? 'Заменить' : 'Выбрать файл'}</button>
      ${src ? `<button class="btn btn--line btn--sm" type="button" data-act="clear" data-path="${path}"${o.l ? ' data-l="1"' : ''}>Убрать</button>` : ''}</div>
    </div></div>`;
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
    color: (it, i) => `<span class="cells hex"><input type="color" data-path="${path}.${i}.hex" data-kind="color" value="${/^#[0-9a-f]{6}$/i.test(it.hex || '') ? it.hex : '#000000'}" aria-label="Цвет ${i + 1}">
      <input type="text" class="inp" data-path="${path}.${i}.hex" data-kind="hex" value="${esc(it.hex || '')}" aria-label="Код цвета ${i + 1}" spellcheck="false">
      <input type="text" class="inp" data-path="${path}.${i}.name" data-l="1" value="${esc(getL(it.name))}" placeholder="Название" aria-label="Название цвета ${i + 1}"></span>`,
  }[kind];
  const word = { metric: ['цифру', 'Добавить цифру'], step: ['шаг', 'Добавить шаг'], color: ['цвет', 'Добавить цвет'] }[kind];
  const full = kind === 'metric' && items.length >= 4;
  return `<ol class="pairs">${items.map((it, i) => `<li>${cell(it, i)}${tools(path, i, items.length, word[0])}</li>`).join('')}</ol>
    <div class="f">${full ? '<span class="hint">В ряд помещается четыре цифры.</span>' : `<button class="btn btn--line btn--sm" type="button" data-act="item-add" data-path="${path}" data-make="${kind}">${word[1]}</button>`}</div>`;
}
const SAY = (P) => F('Реплика головы', `${P}.say`, { l: 1, hint: 'Необязательно. Голова скажет её, когда блок доедет до середины экрана.' });
const WIDTH = (P) => F('Ширина', `${P}.width`, { type: 'select', options: [['text', 'В колонку текста'], ['wide', 'Широкая'], ['full', 'Во всю ширину экрана']] });

const BF = {
  text: (b, P) => F('Заголовок', `${P}.title`, { l: 1 }) + F('Текст', `${P}.text`, { l: 1, type: 'area', rows: 6, hint: 'Пустая строка — новый абзац.' }) + SAY(P),
  image: (b, P) => IMG('Картинка', `${P}.src`, { cut: `${P}.cut` }) + F('Что на картинке', `${P}.alt`, { l: 1, hint: 'Для незрячих и поисковиков.' })
    + F('Подпись', `${P}.caption`, { l: 1 }) + WIDTH(P) + CHECK('Картинка без фона — положить на подложку', `${P}.cut`) + COLOR('Цвет подложки', `${P}.bg`, { optional: 1 }) + SAY(P),
  gallery: (b, P) => F('Заголовок', `${P}.title`, { l: 1 })
    + `<div class="grid2">${F('Колонок', `${P}.columns`, { type: 'select', kind: 'num', options: [[1, '1'], [2, '2'], [3, '3'], [4, '4']] })}${F('Картинка в плитке', `${P}.fit`, { type: 'select', kind: 'opt', options: [['', 'Вписать целиком'], ['cover', 'Заполнить плитку']] })}</div>`
    + COLOR('Цвет плиток', `${P}.bg`, { optional: 1 }) + IMGLIST(`${P}.items`) + SAY(P),
  metrics: (b, P) => F('Заголовок', `${P}.title`, { l: 1 }) + PAIRS(`${P}.items`, 'metric') + SAY(P),
  quote: (b, P) => F('Цитата', `${P}.text`, { l: 1, type: 'area', rows: 4 }) + `<div class="grid2">${F('Кто сказал', `${P}.author`, { l: 1 })}${F('Должность, компания', `${P}.role`, { l: 1 })}</div>` + SAY(P),
  steps: (b, P) => F('Заголовок', `${P}.title`, { l: 1, ph: 'Как решал' }) + PAIRS(`${P}.items`, 'step') + SAY(P),
  compare: (b, P) => F('Заголовок', `${P}.title`, { l: 1 }) + IMG('До', `${P}.before.src`) + F('Что на картинке «до»', `${P}.before.alt`, { l: 1 })
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
    case 'image': return cut(txAny(b.caption) || txAny(b.alt) || fileName(b.src) || 'картинка не выбрана');
    case 'gallery': return cut(txAny(b.title)) || n(b.items, 'картинка', 'картинки', 'картинок');
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
  const c = p.theme && p.theme.color, tone = (p.theme && p.theme.tone) || toneOf(c), k = contrastOf(c, tone);
  add(c && k >= 4.5, c ? `Текст на фоне проекта читается: контраст ${k.toFixed(1)}` : 'Цвет фона проекта', 'look');
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
  const tone = p.theme.tone || toneOf(c), k = contrastOf(c, tone), word = tone === 'dark' ? 'Белый' : 'Чёрный';
  return k >= 4.5
    ? { cls: 'is-ok', html: `<i class="swatch" style="background:${esc(c)}"></i>${word} текст читается хорошо: контраст ${k.toFixed(1)}.` }
    : { cls: 'is-bad', html: `<i class="swatch" style="background:${esc(c)}"></i>${word} текст читается плохо: контраст ${k.toFixed(1)}, нужно от 4,5. ${p.theme.tone ? 'Поставьте «Подобрать автоматически» или возьмите' : 'Возьмите'} цвет ${tone === 'dark' ? 'темнее' : 'светлее'}.` };
}

// ---------- отрисовка ----------
const onSite = () => st.src === 'github' && gh.on;         // содержимое открыто с сайта и публикуется туда же
function renderBar() {
  const link = (act, text) => `<button type="button" data-act="${act}">${text}</button>`;
  const site = gh.on ? `сайт ${esc(gh.name)} ${link('gh-off', 'отключить')}` : (gh.secure ? link('gh-open', 'подключить сайт') : '');
  let src;
  if (st.dir) src = `Папка «${esc(st.dir.name)}» ${link('pick-dir', 'сменить')}`;
  else if (onSite()) src = '';
  else src = HAS_FS ? `Без папки: изменения скачиваются архивом ${link('pick-dir', 'подключить папку')}` : 'Изменения скачиваются архивом';
  $('[data-folder]').innerHTML = [src, site && (src ? site : site.replace(/^с/, 'С'))].filter(Boolean).join('<i class="sep" aria-hidden="true"></i>');
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
function renderSide() {
  $('[data-side]').innerHTML = `
    <div class="side-head"><h2>Проекты</h2><button class="btn btn--sm" type="button" data-act="new">Новый проект</button></div>
    <ol class="plist">${st.projects.map((p, i) => `
      <li class="pitem${i === st.idx ? ' is-cur' : ''}${p.published === false ? ' is-draft' : ''}" data-i="${i}" draggable="true">
        <button class="pitem-main" type="button" data-act="open" data-i="${i}"${i === st.idx ? ' aria-current="true"' : ''}>
          <span class="pitem-thumb">${p.sticker ? `<img data-src="${esc(p.sticker)}" alt="">` : ''}</span>
          <span class="pitem-text"><span class="pitem-title">${esc(txAny(p.title) || 'Без названия')}</span>
            <span class="pitem-meta">${esc(secName(p.section))}${p.year ? `, ${esc(p.year)}` : ''}${p.published === false ? ' — черновик' : ''}</span></span>
        </button>
        <span class="pitem-move"><button class="ico" type="button" data-act="up" data-i="${i}" aria-label="Поднять в списке"${i ? '' : ' disabled'}>${I.up}</button>
          <button class="ico" type="button" data-act="down" data-i="${i}" aria-label="Опустить в списке"${i < st.projects.length - 1 ? '' : ' disabled'}>${I.down}</button></span>
      </li>`).join('')}</ol>
    <button class="side-site${st.idx < 0 ? ' is-cur' : ''}" type="button" data-act="open-site">Настройки сайта<span>Имя, контакты, резюме, разделы, языки</span></button>`;
  hydrate($('[data-side]'));
}
const PANES = {
  main: (p) => `
    ${F('Название', 'title', { l: 1, ph: 'Онбординг в банке за 3 минуты' })}
    <div class="grid2">${F('Раздел', 'section', { type: 'select', options: (st.site.sections || []).map((s) => [s.id, txAny(s.label)]) })}${F('Год', 'year', { type: 'number', kind: 'num' })}</div>
    ${F('Коротко о проекте', 'summary', { l: 1, type: 'area', rows: 2, hint: 'Одна-две фразы под заголовком: что сделали и для кого.' })}
    <div class="grid2">${F('Роль', 'role', { l: 1, ph: 'Lead Product Designer' })}${F('Клиент', 'client', { l: 1, ph: 'Финтех, B2C' })}</div>
    <div class="grid2">${F('Команда', 'team', { l: 1, ph: '2 дизайнера, 6 разработчиков' })}${F('Срок', 'duration', { l: 1, ph: '4 месяца' })}</div>
    ${F('Теги', 'tags', { kind: 'list', l: 1, hint: 'Через запятую.' })}
    ${F('Адрес страницы', 'slug', { kind: 'slug', attrs: 'spellcheck="false"', hint: 'Латиницей. Кейс открывается по адресу …/#/work/адрес. Если поменять его после публикации, старые ссылки перестанут работать.' })}`,
  look: (p) => {
    const c = contrastHTML(p);
    return `
    ${IMG('Обложка', 'cover', { hint: 'Главная картинка кейса, лучше 4:3. Она же — размытый фон проекта.' })}
    ${IMG('Наклейка на папке', 'sticker', { small: 1, max: 480, hint: 'Знак или иконка проекта на прозрачном фоне: PNG или SVG.' })}
    <fieldset class="fs"><legend>Фон проекта</legend>
      <div class="grid2">${COLOR('Цвет', 'theme.color')}${F('Текст на фоне', 'theme.tone', { type: 'select', kind: 'opt', options: [['', 'Подобрать автоматически'], ['dark', 'Белый'], ['light', 'Чёрный']] })}</div>
      <p class="contrast ${c.cls}" data-contrast>${c.html}</p>
    </fieldset>
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
function sitePane() {
  const s = st.site, en = (s.languages || []).includes('en');
  const used = (id) => st.projects.some((p) => p.section === id);
  return `
    <fieldset class="fs"><legend>Кто вы</legend>
      ${F('Имя', 'name', { l: 1 })}
      ${F('Имя в родительном падеже', 'nameGen', { l: 1, hint: 'Для реплики «Привет! Я голова …».' })}
      ${F('Роль', 'role', { l: 1, ph: 'продуктовый дизайнер' })}
      ${F('Описание для поисковиков', 'description', { l: 1, type: 'area', rows: 2 })}
    </fieldset>
    <fieldset class="fs"><legend>Контакты и резюме</legend>
      <p class="hint">Почта и Telegram показываются в конце каждого кейса. Пустые поля на сайте не появляются.</p>
      <div class="grid2">${F('Почта для связи', 'email', { ph: 'hello@example.com', attrs: 'spellcheck="false"' })}${F('Telegram', 'telegram', { ph: '@username', attrs: 'spellcheck="false"' })}</div>
      ${IMG('Резюме, PDF', 'cv', { kind: 'file', l: 1, fixed: st.lang === defLang() ? 'assets/cv.pdf' : `assets/cv-${st.lang}.pdf`, hint: 'Пока файла нет, кнопка CV на сайте скрыта.' })}
      ${F('Имя файла при скачивании', 'cvFileName', { ph: 'Pavel-Nemchenko-CV.pdf', attrs: 'spellcheck="false"' })}
      ${IMG('Логотип', 'logo', { kind: 'logo', hint: 'SVG или PNG с прозрачным фоном.' })}
    </fieldset>
    <fieldset class="fs"><legend>Разделы</legend>
      <p class="hint">Папки на главной можно расставить мышью прямо в предпросмотре — положение запомнится.</p>
      ${(s.sections || []).map((sec, i) => `<fieldset class="fs"><legend>${esc(txAny(sec.label) || 'Раздел')}</legend>
        ${F('Название', `sections.${i}.label`, { l: 1 })}
        <div class="grid2">${RANGE('Наклон папки', `sections.${i}.tilt`, -20, 20, 1, '°')}${COLOR('Цвет папки', `sections.${i}.folder`, { optional: 1 })}</div>
        <div class="f">${used(sec.id) ? '<span class="hint">В разделе есть проекты — удалить его нельзя.</span>' : `<button class="btn btn--line btn--sm" type="button" data-act="sec-del" data-i="${i}">Удалить раздел</button>`}</div>
      </fieldset>`).join('')}
      <div class="f"><button class="btn btn--line btn--sm" type="button" data-act="sec-add">Добавить раздел</button></div>
    </fieldset>
    <fieldset class="fs"><legend>Пасхалка: плевки</legend>
      <p class="hint">Если посетитель долго ничего не делает, голова заплёвывает экран. Любое его действие всё стирает.</p>
      ${F('Через сколько минут бездействия', 'spitAfter', { type: 'number', kind: 'num', ph: '10', attrs: 'min="0" step="0.1" inputmode="decimal"', hint: '0 — выключить. Чтобы посмотреть, как это выглядит, поставьте 0,1 (шесть секунд) — и не забудьте вернуть.' })}
    </fieldset>
    <fieldset class="fs"><legend>Языки</legend>
      <div class="f"><label class="switch"><input type="checkbox" data-toggle="en"${en ? ' checked' : ''}><span>Английская версия сайта</span></label>
        <small class="hint">Посетитель увидит переключатель RU / EN; язык по умолчанию выбирается по домену и языку браузера. После включения переведите тексты: вверху появится выбор языка, поля без перевода покажутся по-русски.</small></div>
    </fieldset>`;
}
function renderEdit() {
  const root = $('[data-edit]');
  const keep = root.scrollTop;
  if (st.idx < 0) {
    root.innerHTML = `<div class="edit-head"><h1>Настройки сайта</h1></div><div class="pane" style="margin-top:16px">${sitePane()}</div>`;
  } else {
    const p = cur();
    const tabs = [['main', 'Основное'], ['look', 'Папка и фон'], ['results', 'Результаты'], ['blocks', `Блоки: ${(p.blocks || []).length}`]];
    root.innerHTML = `
      <div class="edit-head">
        <h1 data-h1>${esc(txAny(p.title) || 'Без названия')}</h1>
        <div class="edit-actions">
          <label class="switch"><input type="checkbox" data-path="published" data-kind="bool"${p.published !== false ? ' checked' : ''}><span>На сайте</span></label>
          <button class="btn btn--line btn--sm" type="button" data-act="dup">Дублировать</button>
          <button class="btn btn--line btn--sm" type="button" data-act="del">Удалить</button>
        </div>
      </div>
      <div class="tabs" role="tablist">${tabs.map(([id, name]) => `<button type="button" role="tab" aria-selected="${st.tab === id}" data-act="tab" data-tab="${id}">${esc(name)}</button>`).join('')}</div>
      <div class="pane">${PANES[st.tab](p)}</div>
      <div class="checks" data-checks>${checksHTML(p)}</div>`;
  }
  root.scrollTop = keep;
  hydrate(root);
}
function renderViews() {
  const list = st.idx < 0 ? [['home', 'Главная']] : [['case', 'Кейс'], ['folder', 'Папка в каталоге']];
  if (!list.some(([k]) => k === st.view)) st.view = list[0][0];
  $('[data-views]').innerHTML = list.map(([k, n]) => `<button type="button" data-act="view" data-view="${k}" aria-pressed="${k === st.view}">${n}</button>`).join('');
}
function renderAll() { renderBar(); renderSide(); renderEdit(); renderViews(); fitFrame(); }

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
const previewHash = () => (st.idx < 0 ? '#/' : st.view === 'folder' ? '#/work' : `#/work/${encodeURIComponent(cur().slug || '')}`);
async function sendPreview(reload) {
  if (!st.site) return;
  const frame = $('[data-frame]');
  try { localStorage.setItem('ph:draft', JSON.stringify(await draftForPreview())); } catch (_) { /* noop */ }
  const hash = previewHash();
  const focus = st.idx >= 0 && st.view === 'folder' ? cur().slug : null;
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
  wrap.classList.toggle('is-phone', st.device === 'phone');
  if (st.device === 'phone') {
    const w = 390, h = Math.min(H - 40, 844);
    frame.style.cssText = `width:${w}px;height:${h}px;left:${Math.round((W - w) / 2)}px;top:20px;transform:none`;
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
    pubNote('Отправлено. Сайт пересобирается…');
    toast('Отправлено. Правки появятся на сайте через минуту-две');
    watchDeploy(res.sha);
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
// ждём, пока GitHub выложит коммит; работать в админке это не мешает
async function watchDeploy(sha) {
  const state = await gh.deployed(sha).catch(() => 'unknown');
  if (st.pubSha !== sha) return;                 // за это время опубликовали что-то новее — отчитается та публикация
  if (state === 'done') { st.pubAt = `Опубликовано в ${clock()}`; pubNote(''); toast('Опубликовано: правки уже на сайте'); }
  else if (state === 'failed') { st.pubAt = ''; pubNote('GitHub не собрал сайт'); toast('GitHub не смог собрать сайт. Причина видна в репозитории на вкладке Actions'); }
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
function openProject(i) { st.idx = i; st.open.clear(); st.menu = false; if (i < 0) st.tab = 'main'; renderSide(); renderEdit(); renderViews(); sendPreview(false); }
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
const targetOf = (el) => ({ path: el.dataset.path, kind: el.dataset.kind || 'image', max: el.dataset.max, cut: el.dataset.cut, dims: el.dataset.dims, fixed: el.dataset.fixed, l: !!el.dataset.l });
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
    if (st.site) renderBar(); else gateButtons();
    toast('Сайт отключён, токен удалён из этого браузера');
  },
  new() { st.projects.unshift(newProject()); st.tab = 'main'; openProject(0); changed('title'); const t = $('[data-path="title"]'); if (t) { t.focus(); t.select(); } },
  open(el) { openProject(Number(el.dataset.i)); },
  'open-site'() { openProject(-1); },
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
  const path = el.dataset.path;
  if (!path || el.type === 'file') return;
  const obj = cur(), kind = el.dataset.kind || '';
  let v = el.value;
  if (kind === 'bool') v = el.checked;
  else if (kind === 'num') v = el.value === '' ? '' : Number(el.value);
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
  if (path === 'title' && autoSlug.has(obj)) {
    obj.slug = uniqueSlug(slugify(txAny(obj.title)) || 'project', obj);
    const s = $('[data-path="slug"]');
    if (s) s.value = obj.slug;
  }
  if (el.type === 'range') { const out = el.parentNode.querySelector('output'); if (out) out.textContent = `${el.value}${el.dataset.unit || ''}`; }
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

// ---------- старт ----------
function gateError(text) { const el = $('[data-gate-error]'); el.textContent = text; el.hidden = false; }
async function start() {
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
start();
