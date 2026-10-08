// Лайки проектов.
// Что отметил этот посетитель — помнит его браузер (localStorage, ph:likes): сердечко на карточке видит только он сам,
// и только на тех проектах, которые лайкнул.
// Сколько лайков всего — считает свой счётчик (облачная функция, см. server/likes/README.md). Его адрес задаётся
// в админке («Настройки сайта» → «Лайки»), в содержимом это site.likesApi. Пока адреса нет, лайки живут только у посетителя.
// Счётчику уходит только адрес проекта и «+1» или «−1» — ни адресов, ни меток посетителя.
import { content } from './content.js';

const KEY = 'ph:likes';
const read = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter((s) => typeof s === 'string') : []; } catch (_) { return []; } };
const mine = new Set(read());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...mine])); } catch (_) { /* приватный режим: лайк проживёт до закрытия вкладки */ } };

// адрес счётчика: только https, без хвостового «/»
export function likesApi(site = content.site) {
  const u = site && typeof site.likesApi === 'string' ? site.likesApi.trim() : '';
  return /^https:\/\/[^\s]+$/i.test(u) ? u.replace(/\/+$/, '') : '';
}

export const liked = (slug) => mine.has(slug);

// поставить или снять лайк; возвращает новое состояние
export function toggleLike(slug) {
  const on = !mine.has(slug);
  if (on) mine.add(slug); else mine.delete(slug);
  save();
  send(slug, on ? 1 : -1);
  return on;
}

// Простой запрос (text/plain) — браузеру не нужно сперва спрашивать у счётчика разрешения (CORS-предзапрос),
// а sendBeacon доносит его, даже если посетитель тут же ушёл со страницы.
function send(slug, d) {
  const url = likesApi();
  if (!url || content.preview) return;
  const body = JSON.stringify({ slug, d });
  try { if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return; } catch (_) { /* ниже — обычный запрос */ }
  fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true, mode: 'cors', credentials: 'omit' }).catch(() => {});
}

// Сколько лайков у каждого проекта: { slug: число }. Нужен админке.
export async function likeCounts(url) {
  const r = await fetch(url, { cache: 'no-store', mode: 'cors', credentials: 'omit' });
  if (!r.ok) throw new Error(`счётчик ответил ${r.status}`);
  const j = await r.json();
  const out = {};
  for (const [k, v] of Object.entries(j && typeof j === 'object' ? (j.likes || j) : {})) if (Number.isFinite(Number(v))) out[k] = Number(v);
  return out;
}
