// Телефон с живым экраном — Figma: «Кейс / Телефон» (L — 350, M — 276, S — 208 по ширине; экран 393×852 внутри).
//
// Экран — картинка или сцена. Сцена — как в шоуриле «Своих денег»: фон без анимируемых слоёв, поверх — слои, которые
// появляются по таймлайну и потом спокойно «дышат»; цикл повторяется по кругу. Показываем самое ценное на экране:
// прокрутка до главного, рамка-фокус на ключевом элементе, касание пальцем, свайп карточек.
// Сцена — данные в content/projects.json (поле phone у блока), координаты — в точках экрана 393×852, как в Figma:
//   { src: 'кадр целиком: его видно до запуска и при «уменьшить движение»', pos: 'top|bottom' (какую часть длинного экрана),
//     scene: {
//       base: 'фон без слоёв', h: 852 (высота экрана, у длинных больше), dur: 7 (секунд в цикле),
//       layers: [{ src, x, y, w, h, in: 'pop|burst|up|slam|tile|down|left|right|fly|fade|drop|spread', at: 0.4, d: 0.6,
//                  from: [dx, dy] (для spread), idle: 'bob|float|pulse|wiggle|drift|run', press: [2.1] (нажатие кнопки) }],
//                  без in — слой стоит всегда
//     Движение — по скриптам шоурила (03_Scripts/build_segment_*.jsx): кадры 30 к/с, изинги After Effects «скорость 0,
//     влияние выход → вход», акцент на долю трека (488 мс), появление с лёгким перелётом, без затемнения экрана.
//       fixed:  [{ src, at: 'top|bottom', h }]          — шапка, статус-бар, панель кнопок: не едут при прокрутке
//       scroll: [{ to: 435, at: 1.2, d: 2.2 }]           — прокрутка длинного экрана (to — на сколько точек вниз)
//       strip:  { layer: 'имя слоя', steps: [{ to: -345, at: 1, d: .7 }] } — лента карточек едет вбок
//       focus:  [{ x, y, w, h, at, d, r }]               — рамка-фокус на самом важном
//       tap:    [{ x, y, at }]                           — касание пальцем
//       hot:    [{ x, y, w, h, go: 'картинка', label }]  — можно нажать: экран меняется (как в прототипе)
//       pops:   [{ src, x, y, w, h, at, d, slots: [[x, y, w, h, r]], with: ['имя слоя'] }]
//               — блок «выходит из экрана» к зрителю: копия над телефоном +22 % и выше на 9 pt, две мягкие тени,
//                 в экране на его месте — пустое место #EDEEEE (как фокус на главной в шоуриле)
//     } }
// Цикл идёт, только пока телефон на экране; кнопка паузы — в углу телефона (WCAG 2.2.2). При «уменьшить движение» — кадр.
import { esc } from './content.js';

const SCR_W = 393, SCR_H = 852;
// Изинг ключа After Effects (скорость 0, влияние выхода и входа в процентах) → кривая Безье для браузера
const ae = (o, i) => `cubic-bezier(${o / 100},0,${(1 - i / 100).toFixed(2)},1)`;
const F = (n) => n / 30;                          // кадры шоурила (30 к/с) → секунды
const EASE = ae(30, 85);                          // основной ход шоурила: мягкий старт и долгий довод
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
    const slots = (sc.pops || []).map((q, i) => (q.slots || []).map((r) => `<i class="sc-slot" data-slot="${i}" style="left:${px(r[0])};top:${px(r[1])};width:${px(r[2])};height:${px(r[3])};border-radius:${px(r[4] || 0)}"></i>`).join('')).join('');
    inner = `<div class="ph-st" style="--sh:${H}"><div class="sc-c" style="height:${px(H)}"><img class="sc-b" src="${esc(sc.base)}" alt="" style="height:${px(H)}" decoding="async" loading="lazy">${slots}${lay}<i class="sc-focus" aria-hidden="true"></i><i class="sc-f2" aria-hidden="true"></i>${hot}</div>${fixed}<i class="sc-tap" aria-hidden="true"></i><img class="sc-go" alt="" decoding="async" hidden></div>`;
  } else {
    const pos = p.pos === 'bottom' ? 'bottom' : 'top';
    inner = p.src ? `<img class="ph-img" src="${esc(p.src)}" alt="" style="object-position:50% ${pos === 'bottom' ? '100%' : '0'}" decoding="async" loading="lazy">` : '';
  }
  const ctl = sc ? `<button type="button" class="ph-ctl" data-ph-ctl aria-label="Пауза анимации${alt ? `: ${alt}` : ''}" aria-pressed="false"><img src="assets/ui/pause.svg" alt="" class="ph-ctl-pause"><img src="assets/ui/play.svg" alt="" class="ph-ctl-play"></button>` : '';
  const role = alt ? (sc && sc.hot && sc.hot.length ? ` role="group" aria-label="${alt}"` : ` role="img" aria-label="${alt}"`) : '';
  return `<div class="ph ph--${size}${cls ? ` ${cls}` : ''}" data-ph="${id}"${tilt ? ' data-tilt' : ''}><div class="ph-scr"${role}>${inner}</div><i class="ph-isl" aria-hidden="true"></i>${sc ? popsHTML(sc) : ''}${ctl}</div>`;
}

// Блоки, которые «выходят из экрана»: свой слой над телефоном (вне маски экрана), в тех же точках экрана
function popsHTML(sc) {
  if (!sc.pops || !sc.pops.length) return '';
  const lay = sc.layers || [];
  const items = sc.pops.map((q, i) => {
    const w = (q.with || []).map((n) => lay.find((l) => l.name === n)).filter(Boolean)
      .map((l) => `<img class="pop-w" src="${esc(l.src)}" alt="" style="left:${px(l.x - q.x)};top:${px(l.y - q.y)};width:${px(l.w)};height:${px(l.h)}" decoding="async" loading="lazy">`).join('');
    const im = `<img src="${esc(q.src)}" alt="" decoding="async" loading="lazy">`;
    // sh: [{ src, x, y, w, h }] — мягкая и контактная тень, уже размытые, в точках относительно блока
    const sh = (k) => { const t = (q.sh || [])[k]; return t ? `<img src="${esc(t.src)}" alt="" style="left:${px(t.x)};top:${px(t.y)};width:${px(t.w)};height:${px(t.h)}" decoding="async" loading="lazy">` : ''; };
    return `<div class="pop" data-pop="${i}" style="left:${px(q.x)};top:${px(q.y)};width:${px(q.w)};height:${px(q.h)}"><div class="pop-sh pop-sh--s">${sh(0)}</div><div class="pop-sh pop-sh--c">${sh(1)}</div><div class="pop-im">${im}${w}</div></div>`;
  }).join('');
  return `<div class="ph-pop" aria-hidden="true"><div class="ph-st"><div class="pop-c" style="height:${px(sc.h || SCR_H)}">${items}</div></div></div>`;
}

function layerHTML(l, i) {
  const st = `left:${px(l.x)};top:${px(l.y)};width:${px(l.w)};height:${px(l.h)}`;
  return `<div class="sc-l" data-l="${i}" style="${st}"><div class="sc-i"><img src="${esc(l.src)}" alt="" decoding="async" loading="lazy"></div></div>`;
}

// ---------- ключевые кадры ----------
// Вход слоя — по ключам скриптов шоурила. Ключ: [время от начала входа (с), трансформация, изинг до следующего ключа].
// Экран в After Effects — 786 px, у нас 393 pt: сдвиги пополам. Прозрачность идёт отдельной, быстрой анимацией.
const IN = {
  // блок «выходит» снизу (buildIn): +30 → −3 → 0 pt, 86 → 102 → 100 %, за 7 + 4 кадра
  up: { tf: [[0, 'translateY(30px) scale(.86)', ae(30, 80)], [F(7), 'translateY(-3px) scale(1.02)', ae(50, 60)], [F(11), 'none']], op: F(3) },
  // карточка, чип: 82 → 104 → 100 %, за 9 + 5 кадров
  pop: { tf: [[0, 'translateY(12px) scale(.82)', ae(30, 70)], [F(9), 'translateY(-1px) scale(1.04)', ae(50, 60)], [F(14), 'none']], op: F(5) },
  // значок, кружок успеха: 0 → 112 → 96 → 100 %
  burst: { tf: [[0, 'scale(0)', ae(20, 72)], [F(7), 'scale(1.12)', ae(50, 55)], [F(11), 'scale(.96)', ae(55, 60)], [F(15), 'none']], op: F(2) },
  // слово падает в кадр с огромного масштаба и бьёт в долю (slam): удар — в момент at
  slam: { tf: [[-F(2), 'scale(2.35) rotate(-9deg)', ae(30, 60)], [0, 'scale(1) rotate(1.5deg)', ae(60, 50)], [F(2), 'scale(.93) rotate(1deg)', ae(50, 50)], [F(5), 'scale(1.02) rotate(.3deg)', ae(50, 50)], [F(8), 'none']], op: F(1), op0: -F(2) },
  // плитка контекста съезжает сверху на место (экран мамы): −22 pt за 19 кадров, проявление за 11
  tile: { tf: [[0, 'translateY(-22px)', ae(30, 90)], [F(19), 'none']], op: F(11) },
};
const SLIDE = { rise: 'translateY(46px)', down: 'translateY(-46px)', left: 'translateX(-70px)', right: 'translateX(70px)', fly: 'translate(-260px,30px) rotate(-14deg)' };

// Кадры одного слоя на весь цикл T: ждёт → появляется (с отскоком) → стоит → гаснет к концу цикла.
// Возвращает две анимации: трансформацию и прозрачность (так у каждой свой изинг, как в After Effects)
function entranceFrames(l, T) {
  const at = Math.max(0, +l.at || 0);
  const o = (t) => Math.min(1, Math.max(0, t / T));
  let tf, opIn = .2, op0 = 0;
  if (IN[l.in]) {
    tf = IN[l.in].tf.map(([t, v, e]) => [at + t, v, e]);
    opIn = IN[l.in].op; op0 = IN[l.in].op0 || 0;
  } else if (l.in === 'spread') {
    // слой объёмной надписи: появляется точно под передним слоем (его не видно) и разъезжается на своё место
    const [dx, dy] = l.from || [0, 0], d = Math.max(.15, +l.d || .2);
    tf = [[at, `translate(${dx}px,${dy}px)`, EASE], [at + d, 'none']]; opIn = .02;
  } else if (l.in === 'drop') {
    const d = Math.max(.15, +l.d || .7);
    tf = [[at, 'translateY(-150px)', ae(30, 70)], [at + d * .7, 'translateY(6px)', ae(50, 60)], [at + d, 'none']]; opIn = d * .3;
  } else if (SLIDE[l.in]) {
    const d = Math.max(.15, +l.d || .6);
    tf = [[at, SLIDE[l.in], EASE], [at + d, 'none']]; opIn = d * .45;
  } else {
    const d = Math.max(.15, +l.d || .6);
    tf = [[at, 'none'], [at + d, 'none']]; opIn = d;   // fade
  }
  const end = tf[tf.length - 1][0];
  const outAt = Math.max(end + .2, T - .55), outEnd = Math.min(T - .1, outAt + .4);
  const tk = [{ offset: 0, transform: tf[0][1] }];
  tf.forEach(([t, v, e]) => tk.push({ offset: o(t), transform: v, ...(e ? { easing: e } : {}) }));
  tk.push({ offset: 1, transform: 'none' });
  const s0 = at + op0;
  const ok = [{ offset: 0, opacity: 0 }, { offset: o(s0), opacity: 0, easing: ae(40, 60) }, { offset: o(s0 + opIn), opacity: 1 },
    { offset: o(outAt), opacity: 1, easing: 'ease-in' }, { offset: o(outEnd), opacity: 0 }, { offset: 1, opacity: 0 }];
  return { tf: tk, op: ok };
}
// Нажатие кнопки под пальцем (шоурил: 100 → 94 → 101 → 100 %, кадры −1 / +2 / +7 / +10 от касания)
function pressFrames(times, T) {
  const o = (t) => Math.min(1, Math.max(0, t / T));
  const kf = [{ offset: 0, transform: 'none' }];
  times.forEach((t) => kf.push(
    { offset: o(t - F(1)), transform: 'none', easing: ae(40, 70) },
    { offset: o(t + F(2)), transform: 'scale(.94)', easing: ae(50, 50) },
    { offset: o(t + F(7)), transform: 'scale(1.01)', easing: ae(50, 60) },
    { offset: o(t + F(10)), transform: 'none' }));
  kf.push({ offset: 1, transform: 'none' });
  return kf.sort((x, y) => x.offset - y.offset);
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
  const order = new Map();
  for (const ph of phones) {
    const spec = reg.get(ph.dataset.ph);
    if (!spec || reduced) continue;
    const blk = ph.closest('[data-b]') || root, n = order.get(blk) || 0;
    order.set(blk, n + 1);
    const s = makeScene(ph, spec, n * 1.2);
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

function makeScene(el, spec, phase = 0) {
  const sc = spec.scene, T = Math.max(2, +sc.dur || 7), ms = T * 1000;
  const anims = [];
  const run = (node, kf, opt) => { if (!node) return null; const a = node.animate(kf, { duration: ms, iterations: Infinity, fill: 'both', ...opt }); a.pause(); anims.push(a); return a; };
  const st = el.querySelector('.ph-st'), cont = el.querySelector('.sc-c');
  // слои: вход и уход по таймлайну цикла, «дыхание» — своим циклом
  (sc.layers || []).forEach((l, i) => {
    const node = el.querySelector(`.sc-l[data-l="${i}"]`);
    if (!node) return;
    if (!l.still && l.in) { const e = entranceFrames(l, T); run(node, e.tf); run(node, e.op); }
    if (l.press && l.press.length) run(node.querySelector('img'), pressFrames(l.press, T));
    if (l.idle && IDLE[l.idle]) {
      const [kf, dur] = IDLE[l.idle];
      const a = node.querySelector('.sc-i').animate(kf, { duration: dur, iterations: Infinity, easing: 'ease-in-out', direction: l.idle === 'drift' ? 'alternate' : 'normal', delay: -(i * 377) % dur });
      a.pause(); anims.push(a);
    }
  });
  // прокрутка длинного экрана
  const popC = el.querySelector('.pop-c');
  if (sc.scroll && sc.scroll.length) {
    run(cont, segFrames(sc.scroll, T, (v) => `translateY(${-v}px)`));
    if (popC) run(popC, segFrames(sc.scroll, T, (v) => `translateY(${-v}px)`));
  }
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
    const box = (f) => ({ left: px(f.x - 7), top: px(f.y - 7), width: px(f.w + 14), height: px(f.h + 14), borderRadius: px((f.r ?? 16) + 7) });
    const kf = [];
    const first = sc.focus[0];
    kf.push({ offset: 0, opacity: 0, transform: 'scale(.96,.92)', ...box(first) });
    sc.focus.forEach((f, i) => {
      // следующий фокус не должен начаться, пока этот не погас: иначе рамка переезжает видимой
      const next = i + 1 < sc.focus.length ? sc.focus[i + 1].at : T;
      const end = Math.min(f.at + (f.d || 1.6), next - F(8)), gone = Math.min(end + F(20), next - .001);
      kf.push({ offset: o(f.at), opacity: 0, transform: 'scale(.96,.92)', ...box(f), easing: ae(30, 80) });
      kf.push({ offset: o(f.at + F(14)), opacity: 1, transform: 'scale(1)', ...box(f) });
      kf.push({ offset: o(end), opacity: 1, transform: 'scale(1)', ...box(f), easing: ae(40, 60) });
      kf.push({ offset: o(gone), opacity: 0, transform: 'scale(1)', ...box(f) });
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
      kf.push({ offset: o(t.at - F(3)), opacity: 0, transform: 'translate(-50%,-50%) scale(.7)', ...pos, easing: ae(65, 65) });
      kf.push({ offset: o(t.at), opacity: 1, transform: 'translate(-50%,-50%) scale(1)', ...pos, easing: ae(60, 60) });
      kf.push({ offset: o(t.at + F(4)), opacity: 1, transform: 'translate(-50%,-50%) scale(.96)', ...pos, easing: ae(60, 60) });
      kf.push({ offset: o(t.at + F(10)), opacity: 0, transform: 'translate(-50%,-50%) scale(1.28)', ...pos });
    });
    kf.push({ offset: 1, opacity: 0, transform: 'translate(-50%,-50%) scale(.5)' });
    run(tap, kf.sort((a, b) => a.offset - b.offset));
  }
  // блок «выходит из экрана» к зрителю (фокус главной в шоуриле): копия над телефоном +22 % и на 9 pt выше,
  // мягкая и контактная тени растут вместе с выездом; в экране на месте блока — пустое место; без затемнения
  (sc.pops || []).forEach((q, i) => {
    const p = el.querySelector(`.pop[data-pop="${i}"]`);
    if (!p) return;
    const o = (t) => Math.min(1, Math.max(0, t / T)), e = .0001;
    const a = Math.max(e, +q.at || 0), end = a + (+q.d || 1.85), peak = a + F(14), back = end - F(10);
    const hold = [{ offset: 0, opacity: 0 }, { offset: o(a) - e, opacity: 0 }, { offset: o(a), opacity: 1 }, { offset: o(end), opacity: 1 }, { offset: Math.min(1, o(end) + e), opacity: 0 }, { offset: 1, opacity: 0 }];
    const lift = (up, k, opv) => [
      { offset: 0, transform: 'none', opacity: 0 },
      { offset: o(a), transform: 'none', opacity: 0, easing: ae(30, 90) },
      { offset: o(peak), transform: `translateY(${up}px) scale(${k})`, opacity: opv },
      { offset: o(back), transform: `translateY(${up}px) scale(${k})`, opacity: opv, easing: ae(55, 80) },
      { offset: o(end), transform: 'none', opacity: 0 }, { offset: 1, transform: 'none', opacity: 0 }];
    run(p, hold);
    run(p.querySelector('.pop-im'), lift(-9, 1.22, 1).map((k) => ({ ...k, opacity: 1 })));
    run(p.querySelector('.pop-sh--s'), lift(8, 1.196, .3));
    run(p.querySelector('.pop-sh--c'), lift(-4, 1.22, .16));
    el.querySelectorAll(`.sc-slot[data-slot="${i}"]`).forEach((sl) => run(sl, hold));
    // слои, которые выходят вместе с блоком (свинья на балансе, монеты на уроке): в экране на это время прячем
    (q.with || []).forEach((n) => {
      const li = (sc.layers || []).findIndex((l) => l.name === n);
      const img = li >= 0 ? el.querySelector(`.sc-l[data-l="${li}"] img`) : null;
      if (img) run(img, hold.map((k) => ({ ...k, opacity: 1 - k.opacity })));
    });
  });

  // синхронно: все анимации цикла стартуют с одного времени
  // сдвиг по фазе для соседей (в секундах): все анимации этого телефона сдвигаются вместе и остаются синхронными
  if (phase) anims.forEach((a) => { if (a.effect.getTiming().duration === ms) a.currentTime = (phase * 1000) % ms; });
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
    ctl.setAttribute('aria-pressed', String(userPaused));   // подпись постоянная, меняется только «нажата / не нажата»
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
    go.src = h.go; go.alt = h.label || ''; go.hidden = false;
    el.classList.add('is-hold'); sync();
    requestAnimationFrame(() => go.classList.add('is-on'));
    // экран сам возвращается через 2,8 с — но не пока фокус с клавиатуры внутри телефона
    const back = () => { const a = document.activeElement; if (a && el.contains(a) && a.matches(':focus-visible')) { hotT = setTimeout(back, 2800); return; } hotBack(); };
    clearTimeout(hotT); hotT = setTimeout(back, 2800);
  };
  st && st.addEventListener('click', onHot);
  // управление снаружи: показать конкретное место (пилюли рядом с телефоном) и вернуться в цикл
  const main = anims.find((a) => a.effect && a.effect.getTiming().duration === ms) || null;
  const f2 = el.querySelector('.sc-f2');

  const api = {
    hold(i) {
      const f = (sc.focus || [])[i];
      if (!f) return;
      const tt = (f.at + .35) * 1000;
      anims.forEach((a) => { if (a.effect.getTiming().duration !== ms) return; const c = a.currentTime || 0; a.currentTime = c - (c % ms) + tt; });
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
