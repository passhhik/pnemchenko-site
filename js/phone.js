// Телефон с живым экраном — Figma: «Кейс / Телефон» (L — 350, M — 276, S — 208 по ширине; экран 393×852 внутри).
//
// Экран — картинка или сцена. Сцена — как в шоуриле «Своих денег»: фон без анимируемых слоёв, поверх — слои, которые
// появляются по таймлайну и потом спокойно «дышат»; цикл повторяется по кругу. Показываем самое ценное на экране:
// прокрутка до главного, рамка-фокус на ключевом элементе, касание пальцем, свайп карточек.
// Сцена — данные в content/projects.json (поле phone у блока), координаты — в точках экрана 393×852, как в Figma:
//   { src: 'кадр целиком: его видно до запуска и при «уменьшить движение»', pos: 'top|bottom' (какую часть длинного экрана),
//     scene: {
//       base: 'фон без слоёв', h: 852 (высота экрана, у длинных больше), dur: 7 (секунд в цикле),
//       layers: [{ src, x, y, w, h, in: 'pop|burst|up|down|left|right|fly|fade|drop|spread', at: 0.4, d: 0.6,
//                  from: [dx, dy] (для spread), idle: 'bob|float|pulse|wiggle|drift|run' }],   без in — слой стоит всегда
//     Движение — как в шоуриле: акцент на долю трека (488 мс), появление с лёгким перелётом, без затемнения экрана.
//       fixed:  [{ src, at: 'top|bottom', h }]          — шапка, статус-бар, панель кнопок: не едут при прокрутке
//       scroll: [{ to: 435, at: 1.2, d: 2.2 }]           — прокрутка длинного экрана (to — на сколько точек вниз)
//       strip:  { layer: 'имя слоя', steps: [{ to: -345, at: 1, d: .7 }] } — лента карточек едет вбок
//       focus:  [{ x, y, w, h, at, d, r }]               — рамка-фокус на самом важном
//       tap:    [{ x, y, at }]                           — касание пальцем
//       hot:    [{ x, y, w, h, go: 'картинка', label }]  — можно нажать: экран меняется (как в прототипе)
//     } }
// Цикл идёт, только пока телефон на экране; кнопка паузы — в углу телефона (WCAG 2.2.2). При «уменьшить движение» — кадр.
import { esc } from './content.js';

const SCR_W = 393, SCR_H = 852;
const EASE = 'cubic-bezier(.22,.8,.24,1)';       // мягкий выход — как у глав кейса
const EASE_IO = 'cubic-bezier(.45,0,.2,1)';       // прокрутка и лента: разгон и плавная остановка
const reg = new Map();                            // id телефона → описание (сцены большие — в разметку не кладём)
const apis = new WeakMap();                       // телефон → управление его сценой (для пилюль в js/chapters.js)
export const phoneApi = (el) => apis.get(el) || null;
let seq = 0;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const px = (n) => `${Math.round(n * 100) / 100}px`;

// Разметка телефона. size: L | M | S. label — что на экране (для незрячих). opts.reduced — без анимации.
export function phoneHTML(ph, { size = 'M', label = '', cls = '', reduced = false, tilt = false } = {}) {
  if (!ph) return '';
  const p = typeof ph === 'string' ? { src: ph } : ph;
  const sc = !reduced && isObj(p.scene) ? p.scene : null;
  const id = `ph${++seq}`;
  if (sc) reg.set(id, p);
  const alt = esc(label || p.alt || '');
  let inner;
  if (sc) {
    const H = sc.h || SCR_H;
    const lay = (sc.layers || []).map((l, i) => layerHTML(l, i)).join('');
    const fixed = (sc.fixed || []).map((f) => `<img class="sc-fx sc-fx--${f.at === 'bottom' ? 'b' : 't'}" src="${esc(f.src)}" alt="" style="height:${px(f.h)}" decoding="async" loading="lazy">`).join('');
    const hot = (sc.hot || []).map((h, i) => `<button type="button" class="sc-hot" data-hot="${i}" style="left:${px(h.x)};top:${px(h.y)};width:${px(h.w)};height:${px(h.h)}" aria-label="${esc(h.label || '')}"></button>`).join('');
    inner = `<div class="ph-st" style="--sh:${H}"><div class="sc-c" style="height:${px(H)}"><img class="sc-b" src="${esc(sc.base)}" alt="" style="height:${px(H)}" decoding="async" loading="lazy">${lay}<i class="sc-focus" aria-hidden="true"></i><i class="sc-f2" aria-hidden="true"></i>${hot}</div>${fixed}<i class="sc-tap" aria-hidden="true"></i><img class="sc-go" alt="" decoding="async" hidden></div>`;
  } else {
    const pos = p.pos === 'bottom' ? 'bottom' : 'top';
    inner = p.src ? `<img class="ph-img" src="${esc(p.src)}" alt="" style="object-position:50% ${pos === 'bottom' ? '100%' : '0'}" decoding="async" loading="lazy">` : '';
  }
  const ctl = sc ? `<button type="button" class="ph-ctl" data-ph-ctl aria-label="Пауза" aria-pressed="false"><img src="assets/ui/pause.svg" alt="" class="ph-ctl-pause"><img src="assets/ui/play.svg" alt="" class="ph-ctl-play"></button>` : '';
  return `<div class="ph ph--${size}${cls ? ` ${cls}` : ''}" data-ph="${id}"${tilt ? ' data-tilt' : ''}${alt ? ` role="img" aria-label="${alt}"` : ''}><div class="ph-scr">${inner}</div><i class="ph-isl" aria-hidden="true"></i>${ctl}</div>`;
}

function layerHTML(l, i) {
  const st = `left:${px(l.x)};top:${px(l.y)};width:${px(l.w)};height:${px(l.h)}`;
  return `<div class="sc-l" data-l="${i}" style="${st}"><div class="sc-i"><img src="${esc(l.src)}" alt="" decoding="async" loading="lazy"></div></div>`;
}

// ---------- ключевые кадры ----------
// Состояние «до появления» для каждого вида входа
const FROM = {
  pop: { opacity: 0, transform: 'translateY(24px) scale(.86)' },      // карточка: снизу, 86 → 102 → 100 %
  burst: { opacity: 0, transform: 'scale(0)' },                       // значок, надпись: 0 → 112 → 95 → 100 %
  up: { opacity: 0, transform: 'translateY(60px) scale(.86)' },       // блок «выходит» снизу: +60 → −6 → 0
  rise: { opacity: 0, transform: 'translateY(46px)' },
  down: { opacity: 0, transform: 'translateY(-46px)' },
  left: { opacity: 0, transform: 'translateX(-70px)' },
  right: { opacity: 0, transform: 'translateX(70px)' },
  fly: { opacity: 0, transform: 'translate(-260px,30px) rotate(-14deg)' },
  drop: { opacity: 0, transform: 'translateY(-150px)' },
  fade: { opacity: 0, transform: 'none' },
};
const SHOWN = { opacity: 1, transform: 'none' };

// Кадры одного слоя на весь цикл T: ждёт → появляется (с отскоком у pop/drop) → стоит → гаснет к концу цикла
function entranceFrames(l, T) {
  const at = Math.max(0, +l.at || 0), d = Math.max(.15, +l.d || ({ drop: .7, burst: .5, up: .6, pop: .55 }[l.in] || .6));
  const outAt = Math.max(at + d + .2, T - .55), outEnd = Math.min(T - .1, outAt + .4);
  let from = FROM[l.in] || FROM.fade;
  const o = (t) => Math.min(1, Math.max(0, t / T));
  let kf;
  if (l.in === 'spread') {
    // слой объёмной надписи: появляется точно под передним слоем (его не видно) и разъезжается на своё место
    const [dx, dy] = l.from || [0, 0];
    from = { opacity: 0, transform: `translate(${dx}px,${dy}px)` };
    kf = [{ offset: 0, ...from }, { offset: o(at), ...from }, { offset: o(at + .02), opacity: 1, transform: from.transform, easing: EASE }];
  } else {
    kf = [{ offset: 0, ...from }, { offset: o(at), ...from, easing: EASE }];
    // перелёты — по ключам шоурила (кадры 30 к/с: +7/+11/+15 → 233/367/500 мс)
    if (l.in === 'pop') kf.push({ offset: o(at + .233), opacity: 1, transform: 'translateY(-3px) scale(1.02)', easing: 'ease-in-out' });
    if (l.in === 'up') kf.push({ offset: o(at + .1), opacity: 1, transform: 'translateY(40px) scale(.9)', easing: EASE }, { offset: o(at + .233), opacity: 1, transform: 'translateY(-6px) scale(1.02)', easing: 'ease-in-out' });
    if (l.in === 'burst') kf.push({ offset: o(at + .233), opacity: 1, transform: 'scale(1.12)', easing: 'ease-in-out' }, { offset: o(at + .367), opacity: 1, transform: 'scale(.95)', easing: 'ease-in-out' });
    if (l.in === 'drop') kf.push({ offset: o(at + d * .7), opacity: 1, transform: 'translateY(6px)', easing: 'ease-out' });
  }
  kf.push({ offset: o(at + d), ...SHOWN }, { offset: o(outAt), ...SHOWN, easing: 'ease-in' });
  kf.push({ offset: o(outEnd), opacity: 0, transform: 'none' }, { offset: 1, opacity: 0, transform: 'none' });
  return kf;
}
// «Дыхание» после появления — свой короткий цикл
const IDLE = {
  bob: [[{ transform: 'translateY(0)' }, { transform: 'translateY(-7px)' }, { transform: 'translateY(0)' }], 2400],
  float: [[{ transform: 'translateY(0) rotate(0)' }, { transform: 'translateY(-6px) rotate(2.5deg)' }, { transform: 'translateY(0) rotate(0)' }], 3200],
  pulse: [[{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], 1500],
  wiggle: [[{ transform: 'rotate(0)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(3deg)' }, { transform: 'rotate(0)' }], 1800],
  drift: [[{ transform: 'translateX(18px)' }, { transform: 'translateX(-18px)' }], 520],
  // свин бежит на месте: шаг 333 мс, подскок 16, сплющивание при приземлении, наклон −5 ± 3° (как в шоуриле)
  run: [[{ transform: 'translateY(0) rotate(-8deg) scale(1.07,.92)' }, { transform: 'translateY(-16px) rotate(-3deg) scale(.98,1.03)', offset: .45 }, { transform: 'translateY(0) rotate(-8deg) scale(1.07,.92)' }], 333],
};
// Прокрутка и лента: значение по сегментам [{to, at, d}] — между сегментами стоит
function segFrames(steps, T, prop, start = 0) {
  const o = (t) => Math.min(1, Math.max(0, t / T));
  const kf = [{ offset: 0, transform: prop(start) }];
  let cur = start;
  for (const s of steps) {
    kf.push({ offset: o(s.at), transform: prop(cur), easing: EASE_IO });
    cur = +s.to || 0;
    kf.push({ offset: o(s.at + (s.d || .8)), transform: prop(cur) });
  }
  kf.push({ offset: 1, transform: prop(cur) });
  return kf.sort((a, b) => a.offset - b.offset);
}

// ---------- запуск сцен ----------
// Вызывается после вставки разметки. Возвращает destroy().
export function initPhones(root, { reduced = false } = {}) {
  const phones = [...root.querySelectorAll('[data-ph]')];
  if (!phones.length) return () => {};
  // экран 393×852 масштабируется под ширину телефона
  const fit = (ph) => {
    const scr = ph.querySelector('.ph-scr');
    const w = scr ? scr.clientWidth : 0;
    if (w) ph.style.setProperty('--k', (w / SCR_W).toFixed(5));
  };
  phones.forEach(fit);
  const ro = 'ResizeObserver' in window ? new ResizeObserver((es) => es.forEach((e) => fit(e.target.closest('[data-ph]') || e.target))) : null;
  if (ro) phones.forEach((ph) => ro.observe(ph.querySelector('.ph-scr') || ph));

  const live = [];
  for (const ph of phones) {
    const spec = reg.get(ph.dataset.ph);
    if (!spec || reduced) continue;
    const s = makeScene(ph, spec);
    apis.set(ph, s.api);
    live.push(s);
  }
  // играем, только пока телефон виден хотя бы на треть
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
    for (const e of es) { const s = live.find((x) => x.el === e.target); if (s) s.visible(e.isIntersecting); }
  }, { threshold: .35 }) : null;
  live.forEach((s) => (io ? io.observe(s.el) : s.visible(true)));

  // наклон телефона за курсором (только мышь): мягко, до 6°
  const tilts = reduced || !matchMedia('(hover:hover) and (pointer:fine)').matches ? [] : phones.filter((ph) => ph.hasAttribute('data-tilt'));
  const offs = tilts.map((ph) => {
    const move = (e) => {
      const r = ph.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      ph.style.setProperty('--rx', `${(-y * 7).toFixed(2)}deg`); ph.style.setProperty('--ry', `${(x * 9).toFixed(2)}deg`);
    };
    const leave = () => { ph.style.setProperty('--rx', '0deg'); ph.style.setProperty('--ry', '0deg'); };
    ph.addEventListener('pointermove', move); ph.addEventListener('pointerleave', leave);
    return () => { ph.removeEventListener('pointermove', move); ph.removeEventListener('pointerleave', leave); };
  });

  return () => {
    io && io.disconnect(); ro && ro.disconnect();
    live.forEach((s) => s.destroy());
    offs.forEach((f) => f());
    phones.forEach((ph) => reg.delete(ph.dataset.ph));
  };
}

function makeScene(el, spec) {
  const sc = spec.scene, T = Math.max(2, +sc.dur || 7), ms = T * 1000;
  const anims = [];
  const run = (node, kf, opt) => { if (!node) return null; const a = node.animate(kf, { duration: ms, iterations: Infinity, fill: 'both', ...opt }); a.pause(); anims.push(a); return a; };
  const st = el.querySelector('.ph-st'), cont = el.querySelector('.sc-c');
  // слои: вход и уход по таймлайну цикла, «дыхание» — своим циклом
  (sc.layers || []).forEach((l, i) => {
    const node = el.querySelector(`.sc-l[data-l="${i}"]`);
    if (!node) return;
    if (!l.still && l.in) run(node, entranceFrames(l, T));
    if (l.idle && IDLE[l.idle]) {
      const [kf, dur] = IDLE[l.idle];
      const a = node.querySelector('.sc-i').animate(kf, { duration: dur, iterations: Infinity, easing: 'ease-in-out', direction: l.idle === 'drift' ? 'alternate' : 'normal', delay: -(i * 377) % dur });
      a.pause(); anims.push(a);
    }
  });
  // прокрутка длинного экрана
  if (sc.scroll && sc.scroll.length) run(cont, segFrames(sc.scroll, T, (v) => `translateY(${-v}px)`));
  // лента карточек едет вбок
  if (sc.strip && sc.strip.steps) {
    const li = (sc.layers || []).findIndex((l) => l.name === sc.strip.layer);
    const node = li >= 0 ? el.querySelector(`.sc-l[data-l="${li}"] .sc-i`) : null;
    run(node, segFrames(sc.strip.steps, T, (v) => `translateX(${v}px)`));
  }
  // рамка-фокус: переезжает с одного важного места на другое, между ними гаснет
  const fo = el.querySelector('.sc-focus');
  if (fo && sc.focus && sc.focus.length) {
    const o = (t) => Math.min(1, Math.max(0, t / T));
    const box = (f) => ({ left: px(f.x - 3), top: px(f.y - 3), width: px(f.w + 6), height: px(f.h + 6), borderRadius: px((f.r ?? 16) + 3) });
    const kf = [];
    const first = sc.focus[0];
    kf.push({ offset: 0, opacity: 0, transform: 'scale(.96)', ...box(first) });
    sc.focus.forEach((f, i) => {
      const end = f.at + (f.d || 1.6);
      kf.push({ offset: o(f.at), opacity: 0, transform: 'scale(.96)', ...box(f), easing: EASE });
      kf.push({ offset: o(f.at + .3), opacity: 1, transform: 'scale(1)', ...box(f) });
      kf.push({ offset: o(end), opacity: 1, transform: 'scale(1)', ...box(f), easing: 'ease-in' });
      kf.push({ offset: o(end + .35), opacity: 0, transform: 'scale(1)', ...box(f) });
      if (i === sc.focus.length - 1) kf.push({ offset: 1, opacity: 0, transform: 'scale(1)', ...box(f) });
    });
    run(fo, kf.sort((a, b) => a.offset - b.offset));
  }
  // касания пальцем
  const tap = el.querySelector('.sc-tap');
  if (tap && sc.tap && sc.tap.length) {
    const o = (t) => Math.min(1, Math.max(0, t / T));
    const kf = [{ offset: 0, opacity: 0, transform: 'translate(-50%,-50%) scale(.5)', left: px(sc.tap[0].x), top: px(sc.tap[0].y) }];
    sc.tap.forEach((t) => {
      const pos = { left: px(t.x), top: px(t.y) };
      kf.push({ offset: o(t.at - .01), opacity: 0, transform: 'translate(-50%,-50%) scale(.7)', ...pos, easing: 'ease-out' });
      kf.push({ offset: o(t.at + .1), opacity: 1, transform: 'translate(-50%,-50%) scale(1)', ...pos, easing: 'ease-in-out' });
      kf.push({ offset: o(t.at + .2), opacity: 1, transform: 'translate(-50%,-50%) scale(.96)', ...pos, easing: 'ease-in' });
      kf.push({ offset: o(t.at + .367), opacity: 0, transform: 'translate(-50%,-50%) scale(1.25)', ...pos });
    });
    kf.push({ offset: 1, opacity: 0, transform: 'translate(-50%,-50%) scale(.5)' });
    run(tap, kf.sort((a, b) => a.offset - b.offset));
  }
  // синхронно: все анимации цикла стартуют с одного времени
  const loops = anims.slice();
  let shown = false, userPaused = false, playing = false;
  const sync = () => {
    const go = shown && !userPaused && !el.classList.contains('is-hold');
    if (go === playing) return;
    playing = go;
    loops.forEach((a) => (go ? a.play() : a.pause()));
    el.classList.toggle('is-paused', !go && userPaused);
  };
  // кнопка паузы
  const ctl = el.querySelector('[data-ph-ctl]');
  const onCtl = (e) => {
    e.stopPropagation();
    userPaused = !userPaused;
    ctl.setAttribute('aria-pressed', String(userPaused));
    ctl.setAttribute('aria-label', userPaused ? 'Продолжить' : 'Пауза');
    sync();
  };
  ctl && ctl.addEventListener('click', onCtl);
  // нажимаемые места: экран меняется, как в прототипе; через 2,8 с (или по второму нажатию) — обратно в цикл
  const go = el.querySelector('.sc-go');
  let hotT = 0;
  const hotBack = () => { clearTimeout(hotT); go.classList.remove('is-on'); el.classList.remove('is-hold'); setTimeout(() => { if (!go.classList.contains('is-on')) go.hidden = true; }, 400); sync(); };
  const onHot = (e) => {
    const b = e.target.closest('[data-hot]');
    if (!b || !go) return;
    const h = sc.hot[+b.dataset.hot];
    if (go.classList.contains('is-on')) { hotBack(); return; }
    go.src = h.go; go.hidden = false;
    el.classList.add('is-hold'); sync();
    requestAnimationFrame(() => go.classList.add('is-on'));
    clearTimeout(hotT); hotT = setTimeout(hotBack, 2800);
  };
  st && st.addEventListener('click', onHot);
  // управление снаружи: показать конкретное место (пилюли рядом с телефоном) и вернуться в цикл
  const main = anims.find((a) => a.effect && a.effect.getTiming().duration === ms) || null;
  const f2 = el.querySelector('.sc-f2');
  const ready = Math.max(0, ...(sc.scroll || []).map((s) => (s.at + (s.d || .8)) * 1000));
  const api = {
    hold(i) {
      const f = (sc.focus || [])[i];
      if (!f) return;
      anims.forEach((a) => { const d = a.effect.getTiming().duration; if (d !== ms) return; const t = (a.currentTime || 0) % ms; if (t < ready) a.currentTime = (a.currentTime || 0) - t + ready; });
      el.classList.add('is-hold', 'is-manual'); sync();
      if (f2) Object.assign(f2.style, { left: px(f.x - 4), top: px(f.y - 4), width: px(f.w + 8), height: px(f.h + 8), borderRadius: px((f.r ?? 16) + 4) });
    },
    release() { el.classList.remove('is-hold', 'is-manual'); sync(); },
    focusIndex() {
      if (!main) return -1;
      const t = ((main.currentTime || 0) % ms) / 1000;
      return (sc.focus || []).findIndex((f) => t >= f.at && t < f.at + (f.d || 1.6) + .3);
    },
  };
  return {
    el, api,
    visible(v) { shown = v; sync(); },
    destroy() { anims.forEach((a) => a.cancel()); clearTimeout(hotT); ctl && ctl.removeEventListener('click', onCtl); st && st.removeEventListener('click', onHot); },
  };
}

// ---------- смена картинок по кругу (например, эмоции свиньи в карточке) ----------
export function initCycles(root, { reduced = false } = {}) {
  const els = [...root.querySelectorAll('[data-cycle]')];
  if (reduced || !els.length) return () => {};
  const timers = [];
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { e.target.dataset.vis = e.isIntersecting ? '1' : ''; }), { threshold: .3 }) : null;
  for (const el of els) {
    const imgs = [...el.querySelectorAll('img')];
    if (imgs.length < 2) continue;
    io ? io.observe(el) : (el.dataset.vis = '1');
    let i = 0;
    timers.push(setInterval(() => {
      if (!el.dataset.vis || document.hidden) return;
      imgs[i].classList.remove('is-on');
      i = (i + 1) % imgs.length;
      imgs[i].classList.add('is-on');
    }, +el.dataset.cycle || 1600));
  }
  return () => { timers.forEach(clearInterval); io && io.disconnect(); };
}
