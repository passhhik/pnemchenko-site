// Фон «в стиле проекта» — как на домашнем экране PlayStation: при наведении на проект страница
// перекрашивается в его цвет с размытой обложкой, а интерфейс меняет тон (чёрный ↔ белый).
const root = document.querySelector('[data-bg]');
const [below, above] = root ? [...root.children] : [];
const meta = document.querySelector('meta[name="theme-color"]');
let key = '';

// ---------- контраст: правило сайта, где текст светлый, а где тёмный ----------
// Считаем по APCA — методу из черновика WCAG 3. Старая формула WCAG 2 на насыщенных средних цветах (синий, оранжевый,
// красный, фиолетовый) ошибается в пользу чёрного текста, хотя глаз читает там белый не хуже, а чёрный выглядит грязным.
// APCA учитывает, как глаз видит яркие цвета и что светлое на тёмном читается иначе, чем тёмное на светлом.
// Lc — «сила» контраста: 90 — для мелкого текста, 75 — основной текст, 60 — текст от 18–24 px (описание проекта),
// 45 — крупные заголовки, 30 — на грани читаемости.
//
// Правило: на фоне проекта текст светлый, если он набирает хотя бы Lc 45 и читается не хуже тёмного — с форой
// в 5 единиц в пользу светлого. Иначе текст тёмный. Описание (вторичный цвет — основной на 70%) остаётся полупрозрачным,
// только если и так набирает Lc 60; иначе оно того же цвета, что заголовок. Тёмная кнопка на почти чёрном фоне
// становится светлой (buttonLight). В админке тон текста можно поставить вручную.
export const LC_HEAD = 45, LC_TEXT = 60, LIGHT_EDGE = 5, LC_UI = 15;
const rgbOf = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const yOf = ([r, g, b]) => 0.2126729 * (r / 255) ** 2.4 + 0.7151522 * (g / 255) ** 2.4 + 0.072175 * (b / 255) ** 2.4;
// контраст текста fg на фоне bg (APCA-W3 0.0.98G): плюс — тёмный на светлом, минус — светлый на тёмном
export function apca(fg, bg) {
  const f = Array.isArray(fg) ? fg : rgbOf(fg), b = Array.isArray(bg) ? bg : rgbOf(bg);
  if (!f || !b) return 0;
  const soft = (y) => (y > 0.022 ? y : y + (0.022 - y) ** 1.414);
  const yt = soft(yOf(f)), yb = soft(yOf(b));
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) { const c = (yb ** 0.56 - yt ** 0.57) * 1.14; return c < 0.1 ? 0 : (c - 0.027) * 100; }
  const c = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return c > -0.1 ? 0 : (c + 0.027) * 100;
}
// цвет текста в токенах сайта (их можно поменять в админке): основной на светлом фоне и на тёмном
export const inkOf = (tone) => {
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(tone === 'dark' ? '--ink-dark' : '--ink').trim() : '';
  return /^#[0-9a-f]{6}$/i.test(v) ? v : tone === 'dark' ? '#F4F6F6' : '#1D1D1F';
};
// насколько читается светлый и тёмный текст на цвете (модули Lc) и что выбирает правило
export function toneInfo(hex) {
  const light = Math.abs(apca(inkOf('dark'), hex)), dark = Math.abs(apca(inkOf('light'), hex));
  const tone = light >= LC_HEAD && light + LIGHT_EDGE >= dark ? 'dark' : 'light';
  return { tone, light, dark, lc: tone === 'dark' ? light : dark };
}
// тон фона: 'dark' — текст на нём светлый, 'light' — тёмный
export function toneOf(hex) {
  if (!rgbOf(hex)) return 'light';
  return toneInfo(hex).tone;
}
// сила контраста текста выбранного тона на цвете (Lc, без знака)
export function contrastOf(hex, tone) {
  if (!rgbOf(hex)) return 100;
  return Math.abs(apca(inkOf(tone === 'dark' ? 'dark' : 'light'), hex));
}
// Основная кнопка в дизайн-системе тёмная на любом фоне. Если фон сам почти такой же тёмный (меньше Lc 15 — порог,
// ниже которого фигуру уже не отличить от фона), кнопка становится светлой.
export const buttonLight = (bg) => !!rgbOf(bg) && Math.abs(apca(inkOf('light'), bg)) < LC_UI;
// Вторичный текст в дизайн-системе — основной цвет на 70%. Если на фоне проекта такой текст набирает меньше Lc 60,
// он становится основным цветом целиком. fg — цвет текста, bg — фон (#RRGGBB)
export function softTextOk(fg, bg, k = 0.7) {
  const f = rgbOf(fg), b = rgbOf(bg);
  if (!f || !b) return true;
  const mix = f.map((v, i) => Math.round(v * k + b[i] * (1 - k)));
  return Math.abs(apca(mix, b)) >= LC_TEXT;
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
  // полоса браузера — цвета проекта или цвета листа (а не чисто белая: лист чуть серее, и на iPhone был виден шов)
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  if (meta) meta.content = theme ? theme.color : (/^#[0-9a-f]{6}$/i.test(paper) ? paper : '#F4F6F6');
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
