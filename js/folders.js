// Папка из матового стекла: задняя стенка, работы внутри, передняя стенка с наклейками, под ней название и счётчик.
// Одна разметка на всё: папки разделов на главной, папки проектов в каталоге, «следующий проект» в кейсе.
import { esc, srcOf } from './content.js';

// Контур передней стенки (язычок слева выше) в долях её размера
const FRONT = 'M0,.068 C0,.03 .022,0 .05,0 L.385,0 C.445,0 .455,.128 .515,.128 L.95,.128 C.978,.128 1,.158 1,.196 L1,.932 C1,.97 .978,1 .95,1 L.05,1 C.022,1 0,.97 0,.932 Z';
const FRONT_100 = FRONT.replace(/-?\d*\.?\d+/g, (n) => String(Math.round(parseFloat(n) * 10000) / 100));

// один раз кладём в документ контур для clip-path
export function installFolderDefs() {
  if (document.getElementById('gf-front')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = `<defs><clipPath id="gf-front" clipPathUnits="objectBoundingBox"><path d="${FRONT}"/></clipPath></defs>`;
  document.body.appendChild(svg);
}

// Свой оттенок папки (по умолчанию она нейтральная, как матовое стекло): цвет подмешивается к стенкам и стеклу
export function tintStyle(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '';
  const n = parseInt(m[1], 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mix = (to, k) => c.map((v, i) => Math.round(v * k + to[i] * (1 - k)));
  const css = (a) => `rgb(${a.join(',')})`;
  return `--gf-back:${css(mix([213, 217, 223], 0.42))};--gf-back2:${css(mix([201, 206, 214], 0.52))};--gf-glass:${mix([246, 247, 250], 0.2).join(',')};`;
}

// items — до трёх картинок по убыванию важности ({ src, cut } или путь): первая встаёт по центру, остальные — по бокам.
// stickers — до двух наклеек (пути), tint — свой цвет папки (#RRGGBB)
const SLOTS = ['c', 'l', 'r'];
export function folderHTML({ href, title, pill = '', items = [], stickers = [], cls = '', attrs = '', style = '', tint = '', lazy = true }) {
  const imgs = items.filter((a) => srcOf(a)).slice(0, 3).map((a, i) => {
    const cut = !!(a && typeof a === 'object' && a.cut);
    return { slot: SLOTS[i], html: `<img class="gf-item s-${SLOTS[i]}${cut ? ' is-cut' : ''}" src="${esc(srcOf(a))}" alt="" ${lazy ? 'loading="lazy" ' : ''}decoding="async" draggable="false">` };
  }).sort((x, y) => (x.slot === 'c') - (y.slot === 'c')).map((x) => x.html).join('');     // центральная — поверх боковых
  const st = stickers.filter(Boolean).slice(0, 2).map((s) => `<img class="gf-sticker" src="${esc(s)}" alt="" ${lazy ? 'loading="lazy" ' : ''}decoding="async" draggable="false">`).join('');
  // Телефон и планшет: «матовость» стекла — не размытие всего, что под ним (это дорого и в Safari мигает), а размытый
  // двойник нутра папки — задней стенки и тех же работ, — вложенный под стекло и обрезанный по его контуру.
  // Двигают его те же правила, что и сами работы (см. стили, .gf-ghost).
  const ghost = document.documentElement.classList.contains('is-touch') ? `<span class="gf-ghost" aria-hidden="true"><span class="gf-ghost-in"><span class="gf-back"></span>${imgs}</span></span>` : '';
  const css = tintStyle(tint) + style;
  return `<a class="gf ${cls}" href="${esc(href)}" draggable="false" ${attrs}${css ? ` style="${esc(css)}"` : ''}>
    <span class="gf-body">
      <span class="gf-ground"></span>
      <span class="gf-back"></span>
      <span class="gf-items" aria-hidden="true">${imgs}</span>${ghost}
      <span class="gf-front">${st}</span>
      <svg class="gf-edge" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="e1" d="${FRONT_100}"/><path class="e2" d="${FRONT_100}"/></svg>
    </span>
    <span class="gf-title">${esc(title)}</span>
    ${pill ? `<span class="gf-pill">${esc(pill)}</span>` : ''}
  </a>`;
}
