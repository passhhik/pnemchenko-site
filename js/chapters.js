// Главы кейса — блоки из раздела «Кейс — главы» дизайн-системы (Figma: pnemchenko.ru → «Дизайн-система»).
// Первым ими собран кейс «Свои деньги» (страница «Кейс: Свои деньги — вёрстка», фрейм «Desktop - 1»); дальше это
// шаблон для остальных кейсов: блок = компонент, поля блока = свойства компонента.
//
// Каждый вид — функция (b, ctx) → разметка; ctx.reduced — «уменьшить движение». Поведение (лента, прилипающий
// телефон, плеер, бегущие карты) запускает initChapters() после вставки разметки.
// Координаты и размеры — из макета 1440: --u в CSS — один пиксель макета при текущей ширине кейса (js/case.js).
import { tx, esc, srcOf } from './content.js';
import { phoneHTML } from './phone.js';

const T = (v) => esc(tx(v));
// перенос строки из макета: на компьютере держим его, на телефоне — обычный пробел (текст там переносится сам)
const ML = (v) => T(v).replace(/\n/g, ' <br class="nl">');
// Цвета из макета. Файл Figma — в Display P3: hex оттуда — это координаты P3, и в sRGB они выглядят тусклее, чем в Figma.
// У проекта с colorSpace: 'p3' (js/case.js → setColorSpace) цвет выводится как color(display-p3 …), где браузер это умеет
const P3_OK = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('color', 'color(display-p3 1 1 1)');
let P3 = false;
export const setColorSpace = (cs) => { P3 = P3_OK && cs === 'p3'; };
export const p3 = (hex) => {
  const h = String(hex || '').trim().replace('#', '');
  if (!P3 || !/^[0-9a-f]{6}$/i.test(h)) return hex;
  return `color(display-p3 ${[0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)).join(' ')})`;
};
const color = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '').trim()) ? p3(String(c).trim()) : '');
const img = (src, alt = '', extra = '') => (srcOf(src) ? `<img src="${esc(srcOf(src))}" alt="${esc(tx(alt) || '')}" loading="lazy" decoding="async"${extra}>` : '');
const pct = (v, of) => `${Math.round((v / of) * 10000) / 100}%`;
const CHEV = (dir) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="${dir === 'l' ? 'M14 6 8 12l6 6' : 'M10 6l6 6-6 6'}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const CHAPTERS = {
  // Глава (Figma: «Кейс / Глава»): заголовок 56 и вводный абзац; по центру или слева
  chapter(b) {
    if (!tx(b.title) && !tx(b.lead)) return '';
    return `<section class="blk ch${b.align === 'left' ? ' ch--l' : ''}${b.tone === 'dark' ? ' is-dark' : ''}">${tx(b.title) ? `<h2 class="ch-t">${ML(b.title)}</h2>` : ''}${tx(b.lead) ? `<p class="ch-lead">${ML(b.lead)}</p>` : ''}</section>`;
  },

  // Шоурил в карточке 16:9: стандартный плеер браузера (Figma: «Slide 16:9»). Видео грузится только по нажатию
  showreel(b, { reduced }) {
    const src = srcOf(b.src), poster = srcOf(b.poster);
    if (!src && !poster) return '';
    return `<figure class="blk reel${b.tone === 'dark' ? ' is-dark' : ''}" data-reel>
      <div class="reel-box">
        ${src ? `<video class="reel-v" src="${esc(src)}"${poster ? ` poster="${esc(poster)}"` : ''} controls preload="none" playsinline${b.loop && !reduced ? ' loop' : ''}${tx(b.alt) ? ` aria-label="${T(b.alt)}"` : ''}></video>` : `<img class="reel-v" src="${esc(poster)}" alt="${T(b.alt)}" loading="lazy">`}
      </div>${tx(b.caption) ? `<figcaption>${T(b.caption)}</figcaption>` : ''}
    </figure>`;
  },

  // Лента главного (Figma: «Кейс / Лента главного» + «Карточка главного»): листается вбок — свайп, стрелки, точки
  ribbon(b, ctx) {
    const items = (b.items || []).filter((it) => it && (it.phone || srcOf(it.image) || (it.cycle && it.cycle.length)));
    if (!items.length) return '';
    const card = (it) => {
      let vis = '';
      if (it.phone) vis = phoneHTML(it.phone, { size: 'M', label: it.alt || it.caption, reduced: ctx.reduced });
      else if (it.cycle && it.cycle.length) vis = `<div class="rib-cyc" data-cycle="${+it.every || 1500}">${it.cycle.map((s, i) => img(s, i ? '' : (it.alt || it.caption), i ? ' class="" aria-hidden="true"' : ' class="is-on"')).join('')}</div>`;
      else vis = img(it.image, it.alt || it.caption, ' class="rib-img"');
      return `<div class="rib-card" role="group" aria-roledescription="слайд" aria-label="${items.indexOf(it) + 1} из ${items.length}"><h3 class="rib-cap">${ML(it.caption)}</h3><div class="rib-vis">${vis}</div></div>`;
    };
    return `<section class="blk rib" data-rib>
      <div class="rib-track" data-track tabindex="0" role="region" aria-roledescription="карусель" aria-label="${T(b.label || 'Главное')}">${items.map(card).join('')}</div>
      <div class="rib-ctl"><button type="button" class="rib-btn" data-prev aria-label="Предыдущая карточка">${CHEV('l')}</button><div class="rib-dots" aria-hidden="true">${items.map((_, i) => `<i${i ? '' : ' class="is-on"'}></i>`).join('')}</div><button type="button" class="rib-btn" data-next aria-label="Следующая карточка">${CHEV('r')}</button></div>
    </section>`;
  },

  // Суть (Figma: «Кейс / Суть»): задача, что сделал, итог — три колонки
  tldr(b) {
    const items = (b.items || []).filter((it) => tx(it.title) || tx(it.text));
    if (!items.length) return '';
    return `<section class="blk tl" style="--n:${items.length}">${items.map((it) => `<div class="tl-i"><h3>${T(it.title)}</h3><p>${ML(it.text)}</p></div>`).join('')}</section>`;
  },

  // Карточки-доводы (Figma: «Кейс / Карточка-довод»): значок, заголовок, текст. accent — карточка поверх ряда,
  // повёрнута и заходит на соседние (лаймовая «Взросление»); mark — кружок с крестиком («Что не вошло»)
  duo(b) {
    const items = (b.items || []).filter((it) => tx(it.title) || tx(it.text));
    if (!items.length && !b.accent) return '';
    const card = (it, cls = '') => `<article class="duo-c${cls}"${color(it.bg) ? ` style="--bg:${color(it.bg)}"` : ''}>${it.mark ? `<span class="duo-x" aria-hidden="true">${esc(it.mark)}</span>` : ''}${srcOf(it.icon) ? `<img class="duo-ic" src="${esc(srcOf(it.icon))}" alt="${T(it.iconAlt)}" loading="lazy" style="${it.iconW ? `--iw:${+it.iconW}` : ''}">` : ''}<div class="duo-tx"><h3>${ML(it.title)}</h3>${tx(it.text) ? `<p>${ML(it.text)}</p>` : ''}</div></article>`;
    const a = b.accent;
    return `<section class="blk duo${a ? ' has-acc' : ''}" data-anim style="--cols:${Math.min(3, +b.columns || 2)}"><div class="duo-row">${items.map((it) => card(it)).join('')}</div>${a ? card(a, ' duo-acc') : ''}</section>`;
  },

  // Голоса (Figma: «Кейс / Голос»): аватар заходит на карточку сверху, под ним — «хочу»
  voices(b) {
    const items = (b.items || []).filter((it) => tx(it.quote));
    if (!items.length) return '';
    return `<section class="blk vo">${items.map((it) => `<figure class="vo-i">${srcOf(it.avatar) ? `<img class="vo-av" src="${esc(srcOf(it.avatar))}" alt="${T(it.who)}" loading="lazy">` : `<span class="vo-av vo-l">${T(it.letter)}</span>`}<blockquote>${ML(it.quote)}</blockquote></figure>`).join('')}</section>`;
  },

  // Лесенка (Figma: «Кейс / Ступень»): ступени растут слева направо, вырастают снизу по очереди
  ladder(b) {
    const items = (b.items || []).filter((it) => tx(it.title));
    if (!items.length) return '';
    const n = items.length;
    return `<section class="blk ld" data-anim style="--n:${n}">${items.map((it, i) => {
      const bg = color(it.bg) || '#daff6d';
      return `<div class="ld-s${it.dark ? ' is-dark' : ''}${it.solid ? ' is-solid' : ''}" style="--bg:${bg};--h:${+it.h || 400 + i * 80};--i:${i}"><h3>${T(it.title)}</h3>${tx(it.text) ? `<p>${ML(it.text)}</p>` : ''}${img(it.image, it.alt, ' class="ld-img"')}</div>`;
    }).join('')}</section>`;
  },

  // Схема (Figma: «Как меняется уровень»): колонки с шагами через «↓»
  flows(b) {
    const items = (b.items || []).filter((it) => tx(it.title));
    if (!items.length) return '';
    return `<section class="blk fl" style="--n:${items.length}">${items.map((it) => `<div class="fl-c"><h3><i style="--c:${color(it.color) || '#2dbe60'}" aria-hidden="true"></i>${T(it.title)}</h3><ol>${(it.steps || []).map((s) => `<li>${ML(s)}</li>`).join('')}</ol></div>`).join('')}</section>`;
  },

  // Шаги в телефоне (Figma: «Кейс / Шаги в телефоне»): телефон прилипает, пока листаются шаги; активный шаг —
  // свой экран в телефоне. На телефоне сайта — лента экранов
  phoneSteps(b, ctx) {
    const items = (b.items || []).filter((it) => tx(it.title));
    if (!items.length) return '';
    const screens = items.map((it, i) => {
      const p = it.phone || {};
      return `<img class="ps-scr${i ? '' : ' is-on'}" src="${esc(srcOf(p.src || p))}" alt="" loading="lazy" decoding="async" data-i="${i}">`;
    }).join('');
    const ph = `<div class="ph ph--L" data-tilt><div class="ph-scr">${screens}</div><i class="ph-isl" aria-hidden="true"></i></div>`;
    const list = items.map((it, i) => `<li class="ps-i${i ? '' : ' is-on'}" data-i="${i}"><button type="button" class="ps-b" data-step="${i}"><span class="ps-n">${i + 1}</span><span class="ps-tx"><span class="ps-t">${T(it.title)}</span><span class="ps-d"><span>${ML(it.text)}</span></span></span></button></li>`).join('');
    const strip = items.map((it, i) => `<figure class="ps-m">${phoneHTML(it.phone, { size: 'M', label: it.title, reduced: ctx.reduced })}<figcaption><span class="ps-n">${i + 1}</span><b>${T(it.title)}</b>${tx(it.text) ? `<span>${ML(it.text)}</span>` : ''}</figcaption></figure>`).join('');
    return `<section class="blk ps" data-psteps style="--n:${items.length}"><div class="ps-pin"><div class="ps-in"><ol class="ps-list">${list}</ol><div class="ps-ph">${ph}</div></div></div><div class="ps-strip" data-track>${strip}</div></section>`;
  },

  // Телефон на сцене с предметами вокруг (глава «Своя карта»): предметы чуть плывут при прокрутке
  stage(b, ctx) {
    if (!b.phone) return '';
    const PW = 350, PH = 735;
    // на телефоне предметы ближе к экрану и мельче: свои координаты o.m {x,y,w,front} или общее «сжатие» к центру
    const mob = (o) => {
      if (o.m) return { x: +o.m.x, y: +o.m.y, w: +o.m.w, front: !!o.m.front };
      const w = o.w * .5, cx = PW / 2 + (o.x + o.w / 2 - PW / 2) * .45;
      return { x: cx - w / 2, y: PH / 2 + (o.y - PH / 2) * .45, w, front: false };
    };
    const objs = (b.objects || []).map((o) => {
      const m = mob(o);
      return `<img class="stg-o" src="${esc(srcOf(o.src))}" alt="" aria-hidden="true" loading="lazy" decoding="async" style="--l:${pct(o.x, PW)};--t:${pct(o.y, PH)};--w:${pct(o.w, PW)};--z:${o.front ? 3 : 1};--ml:${pct(m.x, PW)};--mt:${pct(m.y, PH)};--mw:${pct(m.w, PW)};--mz:${m.front ? 3 : 1};--d:${+o.depth || 1}">`;
    }).join('');
    return `<section class="blk stg" data-stage><div class="stg-box">${objs}<div class="stg-ph">${phoneHTML(b.phone, { size: 'L', label: b.alt, reduced: ctx.reduced, tilt: true })}</div></div></section>`;
  },

  // Стена карт: два ряда едут навстречу друг другу, по кругу
  marquee(b) {
    const rows = (b.rows || []).filter((r) => r && r.length);
    if (!rows.length) return '';
    const row = (r, i) => {
      const cards = r.map((c) => img(c.src || c, c.alt || '', ' class="mq-c"')).join('');
      return `<div class="mq-row${i % 2 ? ' is-rev' : ''}"><div class="mq-in" style="--dur:${+b.speed || 60}s">${cards}${cards.replace(/alt="[^"]*"/g, 'alt="" aria-hidden="true"')}</div></div>`;
    };
    return `<section class="blk mq" data-mq aria-label="${T(b.label || 'Дизайны карт')}">${rows.map(row).join('')}</section>`;
  },

  // Плитки в сетке заданной пропорции (сцены коллабораций)
  grid(b) {
    const items = (b.items || []).filter((it) => srcOf(it));
    if (!items.length) return '';
    return `<section class="blk gr" style="--cols:${+b.columns || 2};--ar:${esc(b.ratio || '593 / 334')}">${items.map((it) => `<figure class="gr-i">${img(it, it.alt)}</figure>`).join('')}${tx(b.caption) ? `<figcaption class="gr-cap">${T(b.caption)}</figcaption>` : ''}</section>`;
  },

  // Экран с выносками (Figma: «Кейс / Экран с выносками»): выноски проявляются по одной, когда телефон доехал до середины
  callouts(b, ctx) {
    if (!b.phone) return '';
    const side = (list, s) => `<div class="co-s co-s--${s}">${(list || []).map((c, i) => `<div class="co-i" style="--i:${i + (s === 'r' ? 0.5 : 0)}"><div class="co-tx"><h3>${ML(c.title)}</h3><p>${ML(c.text)}</p></div><i class="co-p" aria-hidden="true"></i></div>`).join('')}</div>`;
    return `<section class="blk co" data-anim>${side(b.left, 'l')}<div class="co-ph">${phoneHTML(b.phone, { size: 'L', label: b.alt, reduced: ctx.reduced, tilt: true })}</div>${side(b.right, 'r')}</section>`;
  },

  // Сценарий (Figma: «Кейс / Сценарий»): ряд экранов с подписями; or — развилка «или» между двумя исходами
  scenario(b, ctx) {
    const items = (b.items || []).filter((it) => it && it.phone);
    if (!items.length) return '';
    const fig = (it, i) => `<figure class="scn-i" style="--i:${i}">${phoneHTML(it.phone, { size: 'M', label: it.alt || it.caption, reduced: ctx.reduced })}${tx(it.caption) ? `<figcaption class="pill">${T(it.caption)}</figcaption>` : ''}</figure>`;
    const parts = b.or && items.length === 2
      ? `${fig(items[0], 0)}<span class="scn-or">${T(b.or)}</span>${fig(items[1], 2)}`
      : items.map(fig).join('');
    const track = !b.or && items.length > 4, pair = !b.or && items.length === 2;
    const ctl = track ? `<div class="rib-ctl"><button type="button" class="rib-btn" data-prev aria-label="Предыдущий экран">${CHEV('l')}</button><div class="rib-dots" aria-hidden="true">${items.map((_, i) => `<i${i ? '' : ' class="is-on"'}></i>`).join('')}</div><button type="button" class="rib-btn" data-next aria-label="Следующий экран">${CHEV('r')}</button></div>` : '';
    return `<section class="blk scn${b.or ? ' scn--or' : ''}${track ? ' scn--track' : ''}${pair ? ' scn--pair' : ''}" data-anim${track ? ' data-rib' : ''}><div class="scn-row"${track ? ` data-track tabindex="0" role="region" aria-roledescription="лента" aria-label="${T(b.label || 'Экраны по шагам')}"` : ''}>${parts}</div>${ctl}</section>`;
  },

  // Текст слева, телефон справа; пилюли под текстом подсвечивают места на экране (наведите или нажмите)
  feature(b, ctx) {
    if (!b.phone) return '';
    const pills = (b.pills || []).filter((p) => tx(p.label));
    return `<section class="blk ft${b.side === 'left' ? ' ft--rev' : ''}" data-feat><div class="ft-t">${tx(b.title) ? `<h2 class="ch-t">${ML(b.title)}</h2>` : ''}${tx(b.lead) ? `<p class="ch-lead">${ML(b.lead)}</p>` : ''}${pills.length ? `<div class="ft-pills">${pills.map((p, i) => `<button type="button" class="pill" data-pill="${i}">${T(p.label)}</button>`).join('')}</div>` : ''}</div><div class="ft-ph">${phoneHTML(b.phone, { size: 'L', label: b.alt, reduced: ctx.reduced, tilt: true })}</div></section>`;
  },

  // Картинка на карточке (развёртка свиньи): белая подложка 56, картинка по центру
  plate(b) {
    if (!srcOf(b.src)) return '';
    return `<figure class="blk pl"${color(b.bg) ? ` style="--bg:${color(b.bg)}"` : ''}><div class="pl-box" style="--ar:${esc(b.ratio || '1206 / 626')}">${img(b.src, b.alt, ` style="width:${+b.imgW || 53}%"`)}</div>${tx(b.caption) ? `<figcaption>${T(b.caption)}</figcaption>` : ''}</figure>`;
  },

  // Наклейки-эмоции: квадраты 225 с подписью-пилюлей, всплывают волной
  stickers(b) {
    const items = (b.items || []).filter((it) => srcOf(it.src));
    if (!items.length) return '';
    return `<section class="blk stk" data-anim>${items.map((it, i) => `<figure class="stk-i" style="--i:${i}"><div class="stk-b">${img(it.src, it.alt || it.caption)}</div>${tx(it.caption) ? `<figcaption class="pill">${T(it.caption)}</figcaption>` : ''}</figure>`).join('')}</section>`;
  },

  // Бенто (Figma: «Кейс / Бенто»): плитки 389 и 797 в два ряда — иконка, палитра, шрифты, монеты, UI-кит
  bento(b) {
    const rows = (b.rows || []).filter((r) => r && r.length);
    if (!rows.length) return '';
    const tile = (t) => {
      const bg = color(t.bg) || '#ffffff';
      const pal = (t.palette || []).length ? `<div class="bt-pal">${t.palette.map((c) => `<div class="bt-sw${c.ring ? ' is-ring' : ''}" style="--sw:${color(c.hex)};--swf:${c.dark ? '#ffffff' : '#1d1d1f'}"><b>${T(c.name)}</b><span>${esc(String(c.hex || '').toUpperCase())}</span></div>`).join('')}</div>` : '';
      const art = srcOf(t.image) ? `<div class="bt-art${t.fit === 'place' ? ' is-place' : ''}">${img(t.image, t.alt, t.place ? ` style="left:${pct(t.place.x, 389)};top:${pct(t.place.y, 393)};width:${pct(t.place.w, 389)}"` : '')}</div>` : '';
      const objs = (t.objects || []).map((o) => img(o.src, '', ` class="bt-o" aria-hidden="true" style="left:${pct(o.x, 389)};top:${pct(o.y, 393)};width:${pct(o.w, 389)}"`)).join('');
      return `<div class="bt${t.dark ? ' is-dark' : ''}" style="--bg:${bg};--span:${+t.span || 1}"><h3>${ML(t.title)}</h3>${pal}${art}${objs}</div>`;
    };
    const odd = rows.reduce((n, r) => n + r.length, 0) % 2 ? ' bt-grid--odd' : '';             // на планшете плитки идут по две: последняя нечётная — во всю ширину
    return `<section class="blk bt-grid${odd}">${rows.map((r) => `<div class="bt-row">${r.map(tile).join('')}</div>`).join('')}</section>`;
  },

  // Метрики словом (Figma: «Кейс / Метрика», вид «Слово»): пилюля, крупное слово цветом проекта, подпись
  words(b) {
    const items = (b.items || []).filter((it) => tx(it.v));
    if (!items.length) return '';
    return `<section class="blk wd" style="--n:${items.length}"><div class="wd-row">${items.map((it) => `<div class="wd-i">${tx(it.k) ? `<span class="pill">${T(it.k)}</span>` : ''}<p class="wd-v">${T(it.v)}</p><p class="wd-l">${ML(it.l)}</p></div>`).join('')}</div>${tx(b.note) ? `<p class="wd-note">${ML(b.note)}</p>` : ''}</section>`;
  },

  // Финал на цвете (Figma: «Кейс / Финал на цвете»): надпись-наклейка, подзаголовок, кнопки и свинья за краем
  finale(b) {
    const btns = (b.buttons || []).filter((x) => x && (srcOf(x.img) || tx(x.label)));
    const btn = (x) => {
      const inner = srcOf(x.img) ? `<img src="${esc(srcOf(x.img))}" alt="${T(x.label)}">` : T(x.label);
      const url = String(x.url || '').trim();
      return /^(https?:)?\/\//i.test(url) ? `<a class="fin-b" href="${esc(url)}" target="_blank" rel="noopener">${inner}</a>` : `<span class="fin-b is-off" role="link" aria-disabled="true" aria-label="${T(x.label)} — ссылка появится позже" title="Ссылка появится позже">${inner}</span>`;
    };
    return `<section class="blk fin"${color(b.bg) ? ` style="--bg:${color(b.bg)}"` : ''}><div class="fin-c">${srcOf(b.title) ? `<img class="fin-t" src="${esc(srcOf(b.title))}" alt="${T(b.titleAlt)}">` : `<h2 class="ch-t">${T(b.titleAlt)}</h2>`}${tx(b.lead) ? `<p class="fin-l">${T(b.lead)}</p>` : ''}${btns.length ? `<div class="fin-bs">${btns.map(btn).join('')}</div>` : ''}</div>${img(b.visual, '', ' class="fin-v" aria-hidden="true"')}</section>`;
  },
};

// ---------- поведение глав ----------
export function initChapters(root, { reduced = false, phoneApi = null } = {}) {
  const offs = [];
  const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); offs.push(() => el.removeEventListener(ev, fn, opt)); };

  // ленты: перетаскивание мышью (на тачпаде и телефоне — родной свайп)
  root.querySelectorAll('[data-track]').forEach((tr) => {
    let down = false, x0 = 0, s0 = 0, moved = false;
    on(tr, 'pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button) return; down = true; moved = false; x0 = e.clientX; s0 = tr.scrollLeft; tr.classList.add('is-drag'); });
    on(window, 'pointermove', (e) => { if (!down) return; const dx = e.clientX - x0; if (Math.abs(dx) > 4) moved = true; tr.scrollLeft = s0 - dx; });
    on(window, 'pointerup', () => { if (!down) return; down = false; tr.classList.remove('is-drag'); });
    on(tr, 'click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
  });

  // лента главного: стрелки и точки
  root.querySelectorAll('[data-rib]').forEach((rib) => {
    const tr = rib.querySelector('[data-track]'), cards = [...tr.children], dots = [...rib.querySelectorAll('.rib-dots i')];
    const prev = rib.querySelector('[data-prev]'), next = rib.querySelector('[data-next]');
    const step = () => (cards[1] ? cards[1].offsetLeft - cards[0].offsetLeft : tr.clientWidth);
    const idx = () => Math.round(tr.scrollLeft / Math.max(1, step()));
    const sync = () => {
      const i = Math.min(cards.length - 1, idx()), max = tr.scrollWidth - tr.clientWidth - 2;
      dots.forEach((d, k) => d.classList.toggle('is-on', k === (tr.scrollLeft >= max ? cards.length - 1 : i)));
      prev.setAttribute('aria-disabled', String(tr.scrollLeft <= 2)); next.setAttribute('aria-disabled', String(tr.scrollLeft >= max));
    };
    const go = (d) => {
      if ((d < 0 ? prev : next).getAttribute('aria-disabled') === 'true') return;
      tr.scrollTo({ left: Math.max(0, (idx() + d) * step()), behavior: reduced ? 'auto' : 'smooth' });
    };
    on(prev, 'click', () => go(-1)); on(next, 'click', () => go(1));
    on(tr, 'scroll', () => requestAnimationFrame(sync), { passive: true });
    on(tr, 'keydown', (e) => { if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } });
    sync();
  });

  // шаги в телефоне: активный шаг — по прокрутке (телефон прилип), нажатие на шаг доводит до него
  root.querySelectorAll('[data-psteps]').forEach((ps) => {
    const items = [...ps.querySelectorAll('.ps-i')], scr = [...ps.querySelectorAll('.ps-scr')], n = items.length;
    let cur = 0;
    const set = (i) => {
      if (i === cur) return;
      items.forEach((it, k) => it.classList.toggle('is-on', k === i));
      scr.forEach((s, k) => { s.classList.toggle('is-on', k === i); s.classList.toggle('is-past', k < i); });
      cur = i;
    };
    const pin = ps.querySelector('.ps-pin');
    const onScroll = () => {
      if (getComputedStyle(pin).position !== 'sticky') return;
      const r = ps.getBoundingClientRect(), span = r.height - window.innerHeight;
      const p = span > 0 ? Math.min(.999, Math.max(0, -r.top / span)) : 0;
      set(Math.floor(p * n));
    };
    on(window, 'scroll', () => requestAnimationFrame(onScroll), { passive: true });
    items.forEach((it, i) => on(it.querySelector('button'), 'click', () => {
      if (getComputedStyle(pin).position !== 'sticky') { set(i); return; }
      const r = ps.getBoundingClientRect(), span = r.height - window.innerHeight;
      window.scrollTo({ top: window.scrollY + r.top + span * ((i + .5) / n), behavior: reduced ? 'auto' : 'smooth' });
    }));
    onScroll();
  });

  // предметы на сцене чуть плывут при прокрутке — каждый со своей глубиной
  if (!reduced) root.querySelectorAll('[data-stage]').forEach((stg) => {
    const objs = [...stg.querySelectorAll('.stg-o')];
    const onScroll = () => {
      const r = stg.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      const p = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;     // −1…1: центр сцены относительно центра экрана
      const amp = window.innerWidth < 761 ? 20 : 46;                                     // на телефоне предметы рядом с экраном — плывут меньше
      objs.forEach((o) => o.style.setProperty('--py', `${(p * amp * (+o.style.getPropertyValue('--d') || 1)).toFixed(1)}px`));
    };
    on(window, 'scroll', () => requestAnimationFrame(onScroll), { passive: true });
    onScroll();
  });

  // пилюли ↔ места на экране: наведение или нажатие подсвечивает, само — по очереди
  root.querySelectorAll('[data-feat]').forEach((ft) => {
    const pills = [...ft.querySelectorAll('[data-pill]')];
    const ph = ft.querySelector('[data-ph]');
    const api = phoneApi && ph ? phoneApi(ph) : null;
    if (!pills.length) return;
    if (!api) { pills.forEach((p) => { const t = document.createElement('span'); t.className = 'pill'; t.textContent = p.textContent; p.replaceWith(t); }); return; }
    let hold = -1;
    const show = (i) => { pills.forEach((p, k) => { p.classList.toggle('is-on', k === i); p.setAttribute('aria-pressed', String(k === i)); }); };
    // на узком экране пилюли и телефон не всегда влезают в окно вместе: после касания подсвеченное место — в центр экрана
    // (рамка доезжает до места с переходом, поэтому её конечное положение считаем по стилю, а не по текущему кадру)
    const reveal = () => requestAnimationFrame(() => {
      const f = ph.querySelector('.sc-f2'), c = f && f.offsetParent; if (!c) return;
      const cr = c.getBoundingClientRect(), k = cr.width / (c.offsetWidth || 393);
      const top = cr.top + (parseFloat(f.style.top) || 0) * k, bottom = top + (parseFloat(f.style.height) || 0) * k;
      const lo = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr')) || 72) + 12, hi = window.innerHeight - 110;
      if (top < lo || bottom > hi) window.scrollBy({ top: (top + bottom) / 2 - (lo + hi) / 2, behavior: reduced ? 'auto' : 'smooth' });
    });
    pills.forEach((p, i) => {
      const enter = () => { hold = i; show(i); api.hold(i); };
      const leave = () => { hold = -1; api.release(); };
      // касание на телефоне даёт и «наведение», и нажатие: наведение слушаем только у мыши, иначе нажатие тут же гасит подсветку
      on(p, 'pointerenter', (e) => { if (e.pointerType === 'mouse') enter(); });
      on(p, 'pointerleave', (e) => { if (e.pointerType === 'mouse' && hold === i) leave(); });
      on(p, 'focus', () => { if (p.matches(':focus-visible')) enter(); });
      on(p, 'blur', () => { if (hold === i) leave(); });
      on(p, 'click', (e) => { if (e.pointerType === 'mouse' && hold === i) return; if (hold === i) leave(); else { enter(); if (e.pointerType !== 'mouse') reveal(); } });
    });
    const tick = setInterval(() => { if (hold < 0) show(api.focusIndex()); }, 180);
    offs.push(() => clearInterval(tick));
  });

  // ленты без своих кнопок (лесенка, шаги лентой, пара экранов): фокус с клавиатуры, когда есть что листать.
  // Название ленты — по ближайшему заголовку главы, чтобы у скринридера не было двух одинаковых областей
  const used = new Set();
  const nameOf = (el) => {
    let h = null;
    for (let n = el.closest('[data-b]'); n && !h; n = n.previousElementSibling) h = n.querySelector('h2');
    const t = h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 70) : '';
    let name = t ? `${t}: лента, листается стрелками` : 'Лента, листается стрелками';
    for (let k = 2; used.has(name); k++) name = `${t || 'Лента'}: лента ${k}, листается стрелками`;
    used.add(name);
    return name;
  };
  root.querySelectorAll('.ld, .ps-strip, .scn-row:not([data-track])').forEach((el) => {
    const f = () => {
      if (el.scrollWidth > el.clientWidth + 2) { el.setAttribute('tabindex', '0'); el.setAttribute('role', 'region'); if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', nameOf(el)); }
      else { el.removeAttribute('tabindex'); el.removeAttribute('role'); }
    };
    f();
    if ('ResizeObserver' in window) { const ro = new ResizeObserver(f); ro.observe(el); offs.push(() => ro.disconnect()); }
  });

  // стена карт: касание останавливает и снова запускает
  root.querySelectorAll('[data-mq]').forEach((mq) => on(mq, 'click', () => mq.classList.toggle('is-paused')));

  // всплытие по частям: ступени, выноски, эмоции, лаймовая карточка — когда блок доехал до экрана
  const anims = root.querySelectorAll('[data-anim]');
  if (anims.length) {
    if (reduced || !('IntersectionObserver' in window)) anims.forEach((a) => a.classList.add('is-on'));
    else {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-on'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -22% 0px' });
      anims.forEach((a) => io.observe(a));
      offs.push(() => io.disconnect());
    }
  }

  // шоурил: уехал с экрана — пауза (плеер стандартный)
  root.querySelectorAll('[data-reel] video').forEach((v) => {
    // Chrome на компьютере не запускает видео кликом по кадру, Firefox и Safari — запускают. Если после клика мышью
    // браузер сам ничего не сделал, запускаем или ставим на паузу сами; полосу плеера внизу не трогаем
    let ptr = '';
    on(v, 'pointerdown', (e) => { ptr = e.pointerType; });
    on(v, 'click', (e) => {
      if (ptr !== 'mouse' || e.offsetY > v.clientHeight - 64) return;
      const was = v.paused;
      setTimeout(() => {
        if (v.paused !== was) return;
        if (was) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } else v.pause();
      }, 0);
    });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting && !v.paused) v.pause(); }), { threshold: .2 });
      io.observe(v); offs.push(() => io.disconnect());
    }
    offs.push(() => { try { v.pause(); } catch (_) { /* noop */ } });
  });

  return () => offs.forEach((f) => f());
}
