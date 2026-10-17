// Свой счётчик посещений — без cookie и без сторонних скриптов. События визита (главная, кейс, резюме, контакт…)
// копятся и раз в несколько секунд уходят пачкой в ту же облачную функцию, что хранит архив полароидов
// (server/polaroids, POST ?hit=1). Отчёт смотрят в админке: «Статистика».
//
// Что уходит: id визита (случайный, живёт в sessionStorage до закрытия вкладки или 30 минут тишины), откуда пришли
// (адрес ссылки ?from=… или сайт-источник без пути), тип устройства, система, браузер, размер экрана, часовой пояс и язык.
// IP и строку браузера функция не хранит. Свои заходы владелец не считает: админка помечает браузер (ph:me),
// на телефоне — один раз открыть сайт с ?me=1 (?me=0 — снова считать).
import { content } from './content.js';
import { polaroidsApi } from './polaroids.js';

const ME = 'ph:me', VISIT = 'ph:visit', IDLE = 30 * 60e3;
const ls = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* нет памяти — не страшно */ } } };
const ss = { get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (_) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* приватный режим */ } } };
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);

const params = new URLSearchParams(location.search);
if (params.has('me')) ls.set(ME, params.get('me') === '0' ? null : '1');
const off = () => content.preview || ls.get(ME) === '1' || /^(localhost|127\.|\[::1\])/.test(location.hostname) || navigator.webdriver;

// ---------- устройство: грубо, без отпечатка ----------
function device() {
  const ua = navigator.userAgent || '', touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const dev = /iPad|Tablet/.test(ua) || touchMac || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet'
    : /Mobi|iPhone|iPod|Android/.test(ua) ? 'phone' : 'desktop';
  const os = /iPhone|iPod/.test(ua) ? 'iOS' : /iPad/.test(ua) || touchMac ? 'iPadOS' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /YaBrowser|YaSearchBrowser/.test(ua) ? 'Яндекс Браузер' : /Edg[A/]/.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Telegram/i.test(ua) ? 'Telegram'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const s = window.screen || {};
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { /* старый браузер */ }
  return { dev, os, br, scr: s.width && s.height ? `${s.width}×${s.height}` : '', tz, lang: (navigator.language || '').split('@')[0].slice(0, 10) };
}
// Встроенные браузеры приложений подписываются в строке браузера — по ним видно, откуда пришли, даже когда
// приложение не передаёт адрес-источник (Instagram, LinkedIn, Telegram на Android, Facebook, ВКонтакте)
function appOf(ua) {
  if (/Instagram/.test(ua)) return 'instagram.com';
  if (/LinkedInApp/i.test(ua)) return 'linkedin.com';
  if (/Telegram/i.test(ua) || window.TelegramWebviewProxy) return 't.me';
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return 'facebook.com';
  if (/VKClient|VKAndroidApp|com\.vkontakte/i.test(ua)) return 'vk.com';
  return '';
}
// служебные адреса переходов → сама площадка
const HOP = [[/(^|\.)l\.instagram\.com$|^instagram\.com$/, 'instagram.com'], [/^lnkd\.in$|linkedin\.com$/, 'linkedin.com'], [/^t\.me$|telegram\.org$/, 't.me'], [/^l\.facebook\.com$|^m\.facebook\.com$/, 'facebook.com'], [/^away\.vk\.com$|^m\.vk\.com$/, 'vk.com']];
// откуда: своя ссылка ?from= (или utm_source) важнее сайта-источника; источник — только домен, без пути;
// нет источника — приложение, в чьём браузере открыли сайт
function source() {
  const from = (params.get('from') || params.get('utm_source') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  let ref = '';
  try { const h = new URL(document.referrer).hostname.replace(/^www\./, ''); if (h && h !== location.hostname.replace(/^www\./, '')) ref = h; } catch (_) { /* прямой заход */ }
  for (const [re, name] of HOP) if (re.test(ref)) { ref = name; break; }
  if (!ref) ref = appOf(navigator.userAgent || '');
  return { from, ref };
}

// ---------- визит ----------
let visit = null;
function getVisit() {
  const now = Date.now();
  const v = ss.get(VISIT);
  if (v && v.id && now - v.at < IDLE) { v.at = now; ss.set(VISIT, v); return (visit = v); }
  const src = source();
  visit = { id: rid(), at: now, x: { ...src, ...device(), ui: content.lang } };
  for (const k of Object.keys(visit.x)) if (!visit.x[k]) delete visit.x[k];
  ss.set(VISIT, visit);
  return visit;
}
// ссылку ?from= после первого захода убираем из адреса: поделятся страницей — чужой визит не припишется к отклику
if (params.has('from') || params.has('me')) {
  try { const u = new URL(location.href); u.searchParams.delete('from'); u.searchParams.delete('me'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (_) { /* пусть остаётся */ }
}

// ---------- события ----------
// события сайта (track в app.js) → короткие имена счётчика; остальные не отправляем
const MAP = {
  view_home: 'home', view_catalog: 'catalog', open_project: 'case', view_archive: 'archive', cv_download: 'cv', contact: 'contact',
  like: 'like', polaroid_saved: 'polaroid', folder_open: 'folder', glasses_off: 'glasses', spit_done: 'spit', tilt_start: 'tilt', vcard_dock: 'dock',
};
let queue = [], timer = 0, sent = false;
// время: сколько активно (вкладка видна) и сколько на каждом кейсе
let shown = document.visibilityState !== 'hidden' ? Date.now() : 0, act = 0, curCase = '', caseAt = 0;
const dwell = {};
const tick = () => {
  const now = Date.now();
  if (shown) { act += now - shown; shown = now; }
  if (curCase && caseAt) { dwell[curCase] = (dwell[curCase] || 0) + (now - caseAt); caseAt = shown ? now : 0; }
};

export function stat(event, props = {}) {
  const e = MAP[event];
  if (!e || off()) return;
  tick();
  if (e === 'case') { curCase = props.slug || ''; caseAt = shown ? Date.now() : 0; }
  else if (['home', 'catalog', 'archive'].includes(e)) { curCase = ''; caseAt = 0; }
  if (e === 'case' && dwell[props.slug] === undefined) dwell[props.slug] = 0;
  const o = { e, at: Date.now() };
  if (props.slug) o.s = props.slug;
  if (props.via) o.via = props.via;
  if (props.section) o.sec = props.section;
  if (props.cat) o.sec = props.cat;
  if (e === 'like') o.on = props.on ? 1 : 0;
  queue.push(o);
  clearTimeout(timer);
  timer = setTimeout(() => flush(false), sent ? 5000 : 1500);
}

function flush(final) {
  const api = polaroidsApi();
  if (!api || off() || (!queue.length && !final)) return;
  tick();
  const v = visit && Date.now() - visit.at < IDLE ? visit : getVisit();
  v.at = Date.now(); ss.set(VISIT, v);
  const now = Date.now();
  const ev = queue.splice(0, 60).map(({ at, ...o }) => ({ ...o, a: now - at }));
  if (final) ev.push({ e: 'end', a: 0, act: Math.round(act / 1000), c: Object.fromEntries(Object.entries(dwell).map(([k, ms]) => [k, Math.round(ms / 1000)])) });
  if (!ev.length) return;
  const body = JSON.stringify({ v: v.id, x: v.x, ev });
  const url = `${api}?hit=1`;
  sent = true;
  // text/plain — простой запрос: браузеру не нужен предварительный CORS-запрос, а sendBeacon доходит и при закрытии вкладки
  try {
    if (final && navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
  } catch (_) { /* ниже — обычный запрос */ }
  fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, mode: 'cors', credentials: 'omit', keepalive: true }).catch(() => { /* нет сети — событие потеряно, не страшно */ });
}

// вкладку спрятали или закрывают — отправляем всё и итог: сколько времени и где
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { tick(); shown = 0; caseAt = 0; flush(true); }
  else { shown = Date.now(); if (curCase) caseAt = shown; }
});
window.addEventListener('pagehide', () => { if (shown) { tick(); shown = 0; flush(true); } });

// для админки: этот браузер — владельца, его заходы не считаем
export const markOwner = (on = true) => ls.set(ME, on ? '1' : null);
export const isOwner = () => ls.get(ME) === '1';
