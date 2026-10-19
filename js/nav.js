// Адреса экранов и переходы между ними без перезагрузки страницы.
// На сайте адреса — обычные пути: /, /work/, /work/<адрес проекта>/, /archive/ (у каждого есть свой файл для
// поисковиков, см. js/seo.js). Переходы — через History API: адрес меняется, страница не перезагружается.
// Предпросмотр в админке живёт по-старому, на #/… : сам документ там — /index.html?preview=1, его адрес не трогаем.
// Старые ссылки вида pnemchenko.ru/#/work/svoi-dengi сами превращаются в pnemchenko.ru/work/svoi-dengi/.
import { content } from './content.js';
import { paths } from './seo.js';

export { paths };

let router = () => {};
export const onRoute = (fn) => { router = fn; };

const dec = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };
// пути экранов сайта (а не файлов, админки или чужих сайтов)
const SCREEN = /^\/(?:index\.html|(?:work|archive)(?:\/[^/]+)*\/?)?$/;

// Ссылка ведёт на экран сайта? Тогда — её адрес (URL), иначе null
export function screenUrl(href) {
  let h = String(href || '').trim();
  if (!h) return null;
  if (h.startsWith('#/')) h = h.slice(1);              // прежние ссылки: #/work/… → /work/…
  else if (h.startsWith('#')) return null;             // якорь внутри страницы
  let u;
  try { u = new URL(h, document.baseURI); } catch (_) { return null; }
  if (u.origin !== location.origin || !SCREEN.test(u.pathname)) return null;
  if (u.pathname === '/index.html') u.pathname = '/';
  else if (!u.pathname.endsWith('/')) u.pathname += '/';      // /work/svoi-dengi → /work/svoi-dengi/
  return u;
}

// Где мы: части пути и параметры (?cat=…)
export function where() {
  if (content.preview) {
    const [p, q] = location.hash.replace(/^#\/?/, '').split('?');
    return { parts: p.split('/').filter(Boolean).map(dec), params: new URLSearchParams(q || '') };
  }
  return { parts: location.pathname.split('/').filter(Boolean).map(dec).filter((x) => x !== 'index.html'), params: new URLSearchParams(location.search) };
}

// Перейти на экран. replace — без новой записи в истории (кнопка «назад» её пропустит)
export function go(href, { replace = false } = {}) {
  const u = screenUrl(href);
  if (!u) { location.href = href; return; }
  if (content.preview) {
    const h = `#${u.pathname.replace(/(.)\/$/, '$1')}${u.search}`;
    if (location.hash === h) return;
    if (replace) { history.replaceState(null, '', h); router(); } else location.hash = h;      // hashchange → router
    return;
  }
  const next = u.pathname + u.search;
  if (next === location.pathname + location.search && !location.hash) return;      // уже здесь
  history[replace ? 'replaceState' : 'pushState'](null, '', next);
  router();
}

// Адрес при открытии страницы: старые #/… → путь, /work → /work/, /index.html → /
export function tidyUrl() {
  if (content.preview) return;
  let path = location.pathname, search = location.search;
  if (location.hash.startsWith('#/')) {
    const [p, q] = location.hash.slice(1).split('?');
    path = p;
    if (q) { const sp = new URLSearchParams(search); new URLSearchParams(q).forEach((v, k) => sp.set(k, v)); search = sp.toString() ? `?${sp}` : ''; }
  } else if (location.hash) return;                     // обычный якорь — не трогаем
  const u = screenUrl(path + search);
  if (!u) return;
  const next = u.pathname + u.search;
  if (next !== location.pathname + location.search || location.hash) history.replaceState(null, '', next);
}

// Ссылки на экраны сайта открываются без перезагрузки; с Ctrl/⌘, средней кнопкой, в новой вкладке — как обычно
export function interceptLinks() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const u = screenUrl(a.getAttribute('href'));
    if (!u) return;
    e.preventDefault();
    go(u.pathname + u.search);
  });
  if (content.preview) window.addEventListener('hashchange', () => router());
  else {
    window.addEventListener('popstate', () => router());
    // кто-то вписал в адрес старое #/… — переводим на путь
    window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/')) { tidyUrl(); router(); } });
  }
}
