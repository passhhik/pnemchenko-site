// Каталог «Все работы».
// Внизу — лента карточек всех проектов (порядок — как в админке). Выбранный проект крупно: раздел, название, пара фраз,
// «Смотреть проект» и «Нравится»; рядом — его визуал (картинка или короткое видео, место задаётся в админке);
// под всем — фон проекта: цвет, картинка или видео. Снизу лёгкий градиент чуть затемняет карточки — глубина.
// Ленту двигает любая прокрутка: колёсико и тачпад (и по вертикали, и по горизонтали), перетаскивание мышью
// и пальцем, стрелки. Отпустили — лента мягко встаёт на ближайший проект, и экран целиком перекрашивается под него.
// Кейс открывается кнопкой «Смотреть проект» или нажатием на уже выбранную карточку.
import { content, tx, t, esc, srcOf, thumbOf, sectionById, isStack } from './content.js';
import { setTheme, toneOf } from './theme.js';
import { liked, toggleLike } from './likes.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Сердечко по умолчанию (своё пришлёт Павел — заменить здесь и в админке ничего не нужно)
export const HEART = '<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.6 10.6 19.3C5.6 14.8 2.3 11.8 2.3 8.1 2.3 5.1 4.6 2.8 7.6 2.8c1.7 0 3.3.8 4.4 2 1.1-1.2 2.7-2 4.4-2 3 0 5.3 2.3 5.3 5.3 0 3.7-3.3 6.7-8.3 11.2Z"/></svg>';
const SPRING_K = 150;                 // жёсткость «пружины» ленты: чем больше, тем быстрее встаёт на место
const SETTLE_MS = 150;                // столько тишины после колёсика — и лента встаёт на проект
// Визуал проекта, если в админке место не задано: на широком экране — справа, на узком — над текстом
// x, y — центр в долях экрана; s — сторона квадрата, в который вписан визуал (длинная сторона картинки), в процентах
export const HERO_DEFAULT = { desk: { x: 0.66, y: 0.4, s: 34 }, phone: { x: 0.5, y: 0.25, s: 50 } };

// ---- что показывать у проекта ----
const firstCut = (p) => (p.artifacts || []).find((a) => a && typeof a === 'object' && a.cut && a.src);
export function cardOf(p) {
  const c = p.card || {};
  return { video: c.video || '', image: c.image || thumbOf(p) };
}
export function bgOf(p) {
  const b = p.bg || {}, th = p.theme || {};
  const color = th.color || '#E9E9EC';
  const kind = b.kind === 'image' && b.image ? 'image' : b.kind === 'video' && b.video ? 'video' : 'color';
  return { kind, color, tone: th.tone || toneOf(color), image: b.image || '', video: b.video || '', poster: b.poster || b.image || '' };
}
export function heroOf(p, layout) {
  const h = p.hero || {};
  const cut = firstCut(p);
  const image = h.image || (h.video ? '' : (cut ? cut.src : ''));
  const pos = { ...HERO_DEFAULT[layout], ...((h[layout] && typeof h[layout] === 'object') ? h[layout] : {}) };
  return { image, video: h.video || '', poster: h.poster || h.image || '', pos, alt: (cut && cut.alt) || '' };
}

const mediaHTML = ({ video, image, poster = '' }, { cls = '', lazy = false, alt = '' } = {}) => {
  if (video) return `<video class="${cls}" muted loop playsinline preload="${lazy ? 'none' : 'metadata'}"${poster ? ` poster="${esc(poster)}"` : ''} src="${esc(video)}" aria-hidden="true" disablepictureinpicture></video>`;
  if (image) return `<img class="${cls}" src="${esc(image)}" alt="${esc(alt)}" draggable="false" decoding="async"${lazy ? ' loading="lazy"' : ''}>`;
  return '';
};
// видео играют, только пока нужны: при «меньше движения» и экономии трафика — стоят на первом кадре
const motionOk = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !(navigator.connection && navigator.connection.saveData);
const play = (v) => { if (v && v.paused && motionOk()) { const r = v.play(); if (r && r.catch) r.catch(() => {}); } };
const pause = (v) => { if (v && !v.paused) v.pause(); };

export function createCatalog(root, { onHover, onLike, onEmpty, reduced = false } = {}) {
  root.innerHTML = `
    <h1 class="visually-hidden" id="work-title" tabindex="-1">${esc(t('work'))}</h1>
    <div class="cat" data-cat>
      <div class="cat-bg" aria-hidden="true"><div class="cat-bg-l"></div><div class="cat-bg-l"></div></div>
      <div class="cat-hero" aria-hidden="true"></div>
      <div class="cat-info" data-info></div>
      <div class="cat-fade" aria-hidden="true"></div>
      <div class="cat-strip" data-strip role="group" aria-label="${esc(t('work'))}"></div>
      <p class="empty" data-empty hidden>${esc(t('empty'))}</p>
    </div>`;
  const cat = root.querySelector('[data-cat]');
  const bgLayers = [...root.querySelectorAll('.cat-bg-l')];
  const heroBox = root.querySelector('.cat-hero');
  const info = root.querySelector('[data-info]');
  const strip = root.querySelector('[data-strip]');
  const empty = root.querySelector('[data-empty]');

  const S = {
    list: [], cards: [], active: false, idx: -1, p: 0, target: 0, v: 0, settled: 0, raf: 0, last: 0,
    step: 300, pad: 24, W: 0, H: 0, layout: 'desk', saved: 0, cat: 'all', bgKey: '', heroKey: '', drag: null, dragged: false,
    wheelT: 0, swapT: 0, lookT: 0, bgOn: 0,
  };

  // ---------- разметка ----------
  // пока каталог закрыт, картинки карточек не качаются (lazy): им не место в очереди с головой; первые подгружает warm()
  function render() {
    S.list = content.projects.slice();
    strip.innerHTML = S.list.map((p, i) => {
      const m = cardOf(p);
      return `<button class="cat-card" type="button" data-i="${i}" aria-label="${esc(tx(p.title))}">
        <span class="cat-card-m">${mediaHTML(m, { cls: 'cat-card-media', lazy: !S.active || i > 4 })}</span>
        <span class="cat-like"${liked(p.slug) ? '' : ' hidden'}>${HEART}</span>
      </button>`;
    }).join('');
    S.cards = [...strip.children];
    empty.hidden = S.list.length > 0;
    S.idx = -1; S.bgKey = ''; S.heroKey = '';
    heroBox.innerHTML = '';
    info.innerHTML = '';
    measure();
    S.p = S.target = S.settled = clamp(Math.round(S.target), 0, Math.max(0, S.list.length - 1));
    place();
    if (S.active) select(clamp(Math.round(S.p), 0, S.list.length - 1), true);
  }

  // ---------- размеры ----------
  function measure() {
    const W = window.innerWidth, H = window.innerHeight;
    S.W = W; S.H = H;
    S.layout = isStack() ? 'phone' : 'desk';
    const u = Math.min(W, 1.5 * H) / 100;
    let cw, ch, gap, bottom;
    if (S.layout === 'phone') {
      S.pad = 16;
      cw = Math.min(W * 0.5, 260); ch = cw / 1.45; gap = 12;
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar')) || 70;
      bottom = bar + 12;
    } else {
      S.pad = clamp(u * 5.2, 16, 110);
      gap = clamp(W * 0.013, 12, 30);
      ch = Math.min(clamp(W * 0.245, 230, 560) / 1.53, H * 0.3);
      cw = ch * 1.53;
      bottom = clamp(H * 0.035, 14, 44);
    }
    S.step = cw + gap;
    const rs = cat.style;
    rs.setProperty('--cw', `${cw.toFixed(1)}px`);
    rs.setProperty('--ch', `${ch.toFixed(1)}px`);
    rs.setProperty('--cb', `${bottom.toFixed(1)}px`);
    rs.setProperty('--cpad', `${S.pad.toFixed(1)}px`);
    // где кончается лента — по этой линии встают текст проекта и реплика головы
    document.body.style.setProperty('--strip-top', `${(ch + bottom).toFixed(1)}px`);
  }

  // ---------- лента ----------
  // Карточки стоят от левого края текста: выбранная — первой. Те, что уже позади, уезжают влево, уменьшаются и гаснут.
  function place() {
    const n = S.cards.length;
    for (let i = 0; i < n; i++) {
      const d = i - S.p;
      let x = S.pad + d * S.step, s = 1, o = 1;
      if (d < 0) { x = S.pad + d * S.step * 0.72; s = clamp(1 + d * 0.1, 0.8, 1); o = clamp(1 + d * 1.15, 0, 1); }
      const el = S.cards[i];
      el.style.transform = `translate3d(${x.toFixed(1)}px,0,0) scale(${s.toFixed(3)})`;
      const op = o.toFixed(2);
      if (el._o !== op) { el._o = op; el.style.opacity = op; el.style.visibility = o < 0.02 ? 'hidden' : ''; }
      // видео на карточке играет, только пока карточка видна
      const vid = el._v === undefined ? (el._v = el.querySelector('video')) : el._v;
      if (vid) { if (o > 0.05 && x < S.W) play(vid); else pause(vid); }
      // картинка карточки начинает грузиться за пару карточек до того, как та выедет на экран
      if (!el._near && S.active && x < S.W + S.step * 2) {
        el._near = true;
        const im = el.querySelector('img[loading="lazy"]');
        if (im) im.loading = 'eager';
        if (vid && vid.preload === 'none') vid.preload = 'metadata';
      }
    }
  }
  function tick(now) {
    S.raf = 0;
    const dt = Math.min(0.05, S.last ? (now - S.last) / 1000 : 1 / 60);
    S.last = now;
    if (!S.drag) {
      if (reduced) { S.p = S.target; S.v = 0; }
      else {
        // пружина без раскачки: быстро трогается, мягко встаёт
        const k = SPRING_K, c = 2 * Math.sqrt(k);
        for (let i = 0; i < 2; i++) { const h = dt / 2; S.v += (k * (S.target - S.p) - c * S.v) * h; S.p += S.v * h; }
        if (Math.abs(S.target - S.p) < 0.0005 && Math.abs(S.v) < 0.001) { S.p = S.target; S.v = 0; }
      }
    }
    place();
    const i = clamp(Math.round(S.p), 0, S.list.length - 1);
    if (i !== S.idx && S.list.length) select(i);
    if (S.drag || S.p !== S.target) kick(); else S.last = 0;
  }
  function kick() { if (!S.raf && S.active) S.raf = requestAnimationFrame(tick); }
  function goTo(i, instant = false) {
    if (!S.list.length) return;
    S.target = S.settled = clamp(i, 0, S.list.length - 1);
    if (instant) { S.p = S.target; S.v = 0; place(); select(S.target); return; }
    kick();
  }
  // встать на проект после прокрутки колёсиком: даже одно лёгкое движение — уже шаг к соседнему
  function settle() {
    const delta = S.target - S.settled;
    let to = Math.round(S.target);
    if (to === S.settled && Math.abs(delta) > 0.1) to = S.settled + Math.sign(delta);
    goTo(to);
  }

  // ---------- выбранный проект ----------
  function select(i, force = false) {
    if (i === S.idx && !force) return;
    S.idx = i;
    const p = S.list[i];
    if (!p) return;
    S.cards.forEach((el, k) => {
      el.classList.toggle('is-active', k === i);
      if (k === i) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
    });
    showInfo(p);
    // фон и визуал меняются чуть позже текста: пока ленту крутят быстро, экран не мигает на каждом проекте
    clearTimeout(S.swapT);
    S.swapT = setTimeout(() => { showBg(p); showHero(p); }, force ? 0 : 90);
    if (onHover) {
      onHover(S.cards[i]);
      clearTimeout(S.lookT);
      S.lookT = setTimeout(() => { if (S.active) onHover(null); }, 1700);
    }
  }

  function infoHTML(p) {
    const sec = sectionById(p.section);
    const on = liked(p.slug);
    return `<div class="cat-info-in">
      ${sec ? `<p class="cat-chip">${esc(tx(sec.label))}</p>` : ''}
      <h2 class="cat-title">${esc(tx(p.title))}</h2>
      ${tx(p.summary) ? `<p class="cat-sum">${esc(tx(p.summary))}</p>` : ''}
      <div class="cat-acts">
        <a class="btn cat-open" href="#/work/${encodeURIComponent(p.slug)}">${esc(t('openProject'))}</a>
        <button class="btn cat-likeb" type="button" data-like aria-pressed="${on}">${HEART}<span>${esc(t('like'))}</span></button>
      </div>
    </div>`;
  }
  function showInfo(p) {
    const old = [...info.children];
    old.forEach((el) => { el.classList.add('is-out'); setTimeout(() => el.remove(), reduced ? 0 : 260); });
    info.insertAdjacentHTML('beforeend', infoHTML(p));
    const el = info.lastElementChild;
    if (!reduced) el.classList.add('is-in');
  }

  function showBg(p) {
    const b = bgOf(p);
    const key = `${b.kind}|${b.color}|${b.image}|${b.video}`;
    setTheme({ color: b.color, tone: b.tone });       // тон интерфейса (белый или чёрный текст) и цвет полосы браузера
    if (key === S.bgKey) return;
    S.bgKey = key;
    const prev = bgLayers[S.bgOn], next = bgLayers[1 - S.bgOn];
    S.bgOn = 1 - S.bgOn;
    next.style.backgroundColor = b.color;
    next.innerHTML = b.kind === 'image' ? mediaHTML({ image: b.image }, { cls: 'cat-bg-m' })
      : b.kind === 'video' ? mediaHTML({ video: b.video, poster: b.poster }, { cls: 'cat-bg-m' }) : '';
    next.classList.remove('is-on');
    void next.offsetWidth;
    next.classList.add('is-on');
    prev.classList.remove('is-on');
    play(next.querySelector('video'));
    const pv = prev.querySelector('video');
    setTimeout(() => { pause(pv); if (!prev.classList.contains('is-on')) prev.innerHTML = ''; }, 800);
  }

  function heroStyle(pos) {
    const w = heroW(pos.s).toFixed(1);
    return `left:${(pos.x * 100).toFixed(2)}%;top:${(pos.y * 100).toFixed(2)}%;width:${w}px;height:${w}px`;
  }
  // размер визуала — в долях экрана: на широком экране от меньшей из ширины и полуторной высоты, на узком — от ширины
  const heroW = (s) => (S.layout === 'phone' ? S.W : Math.min(S.W, 1.6 * S.H)) * (Number(s) || 0) / 100;
  function showHero(p) {
    const h = heroOf(p, S.layout);
    const key = `${p.slug}|${h.image}|${h.video}|${S.layout}|${JSON.stringify(h.pos)}`;
    if (key === S.heroKey) return;
    const same = S.heroKey.split('|')[0] === p.slug;
    S.heroKey = key;
    const cur = heroBox.querySelector('.cat-hero-l:not(.is-out)');
    // в предпросмотре двигают и масштабируют — тот же проект просто встаёт на новое место, без смены
    if (same && cur) { const m = cur.querySelector('.cat-hero-m'); if (m) m.setAttribute('style', heroStyle(h.pos)); return; }
    if (cur) { cur.classList.add('is-out'); setTimeout(() => cur.remove(), reduced ? 0 : 450); }
    if (!h.image && !h.video) return;
    heroBox.insertAdjacentHTML('beforeend', `<div class="cat-hero-l" data-slug="${esc(p.slug)}"><div class="cat-hero-m" style="${heroStyle(h.pos)}">${mediaHTML(h, { cls: 'cat-hero-media', alt: '' })}</div></div>`);
    const el = heroBox.lastElementChild;
    if (!reduced) el.classList.add('is-in');
    play(el.querySelector('video'));
  }

  // ---------- нажатия ----------
  strip.addEventListener('click', (e) => {
    const card = e.target.closest('.cat-card');
    if (!card || S.dragged) return;
    const i = Number(card.dataset.i);
    if (i === S.idx && S.p === S.target) location.hash = `#/work/${encodeURIComponent(S.list[i].slug)}`;
    else goTo(i);
  });
  info.addEventListener('click', (e) => {
    const b = e.target.closest('[data-like]');
    if (!b) return;
    const p = S.list[S.idx];
    if (!p) return;
    const on = toggleLike(p.slug);
    b.setAttribute('aria-pressed', String(on));
    b.classList.remove('is-pop'); void b.offsetWidth; if (on && !reduced) b.classList.add('is-pop');
    const badge = S.cards[S.idx] && S.cards[S.idx].querySelector('.cat-like');
    if (badge) { badge.hidden = !on; badge.classList.remove('is-pop'); void badge.offsetWidth; if (on && !reduced) badge.classList.add('is-pop'); }
    if (onLike) onLike(p, on);
  });

  // ---------- прокрутка ----------
  cat.addEventListener('wheel', (e) => {
    if (!S.active || !S.list.length || e.ctrlKey) return;       // ctrl + колёсико — масштаб страницы, не трогаем
    if (content.preview && e.target.closest('.cat-hero-m')) return;   // в предпросмотре колёсико над визуалом меняет его размер
    e.preventDefault();
    let d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (e.deltaMode === 1) d *= 18; else if (e.deltaMode === 2) d *= S.H;
    S.target = clamp(S.target + d / (S.step * 0.85), -0.35, S.list.length - 0.65);
    kick();
    clearTimeout(S.wheelT);
    S.wheelT = setTimeout(settle, SETTLE_MS);
  }, { passive: false });

  // Перетаскивание мышью и пальцем — в любую сторону: по горизонтали лента едет под пальцем, вертикальный свайп
  // (вверх — дальше) тоже листает. Отпустили с разгона — лента пролетает дальше и встаёт на проект.
  cat.addEventListener('pointerdown', (e) => {
    if (!S.active || !S.list.length || e.button > 0) return;
    if (e.target.closest('a, [data-like], .cat-hero-m.is-edit')) return;
    S.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, p0: S.p, axis: '', moved: false, hist: [[performance.now(), S.p]] };
    S.dragged = false;
  });
  window.addEventListener('pointermove', (e) => {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      d.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      d.moved = true; S.dragged = true;
      cat.classList.add('is-dragging');
      try { cat.setPointerCapture(d.id); } catch (_) { /* noop */ }
    }
    // по вертикали лента идёт чуть туже: обычный свайп вверх-вниз длиннее бокового, а листать он должен на один проект
    const shift = d.axis === 'x' ? -dx / S.step : -dy / (S.step * 1.1);
    let p = d.p0 + shift;
    const n = S.list.length - 1;
    if (p < 0) p *= 0.35; else if (p > n) p = n + (p - n) * 0.35;   // за краями лента тянется туго
    S.p = S.target = p; S.v = 0;
    const now = performance.now();
    d.hist.push([now, p]);
    while (d.hist.length > 2 && now - d.hist[0][0] > 120) d.hist.shift();
    kick();
  });
  const endDrag = (e) => {
    const d = S.drag;
    if (!d || (e && e.pointerId !== d.id)) return;
    S.drag = null;
    cat.classList.remove('is-dragging');
    if (!d.moved) return;
    const [t0, p0] = d.hist[0], [t1, p1] = d.hist[d.hist.length - 1];
    const vel = t1 > t0 ? (p1 - p0) / ((t1 - t0) / 1000) : 0;          // проектов в секунду
    // куда встать: где отпустили, с поправкой на взмах — но взмах добавляет не больше одного проекта,
    // а даже короткий жест (или быстрый взмах на месте) — уже шаг к соседнему
    let to = Math.round(S.p + clamp(vel * 0.12, -0.45, 0.45));
    const dist = S.p - S.settled;
    if (to === S.settled && (Math.abs(dist) > 0.15 || Math.abs(vel) > 1.5)) to = S.settled + Math.sign(dist || vel);
    goTo(to);
    // разгон пальца переходит в ленту, но не больше, чем нужно, чтобы доехать без проскока и раскачки
    const gap = S.target - S.p, w = Math.sqrt(SPRING_K);
    S.v = Math.sign(vel) === Math.sign(gap) ? Math.sign(gap) * Math.min(Math.abs(vel), w * Math.abs(gap)) : 0;
    setTimeout(() => { S.dragged = false; }, 0);                       // нажатие, которым кончилось перетаскивание, — не нажатие
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  window.addEventListener('keydown', (e) => {
    if (!S.active || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); goTo(S.settled + 1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); goTo(S.settled - 1); }
    else if (k === 'Home') { e.preventDefault(); goTo(0); }
    else if (k === 'End') { e.preventDefault(); goTo(S.list.length - 1); }
  });
  // фокус с клавиатуры на карточке — она и выбирается
  strip.addEventListener('focusin', (e) => { const c = e.target.closest('.cat-card'); if (c && c.matches(':focus-visible')) goTo(Number(c.dataset.i)); });

  window.addEventListener('resize', () => {
    if (!S.active) return;
    const was = S.layout;
    measure(); place();
    if (was !== S.layout && S.list[S.idx]) { S.heroKey = ''; showHero(S.list[S.idx]); }
  });

  // ---------- вход и выход ----------
  const indexOfSection = (id) => S.list.findIndex((p) => p.section === id);
  function setCategory(c) { const n = c || 'all'; S.catNew = n !== S.cat; S.cat = n; }
  function activate(on, { restore = false } = {}) {
    if (!on) {
      if (S.active) S.saved = S.settled;
      S.active = false;
      cancelAnimationFrame(S.raf); S.raf = 0;
      clearTimeout(S.swapT); clearTimeout(S.lookT);
      document.documentElement.classList.remove('is-cat');
      root.querySelectorAll('video').forEach(pause);
      setTheme(null);
      return;
    }
    const was = S.active;
    S.active = true;
    document.documentElement.classList.add('is-cat');
    measure();
    root.querySelectorAll('img[loading="lazy"]').forEach((im, k) => { if (k < 6) im.loading = 'eager'; });
    // вернулись из кейса (или предпросмотр обновился) — тот же проект; пришли с разделом — его первый проект
    let i = restore ? (was ? S.settled : S.saved) : 0;
    if ((!restore || S.catNew) && S.cat !== 'all') { const k = indexOfSection(S.cat); if (k >= 0) i = k; }
    S.catNew = false;
    S.idx = -1;
    goTo(i, true);
    if (!S.list.length && onEmpty) onEmpty();
  }

  // Каталог ещё не открыт, но главная готова: подгружаем картинки первых карточек и первый фон — по одной
  let warmed = false;
  function warm() {
    if (warmed || S.active) return;
    warmed = true;
    const urls = [];
    S.list.slice(0, 5).forEach((p) => { const c = cardOf(p); if (!c.video && c.image) urls.push(c.image); });
    const p0 = S.list[0];
    if (p0) { const h = heroOf(p0, isStack() ? 'phone' : 'desk'); if (h.image) urls.push(h.image); const b = bgOf(p0); if (b.kind === 'image') urls.push(b.image); }
    let k = 0;
    const next = () => { if (k >= urls.length || S.active) return; const im = new Image(); im.decoding = 'async'; im.onload = im.onerror = next; im.src = urls[k++]; };
    next();
  }

  // предпросмотр в админке: показать проект выбранным
  function focus(slug) {
    const i = S.list.findIndex((p) => p.slug === slug);
    if (i < 0 || !S.active) return;
    goTo(i, true);
    if (content.preview) { S.heroKey = ''; showHero(S.list[i]); editHero(); }
  }

  // ---------- предпросмотр: визуал двигают мышью, колёсико меняет размер ----------
  function editHero() {
    const m = heroBox.querySelector('.cat-hero-l:not(.is-out) .cat-hero-m');
    if (!m || m.classList.contains('is-edit')) return;
    m.classList.add('is-edit');
    cat.classList.add('is-edit-hero');      // пунктиром видно, где текст и где будет голова: туда визуал лучше не ставить
    const p = S.list[S.idx];
    const post = (pos) => {
      if (window.parent !== window) window.parent.postMessage({ type: 'ph:hero', slug: p.slug, layout: S.layout, pos }, location.origin);
    };
    const cur = () => heroOf(p, S.layout).pos;
    m.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const start = { x: e.clientX, y: e.clientY, pos: { ...cur() } };
      m.setPointerCapture(e.pointerId);
      m.classList.add('is-moving');
      const move = (ev) => {
        const pos = { ...start.pos, x: clamp(start.pos.x + (ev.clientX - start.x) / S.W, -0.2, 1.2), y: clamp(start.pos.y + (ev.clientY - start.y) / S.H, -0.2, 1.2) };
        m.style.left = `${(pos.x * 100).toFixed(2)}%`; m.style.top = `${(pos.y * 100).toFixed(2)}%`;
        start.last = pos;
      };
      const up = () => {
        m.removeEventListener('pointermove', move); m.removeEventListener('pointerup', up); m.removeEventListener('pointercancel', up);
        m.classList.remove('is-moving');
        if (start.last) post(round(start.last));
      };
      m.addEventListener('pointermove', move); m.addEventListener('pointerup', up); m.addEventListener('pointercancel', up);
    });
    let wt = 0, ws = null;
    m.addEventListener('wheel', (e) => {
      e.preventDefault(); e.stopPropagation();
      const pos = ws || { ...cur() };
      pos.s = clamp(pos.s * Math.exp(-e.deltaY * 0.0015), 4, 160);
      ws = pos;
      m.style.width = m.style.height = `${heroW(pos.s).toFixed(1)}px`;
      clearTimeout(wt); wt = setTimeout(() => { post(round(ws)); ws = null; }, 250);
    }, { passive: false });
  }
  const round = (pos) => ({ x: Math.round(pos.x * 1000) / 1000, y: Math.round(pos.y * 1000) / 1000, s: Math.round(pos.s * 10) / 10 });

  render();
  return { setCategory, activate, render, focus, warm, goTo, state: S };
}
