// «Заплёванный экран» — пасхалка на долгое бездействие. Когда и сколько плевать, решает js/app.js,
// как при этом двигается голова — js/head.js (spit). Здесь всё, что остаётся на «стекле»:
// летящий плевок, клякса с бликами и пузырьками, брызги и подтёки.
//
// Устройство слоя (.spit, поверх страницы, клики пропускает):
//   .spit-blur  — ОДИН слой с backdrop-filter, обрезанный по объединённому контуру всех клякс (clip-path):
//                 сквозь слюну страница видна размытой. Один слой на все кляксы — дёшево даже на телефоне;
//   .spit-blob  — рисунок каждой кляксы (SVG): тень на стекле, тело, тёмный и светлый ободок, блики, пузырьки;
//                 рядом брызги и подтёки, которые медленно ползут вниз.
// Покрытие экрана считается по сетке клеток: следующий плевок летит в ещё чистое место, а когда чистого
// почти не осталось — последний, во весь экран.

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const f1 = (v) => (Math.round(v * 10) / 10).toString();

const DEFS = `<svg class="spit-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
  <radialGradient id="spit-body" cx=".4" cy=".34" r=".72">
    <stop offset="0" stop-color="#fff" stop-opacity=".24"/><stop offset=".5" stop-color="#eef4f8" stop-opacity=".07"/>
    <stop offset=".86" stop-color="#c3d3e0" stop-opacity=".3"/><stop offset="1" stop-color="#9fb5c7" stop-opacity=".52"/>
  </radialGradient>
  <linearGradient id="spit-light" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".45" stop-color="#fff" stop-opacity=".4"/><stop offset=".75" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="spit-dark" x1="0" y1="0" x2="1" y2="1">
    <stop offset=".2" stop-color="#2e4558" stop-opacity="0"/><stop offset=".6" stop-color="#2e4558" stop-opacity=".16"/><stop offset="1" stop-color="#2e4558" stop-opacity=".4"/>
  </linearGradient>
</defs></svg>`;

// Контур кляксы: неровный круг (пара плавных гармоник, а не «шестерёнка») с несколькими узкими выплесками-«пальцами»
// со скруглённым кончиком; чуть оплывает вниз. Точки [x, y] — вокруг (0, 0); fingers — углы и длины выплесков.
function blobShape(r) {
  const TAU = Math.PI * 2, a0 = rnd(0, TAU);
  const h2 = rnd(0.04, 0.1), p2 = rnd(0, TAU), h3 = rnd(0.03, 0.08), p3 = rnd(0, TAU), h5 = rnd(0.01, 0.035), p5 = rnd(0, TAU);
  const edge = (a) => 1 + h2 * Math.sin(2 * a + p2) + h3 * Math.sin(3 * a + p3) + h5 * Math.sin(5 * a + p5);
  let ring = [];
  for (let i = 0; i < 16; i++) { const a = a0 + (i / 16) * TAU; ring.push([a, edge(a)]); }
  const fingers = [];
  for (let i = 0, n = 2 + Math.floor(Math.random() * 4), guard = 0; i < n && guard < 40; guard++) {
    const a = a0 + rnd(0, TAU);
    if (fingers.some((f) => Math.abs(Math.atan2(Math.sin(f[0] - a), Math.cos(f[0] - a))) < 0.75)) continue;
    fingers.push([a, rnd(1.35, 1.85), rnd(0.085, 0.14)]);
    i++;
  }
  for (const [a, len, w] of fingers) {
    const near = (q) => Math.abs(Math.atan2(Math.sin(q - a), Math.cos(q - a)));
    ring = ring.filter((q) => near(q[0]) > w * 2.6);
    const side = 1 + (len - 1) * 0.7;
    ring.push([a - w * 2.3, edge(a - w * 2.3) * 0.98], [a - w, side], [a - w * 0.42, len * 0.975], [a, len], [a + w * 0.42, len * 0.975], [a + w, side], [a + w * 2.3, edge(a + w * 2.3) * 0.98]);
  }
  const norm = (q) => ((q - a0) % TAU + TAU) % TAU;
  ring.sort((p, q) => norm(p[0]) - norm(q[0]));
  const pts = ring.map(([a, k]) => [Math.cos(a) * r * k, Math.sin(a) * r * k * (1 + 0.1 * Math.max(0, Math.sin(a)))]);
  return { pts, fingers };
}
// Замкнутая сглаженная кривая через точки (кубические Безье). Длина «усов» — от длины своего отрезка,
// поэтому на близко стоящих точках (кончик «пальца») кривая не делает петель. ox, oy — сдвиг
function smoothPath(pts, ox = 0, oy = 0) {
  const n = pts.length;
  const dir = (a, b) => { const x = b[0] - a[0], y = b[1] - a[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  let d = `M${f1(pts[0][0] + ox)} ${f1(pts[0][1] + oy)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const t1 = dir(p0, p2), t2 = dir(p1, p3), k = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3;
    d += `C${f1(p1[0] + t1[0] * k + ox)} ${f1(p1[1] + t1[1] * k + oy)} ${f1(p2[0] - t2[0] * k + ox)} ${f1(p2[1] - t2[1] * k + oy)} ${f1(p2[0] + ox)} ${f1(p2[1] + oy)}`;
  }
  return d + 'Z';
}
// нижняя кромка кляксы под точкой x (по ломаной через опорные точки) — отсюда начинается подтёк
function bottomAt(pts, x) {
  let y = -Infinity;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
    y = Math.max(y, a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  }
  return y;
}
const bubble = (x, y, rb) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rb + 0.8)}" fill="none" stroke="rgba(46,69,88,.24)" stroke-width=".8"/>` +
  `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rb)}" fill="rgba(255,255,255,.2)" stroke="rgba(255,255,255,.92)" stroke-width="1"/>` +
  `<circle cx="${f1(x - rb * 0.34)}" cy="${f1(y - rb * 0.36)}" r="${f1(Math.max(0.6, rb * 0.22))}" fill="#fff"/>`;
// Подтёк: тонкая струйка с каплей на конце. Капля сползает вниз, струйка тянется за ней — оба движения идут
// через transform (стили .spit-drip), поэтому десятки подтёков не нагружают страницу.
// h — радиус капли, len — длина подтёка
function drip(x, y0, len, h, secs) {
  const nk = Math.max(1.2, h * 0.55), run = len - h;
  return `<div class="spit-drip" style="left:${f1(x)}px;top:${f1(y0)}px;--t:${secs.toFixed(1)}s;--run:${f1(run)}px">` +
    `<i class="spit-stream" style="width:${f1(nk * 2)}px;height:${f1(run)}px;margin-left:${f1(-nk)}px"></i>` +
    `<i class="spit-bead" style="width:${f1(h * 2)}px;height:${f1(h * 2.15)}px;margin:${f1(-h)}px 0 0 ${f1(-h)}px"></i></div>`;
}

export class SpitScreen {
  constructor() {
    const root = this.root = document.createElement('div');
    root.className = 'spit';
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `${DEFS}<div class="spit-blur"></div><div class="spit-layer"></div>`;
    document.body.appendChild(root);
    this.blur = root.querySelector('.spit-blur');
    this.layer = root.querySelector('.spit-layer');
    this.gen = 0;
    this.wipeT = 0;
    this.reset();
  }

  // новая серия: чистое стекло и сетка покрытия под текущий размер окна
  reset() {
    clearTimeout(this.wipeT);
    this.gen++;
    this.root.hidden = true;
    this.root.classList.remove('is-wiping', 'is-flood');
    this.layer.innerHTML = '';
    this.paths = [];
    this._clip();
    const W = this.W = window.innerWidth, H = this.H = window.innerHeight;
    this.g = clamp(Math.round(Math.sqrt(W * H) / 26), 18, 44);
    this.cols = Math.ceil(W / this.g); this.rows = Math.ceil(H / this.g);
    this.cov = new Uint8Array(this.cols * this.rows);
    this.covered = 0; this.n = 0; this.last = null; this.flooded = false;
  }

  get coverage() { return this.covered / this.cov.length; }

  _clip() {
    const cp = `path("${this.paths.join('') || 'M0 0'}")`;
    this.blur.style.clipPath = cp; this.blur.style.webkitClipPath = cp;
  }

  _mark(x, y, r) {
    const g = this.g, rr = (r * 0.88) ** 2;
    const c0 = Math.max(0, Math.floor((x - r) / g)), c1 = Math.min(this.cols - 1, Math.floor((x + r) / g));
    const r0 = Math.max(0, Math.floor((y - r) / g)), r1 = Math.min(this.rows - 1, Math.floor((y + r) / g));
    for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) {
      const k = j * this.cols + i;
      if (!this.cov[k] && ((i + 0.5) * g - x) ** 2 + ((j + 0.5) * g - y) ** 2 <= rr) { this.cov[k] = 1; this.covered++; }
    }
  }

  // Куда плюнуть следующим: { x, y, r } в пикселях окна; last — последний плевок (во весь экран); null — экран уже покрыт
  next() {
    if (this.flooded) return null;
    const W = this.W, H = this.H;
    if (this.coverage > 0.8 || this.n >= 44) {
      this.flooded = true;
      return { x: W / 2, y: H * 0.46, r: Math.hypot(W, H) * 0.75, last: true };
    }
    // две случайные чистые клетки — берём ту, что дальше от предыдущего плевка: голова вертится по всему экрану,
    // но и в середину попадает
    const N = this.cov.length;
    let best = null, bd = -1;
    for (let k = 0; k < 2; k++) {
      let i = Math.floor(Math.random() * N), guard = 0;
      while (this.cov[i] && guard++ < N) i = (i + 1) % N;
      const x = ((i % this.cols) + rnd(0.2, 0.8)) * this.g, y = (Math.floor(i / this.cols) + rnd(0.2, 0.8)) * this.g;
      const d = this.last ? Math.hypot(x - this.last.x, y - this.last.y) : Math.random();
      if (d > bd) { bd = d; best = { x: clamp(x, 0, W), y: clamp(y, 0, H) }; }
    }
    // плевки растут: первые — аккуратные, дальше всё крупнее
    best.r = Math.sqrt(W * H) * (0.05 + 0.075 * Math.min(1, this.n / 26)) * rnd(0.85, 1.2);
    this._mark(best.x, best.y, best.r);
    this.n++; this.last = best;
    return best;
  }

  // Плевок летит от рта (from) в точку to и шлёпается о «стекло»; onLand — в момент шлепка
  launch(from, to, onLand) {
    const gen = this.gen;
    this.root.hidden = false;
    const size = Math.min(to.r * 1.1, 320), end = (to.r * (to.last ? 2 : 1.1)) / size;
    const fly = document.createElement('div');
    fly.className = 'spit-fly';
    fly.style.cssText = `width:${f1(size)}px;height:${f1(size * 0.92)}px;margin:${f1(-size * 0.46)}px 0 0 ${f1(-size / 2)}px`;
    this.layer.appendChild(fly);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const land = () => {
      fly.remove();
      if (gen !== this.gen) return;                 // пока летел, экран вытерли
      if (to.last) this._flood(); else this._splat(to);
      if (onLand) onLand();
    };
    if (!fly.animate) { land(); return; }           // очень старый браузер: без полёта, сразу клякса
    // растёт, приближаясь к зрителю: к концу полёта — быстрее
    const a = fly.animate([
      { transform: `translate(${f1(from.x)}px, ${f1(from.y)}px) scale(${Math.max(0.04, 9 / size).toFixed(3)})`, opacity: 0.85 },
      { transform: `translate(${f1(to.x)}px, ${f1(to.y)}px) scale(${end.toFixed(2)})`, opacity: 1 },
    ], { duration: to.last ? 440 : clamp(170 + dist * 0.17, 190, 340), easing: 'cubic-bezier(.45,0,.9,.55)', fill: 'forwards' });
    a.finished.then(land, () => fly.remove());
  }

  _splat({ x, y, r }) {
    const { pts, fingers } = blobShape(r), d = smoothPath(pts);
    const sw = clamp(r * 0.03, 1.2, 2.4);
    let art = `<path d="${d}" transform="translate(${f1(1 + r * 0.025)} ${f1(1.5 + r * 0.045)})" fill="rgba(30,50,70,.1)"/>` +
      `<path d="${d}" fill="url(#spit-body)"/>` +
      `<path d="${d}" fill="none" stroke="url(#spit-dark)" stroke-width="${f1(sw)}"/>` +
      `<path d="${d}" fill="none" stroke="url(#spit-light)" stroke-width="${f1(sw * 1.4)}" transform="scale(.955)"/>` +
      // блики — свет сверху-слева
      `<ellipse cx="${f1(-r * 0.33)}" cy="${f1(-r * 0.36)}" rx="${f1(r * 0.21)}" ry="${f1(r * 0.085)}" transform="rotate(-36 ${f1(-r * 0.33)} ${f1(-r * 0.36)})" fill="#fff" opacity=".85"/>` +
      `<ellipse cx="${f1(-r * 0.05)}" cy="${f1(-r * 0.56)}" rx="${f1(r * 0.07)}" ry="${f1(r * 0.04)}" fill="#fff" opacity=".7"/>`;
    // пузырьки
    for (let i = 0, n = clamp(Math.round(r / 11), 2, 10); i < n; i++) {
      const a = rnd(0, Math.PI * 2), q = Math.sqrt(Math.random()) * r * 0.62;
      art += bubble(Math.cos(a) * q, Math.sin(a) * q, rnd(1.6, clamp(r * 0.11, 2.6, 9)));
    }
    // подтёки: от нижней кромки кляксы, не длиннее, чем до низа экрана
    let drips = '';
    for (let i = 0, n = r > 70 ? 3 : (Math.random() < 0.4 ? 1 : 2); i < n; i++) {
      const dx = rnd(-0.5, 0.5) * r, y0 = bottomAt(pts, dx);
      if (!isFinite(y0)) continue;
      const len = Math.min(rnd(0.6, 2.4) * r, this.H - y - y0 + 30);
      if (len > 16) drips += drip(dx, y0, len, clamp(r * rnd(0.055, 0.09), 2.4, 8.5), rnd(2.5, 7));
    }
    const el = document.createElement('div');
    el.className = 'spit-blob';
    el.style.left = `${f1(x)}px`; el.style.top = `${f1(y)}px`;
    el.innerHTML = `${drips}<div class="spit-in"><svg aria-hidden="true" focusable="false">${art}</svg></div>`;
    // брызги: летят от места удара дальше кончиков «пальцев» и просто в стороны
    const sprays = fingers.map(([a, len]) => [a, len * rnd(1.15, 1.5)]);
    for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) sprays.push([rnd(0, Math.PI * 2), rnd(1.3, 2)]);
    for (const [a, k] of sprays) {
      const s = rnd(2.4, clamp(r * 0.15, 4, 15)), tx = f1(Math.cos(a) * r * k), ty = f1(Math.sin(a) * r * k);
      const drop = document.createElement('div');
      drop.className = 'spit-drop';
      drop.style.cssText = `width:${f1(s)}px;height:${f1(s * rnd(0.85, 1.1))}px;margin:${f1(-s / 2)}px;transform:translate(${tx}px, ${ty}px)`;
      el.appendChild(drop);
      drop.animate([{ transform: 'translate(0, 0) scale(.3)', opacity: 0.4 }, { transform: `translate(${tx}px, ${ty}px) scale(1)`, opacity: 1 }],
        { duration: rnd(170, 300), easing: 'cubic-bezier(.1,.7,.3,1)' });
    }
    this.layer.appendChild(el);
    // шлепок: клякса расплющивается о стекло и чуть пружинит
    el.querySelector('.spit-in').animate([{ transform: 'scale(.3)', opacity: 0.5 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.55 }, { transform: 'scale(1)' }],
      { duration: 300, easing: 'cubic-bezier(.2,.9,.3,1)' });
    // размытие под кляксой и подтёки — после шлепка
    this.paths.push(smoothPath(pts, x, y));
    this._clip();
    this._run(el);
  }

  // подтёки начинают ползти со следующего кадра (иначе переход не сработает)
  _run(el) { requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.spit-drip').forEach((g) => g.classList.add('is-on')))); }

  // Последний плевок: слюна во весь экран — всё размыто, сверху вниз тянутся подтёки
  _flood() {
    const W = this.W, H = this.H, u = Math.sqrt(W * H);
    this.root.classList.add('is-flood');
    let art = '', drips = '';
    for (let i = 0, n = clamp(Math.round(W / 70), 6, 20); i < n; i++) {
      const x = rnd(0.02, 0.98) * W, y0 = rnd(-0.05, 0.5) * H;
      drips += drip(x, y0, rnd(0.25, 0.75) * H, clamp(u * rnd(0.005, 0.011), 3, 12), rnd(3.5, 9));
    }
    for (let i = 0; i < 34; i++) art += bubble(rnd(0, W), rnd(0, H), rnd(2, clamp(u * 0.012, 4, 12)));
    for (let i = 0; i < 6; i++) {
      const x = rnd(0.05, 0.9) * W, y = rnd(0.05, 0.85) * H, k = u * rnd(0.03, 0.07);
      art += `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(k)}" ry="${f1(k * 0.36)}" transform="rotate(-34 ${f1(x)} ${f1(y)})" fill="#fff" opacity="${rnd(0.35, 0.7).toFixed(2)}"/>`;
    }
    const el = document.createElement('div');
    el.className = 'spit-blob spit-film';
    el.innerHTML = `${drips}<svg aria-hidden="true" focusable="false">${art}</svg>`;
    this.layer.appendChild(el);
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-out' });
    this._run(el);
  }

  // Посетитель очнулся: всё стекает вниз, стекло чистое. Возвращает true, если на экране что-то было
  wipe() {
    this.gen++;                                      // летящие плевки уже не долетят
    if (this.root.hidden || this.root.classList.contains('is-wiping')) return false;
    const had = this.layer.childElementCount > 0;
    this.root.classList.add('is-wiping');
    clearTimeout(this.wipeT);
    this.wipeT = setTimeout(() => this.reset(), 820);
    return had;
  }
}
