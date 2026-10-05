// Фон «в стиле проекта» — как на домашнем экране PlayStation: при наведении на проект страница
// перекрашивается в его цвет с размытой обложкой, а интерфейс меняет тон (чёрный ↔ белый).
const root = document.querySelector('[data-bg]');
const [below, above] = root ? [...root.children] : [];
const meta = document.querySelector('meta[name="theme-color"]');
let key = '';

// светлый или тёмный фон: по относительной яркости цвета
export function toneOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 'light';
  const n = parseInt(m[1], 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L < 0.179 ? 'dark' : 'light';      // граница, на которой белый и чёрный текст читаются одинаково
}
// контраст текста выбранного тона с цветом фона (WCAG): для обычного текста нужно не меньше 4,5
export function contrastOf(hex, tone) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 21;
  const n = parseInt(m[1], 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return tone === 'dark' ? 1.05 / (L + 0.05) : (L + 0.05) / 0.05;
}

// Адрес картинки делаем полным: url() внутри переменной браузер иначе считает от папки со стилями
const abs = (src) => { try { return new URL(src, document.baseURI).href; } catch (_) { return src; } };
const paint = (el, th) => {
  el.dataset.tone = th.tone || toneOf(th.color);
  el.style.setProperty('--c', th.color || '#fff');
  el.style.setProperty('--img', th.image ? `url("${abs(String(th.image)).replace(/"/g, '%22')}")` : 'none');
};

// theme: { color, tone?, image? } или null — вернуть белый лист
export function setTheme(theme) {
  const k = theme ? `${theme.color}|${theme.image || ''}|${theme.tone || ''}` : '';
  if (k === key) return;
  const prev = key;
  key = k;
  document.body.dataset.tone = theme ? (theme.tone || toneOf(theme.color)) : 'light';
  if (meta) meta.content = theme ? theme.color : '#FFFFFF';
  document.body.style.setProperty('--theme-c', theme ? theme.color : '#FFFFFF');     // цвет фона — для дымки под шапкой каталога
  if (!root) return;
  if (!theme) { below.classList.remove('is-on'); above.classList.remove('is-on'); return; }
  // новый фон проявляется верхним слоем поверх прежнего — без провала в белый
  if (prev) {
    below.style.cssText = above.style.cssText; below.dataset.tone = above.dataset.tone || '';
    below.style.transition = 'none'; below.classList.add('is-on');
    above.style.transition = 'none'; above.classList.remove('is-on');
    void above.offsetWidth;
    below.style.transition = ''; above.style.transition = '';
  }
  paint(above, theme);
  above.classList.add('is-on');
}

export const themeOf = (p) => (p && p.theme && p.theme.color ? { color: p.theme.color, tone: p.theme.tone, image: p.theme.image || p.cover || '' } : null);
