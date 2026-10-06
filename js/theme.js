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

// Размытая обложка для фона. Размывать её стилями (filter: blur на слой во весь экран) дорого: на телефонах смена фона
// заметно подтормаживала. Поэтому обложка один раз уменьшается до крошечной картинки и размывается здесь же, по пикселям;
// растянутая на весь экран, она выглядит так же мягко, а браузеру почти ничего не стоит. Заодно чуть поднята насыщенность.
const soft = new Map();     // адрес обложки → Promise с адресом её размытой копии
export function softImage(src) {
  const url = abs(String(src));
  if (!soft.has(url)) soft.set(url, new Promise((done) => {
    const im = new Image();
    im.decoding = 'async';
    im.onerror = () => done('');
    im.onload = () => {
      try {
        const w = 72, h = Math.max(8, Math.min(160, Math.round((w * im.naturalHeight) / (im.naturalWidth || 1))));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const x = c.getContext('2d');
        x.drawImage(im, 0, 0, w, h);
        const img = x.getImageData(0, 0, w, h), d = img.data, t = new Float32Array(d.length);
        // три прохода усреднения по соседям (сначала по строкам, потом по столбцам) — на глаз то же, что размытие по Гауссу
        const pass = (from, to, n, m, stepN, stepM, r) => {
          for (let j = 0; j < m; j++) for (let ch = 0; ch < 3; ch++) {
            let sum = 0;
            const at = (i) => from[j * stepM + Math.max(0, Math.min(n - 1, i)) * stepN + ch];
            for (let i = -r; i <= r; i++) sum += at(i);
            for (let i = 0; i < n; i++) { to[j * stepM + i * stepN + ch] = sum / (2 * r + 1); sum += at(i + r + 1) - at(i - r); }
          }
        };
        const a = Float32Array.from(d);
        for (let k = 0; k < 3; k++) { pass(a, t, w, h, 4, w * 4, 3); pass(t, a, h, w, w * 4, 4, 3); }
        for (let i = 0; i < d.length; i += 4) {
          const g = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
          for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.max(0, Math.min(255, g + (a[i + ch] - g) * 1.3));
          d[i + 3] = 255;
        }
        x.putImageData(img, 0, 0);
        c.toBlob((b) => done(b ? URL.createObjectURL(b) : ''), 'image/png');
      } catch (_) { done(''); }                      // холст недоступен — фон останется просто цветным
    };
    im.src = url;
  }));
  return soft.get(url);
}
const paint = (el, th) => {
  el.dataset.tone = th.tone || toneOf(th.color);
  el.style.setProperty('--c', th.color || '#fff');
  el.style.setProperty('--img', 'none');
  const want = el.dataset.img = th.image ? abs(String(th.image)) : '';
  if (want) softImage(want).then((u) => { if (u && el.dataset.img === want) el.style.setProperty('--img', `url("${u}")`); });
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
    below.style.cssText = above.style.cssText; below.dataset.tone = above.dataset.tone || ''; below.dataset.img = above.dataset.img || '';
    below.style.transition = 'none'; below.classList.add('is-on');
    above.style.transition = 'none'; above.classList.remove('is-on');
    void above.offsetWidth;
    below.style.transition = ''; above.style.transition = '';
  }
  paint(above, theme);
  above.classList.add('is-on');
}

// картинка фона — малая копия обложки (её делает админка): размывать всё равно до крошечной, большая тут ни к чему
export const themeOf = (p) => (p && p.theme && p.theme.color ? { color: p.theme.color, tone: p.theme.tone, image: p.theme.image || p.thumb || p.cover || '' } : null);
