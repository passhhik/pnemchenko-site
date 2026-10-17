// Архив полароидов: хранилище и связь с ним.
// Общий архив — облачная функция (server/polaroids, как её завести — README.md там же). Её адрес задаётся в админке
// («Настройки» → «Архив полароидов и статистика»), в содержимом это site.polaroidsApi. Пока адреса нет, карточки живут только в браузере
// посетителя (localStorage, ph:pol): в архиве их видит лишь он сам.
// Своя карточка сначала ложится в браузер и уходит в архив в фоне; не ушла (нет сети, архив молчит) — уйдёт при
// следующем заходе. Ушла — картинка из браузера стирается, остаётся только id: по нему архив помечает «вашу» карточку.
import { content } from './content.js';
import { STICKER_ID } from './stickers.js';

// Подпись — сколько влезет в две строки шириной с фото (это решает редактор, js/polaroid.js); здесь — потолок на всякий случай
export const CAPTION_MAX = 80;
export const STICKERS_MAX = 12;
const KEY = 'ph:pol';

export function polaroidsApi(site = content.site) {
  const u = site && typeof site.polaroidsApi === 'string' ? site.polaroidsApi.trim() : '';
  return /^https:\/\/[^\s?#]+$/i.test(u) ? u.replace(/\/+$/, '') : '';
}
export const imgUrl = (api, id) => `${api}?img=${encodeURIComponent(id)}`;

const num = (v, a, b) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : null; };
// подпись и наклейки — такие же проверки, как у функции архива
export const cleanCaption = (s) => [...String(s || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, CAPTION_MAX).join('');
export function cleanStickers(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || !STICKER_ID.test(String(p.e || ''))) continue;
    const x = num(p.x, 0, 1), y = num(p.y, 0, 1), r = num(p.r, -45, 45);
    if (x === null || y === null) continue;
    out.push({ e: String(p.e), x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, r: Math.round(r || 0) });
    if (out.length >= STICKERS_MAX) break;
  }
  return out;
}
function cleanItem(it) {
  if (!it || typeof it.id !== 'string' || !/^[a-z0-9]{6,32}$/.test(it.id)) return null;
  return { id: it.id, c: cleanCaption(it.c), s: cleanStickers(it.s), t: Number(it.t) || 0, h: it.h ? 1 : 0, f: it.f ? 1 : 0 };      // h — скрыта, f — скрыта проверкой на мат (видно только модератору)
}

// ---------- общий архив ----------
// Страница архива: { items, next } — next передаётся в before, чтобы получить следующую. key — ключ модератора (админка)
export async function fetchList(api, { before = '', n = 24, key = '', all = false } = {}) {
  const q = new URLSearchParams({ [all ? 'all' : 'list']: '1', n: String(n) });
  if (before) q.set('before', before);
  const r = await fetch(`${api}?${q}`, { cache: 'no-store', mode: 'cors', credentials: 'omit', headers: key ? { 'x-mod-key': key } : {} });
  if (!r.ok) { const e = new Error(`архив ответил ${r.status}`); e.status = r.status; throw e; }
  const j = await r.json();
  return { items: (Array.isArray(j.items) ? j.items : []).map(cleanItem).filter(Boolean), next: typeof j.next === 'string' ? j.next : '' };
}

// ---------- своя карточка в браузере ----------
// Карточка одна на человека. Новая заменяет прошлую: в архив она уходит вместе с секретом прошлой (его выдаёт функция
// при сохранении, в браузере он лежит в mine), и функция прошлую удаляет. Пока новая не ушла, она лежит здесь с картинкой
// (pending) и в архиве видна только автору.
const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!v || typeof v !== 'object') return { pending: null, mine: null };
    if (Array.isArray(v.items)) {                        // ранняя версия хранилища: берём последнюю неотправленную
      const last = v.items.filter((x) => x && x.img && !x.dead).pop() || null;
      return { pending: last, mine: null };
    }
    return { pending: v.pending && v.pending.img ? v.pending : null, mine: v.mine && v.mine.id ? v.mine : null };
  } catch (_) { return { pending: null, mine: null }; }
};
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch (_) { return false; } };
const changed = () => { try { window.dispatchEvent(new CustomEvent('ph:polaroids')); } catch (_) { /* noop */ } };

// своя карточка, которая ещё не ушла в общий архив (с картинкой) — для архива и кружка
export const localPolaroids = () => { const p = read().pending; return p ? [p] : []; };
// id своей карточки в общем архиве
export const myIds = () => { const m = read().mine; return new Set(m ? [m.id] : []); };
// у посетителя уже есть карточка — новая её заменит
export const hasPolaroid = () => { const v = read(); return !!(v.pending || v.mine); };

const toDataUrl = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });

// Новая карточка: в браузер — сразу (прошлая неотправленная просто заменяется), в общий архив — в фоне
export async function savePolaroid({ blob, c, s }) {
  const img = await toDataUrl(blob);
  const v = read();
  v.pending = { lid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), img, c: cleanCaption(c), s: cleanStickers(s), t: Date.now() };
  if (!write(v)) { v.pending.img = ''; }                  // приватный режим без места: карточка всё равно уйдёт, если архив подключён
  changed();
  flush(v);
  return v.pending;
}

let flushing = null;
// Свежие карточки общего архива — для кружка «Архив» (см. latestPhotos). Последний список помним и в браузере
// (ph:pol-recent): при следующем заходе превью встают сразу, а их картинки браузер берёт из своего кэша
// (функция отдаёт их «навсегда»); свежий список приходит следом и, если что-то поменялось, подменяет превью.
const RECENT = 'ph:pol-recent';
let recent = (() => {
  try { const v = JSON.parse(localStorage.getItem(RECENT) || 'null'); if (v && Array.isArray(v.list)) return { at: 0, list: v.list.filter((x) => x && typeof x.id === 'string').slice(0, 4), stale: true }; } catch (_) { /* нет памяти */ }
  return { at: 0, list: [] };
})();
const keepRecent = () => { try { localStorage.setItem(RECENT, JSON.stringify({ list: recent.list.slice(0, 4).map(({ id, s }) => ({ id, s })) })); } catch (_) { /* не запомнится */ } };
let warming = null;
// список свежих карточек — заранее, пока голова ещё собирается: это маленький ответ, а функция успеет проснуться
export function warmRecent() {
  const api = polaroidsApi();
  if (!api || content.preview || warming || Date.now() - recent.at < 60000) return warming || Promise.resolve();
  warming = fetchList(api, { n: 4 }).then((r) => { recent = { at: Date.now(), list: r.items }; keepRecent(); }, () => { recent.at = Date.now(); })
    .finally(() => { warming = null; });
  return warming;
}
// Отправить свою карточку в общий архив. Отказ «по делу» (картинка битая) — карточка остаётся только у автора;
// нет сети или архив перегружен — попробуем при следующем заходе
export function flush(mem = null) {
  const api = polaroidsApi();
  if (!api || content.preview || flushing) return flushing || Promise.resolve();
  flushing = (async () => {
    const v0 = mem || read(), it = v0.pending;
    if (!it || !it.img || it.dead) return;
    try {
      const res = await post(api, it, v0.mine);
      const id = String(res.id || ''), key = String(res.key || '');
      const v = read();
      if (v.pending && v.pending.lid !== it.lid) return;    // пока отправляли, сделали новую — она уйдёт следующей
      const old = v0.mine && v0.mine.id;
      v.pending = null;
      if (/^[a-z0-9]{6,32}$/.test(id)) v.mine = { id, key };
      write(v);
      // карточка уже в общем архиве — в кружок «Архив» она встаёт сразу (скрытая проверкой — нет), прошлая уходит
      recent.list = recent.list.filter((x) => x.id !== old && x.id !== id);
      if (id && !res.hidden) recent.list.unshift({ id, s: it.s });
      keepRecent();
      changed();
    } catch (e) {
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 408) {
        const v = read();
        if (v.pending && v.pending.lid === it.lid) { v.pending.dead = 1; write(v); }
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
async function post(api, it, mine) {
  const img = String(it.img), i = img.indexOf(',');
  const body = { img: img.slice(i + 1), c: it.c, s: it.s };
  if (mine && mine.id && mine.key) body.replace = { id: mine.id, key: mine.key };
  // простой запрос (text/plain): браузеру не нужен предварительный CORS-запрос
  const r = await fetch(api, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'text/plain' }, mode: 'cors', credentials: 'omit' });
  if (!r.ok) { const e = new Error(`архив ответил ${r.status}`); e.status = r.status; throw e; }
  return r.json();
}

// Две свежие карточки — для кружка «Архив» на главной: { src, s } — фото и наклейки. Сначала свои неотправленные,
// потом общий архив (его — раз в минуту). cached — без сети: что запомнено с прошлого раза
export async function latestPhotos(n = 2, fresh = false, cached = false) {
  const out = localPolaroids().map((it) => ({ src: it.img, s: it.s || [] }));
  const api = polaroidsApi();
  if (out.length < n && api && !content.preview) {
    if (!cached && (fresh || Date.now() - recent.at > 60000)) {
      if (fresh) recent.at = 0;
      await warmRecent();
    }
    for (const it of recent.list) if (out.length < n) out.push({ src: imgUrl(api, it.id), s: it.s || [] });
  }
  return out.slice(0, n);
}

// ---------- модерация (админка) ----------
// Ключ — в заголовке X-Mod-Key, не в Authorization: тот Cloud Functions проверяет как IAM-токен и до функции не пускает
async function modFetch(url, key, opts = {}) {
  const r = await fetch(url, { ...opts, cache: 'no-store', mode: 'cors', credentials: 'omit', headers: { 'x-mod-key': key } });
  if (!r.ok) { const e = new Error(r.status === 401 || r.status === 403 ? 'ключ модератора не подошёл' : `архив ответил ${r.status}`); e.status = r.status; throw e; }
  return r;
}
// скрыть (hidden = true) или вернуть карточку
export const setHidden = (api, key, id, hidden) => modFetch(`${api}?hide=${encodeURIComponent(id)}&v=${hidden ? 1 : 0}`, key, { method: 'POST' }).then((r) => r.json());
// удалить совсем
export const removePolaroid = (api, key, id) => modFetch(`${api}?del=${encodeURIComponent(id)}`, key, { method: 'POST' }).then((r) => r.json());
// картинка скрытой карточки отдаётся только с ключом — поэтому через fetch, а не <img src>
export const modImage = (api, key, id) => modFetch(imgUrl(api, id), key).then((r) => r.blob()).then((b) => URL.createObjectURL(b));
