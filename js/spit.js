// «Заплёванный экран» — пасхалка на долгое бездействие. Когда и сколько плевать, решает js/app.js,
// как при этом двигается голова — js/head.js (spit). Здесь всё, что происходит со слюной: она летит от рта,
// шлёпается о «стекло» экрана, расплющивается, разбрасывает нити с каплями и потом долго стекает.
//
// Как это нарисовано. Слюна — не картинки, а «поле плотности» на отдельном холсте WebGL (поверх страницы, клики
// пропускает). Всё мокрое складывается из мягких пятен и отрезков (штампов): где сумма выше порога — там жидкость.
// Соседние капли поэтому сливаются перемычками, как настоящие. По этому полю шейдер считает наклон поверхности и
// рисует прозрачную вязкую жидкость: тёмная кромка, блики от «софтбокса», мелкая рябь и пузыри в толще, тень на стекле.
//   поле P — то, что уже прилипло к стеклу (тело кляксы, следы нитей и подтёков): только дополняется;
//   поле T — то, что движется прямо сейчас (летящий плевок, растекающаяся клякса, капли на концах нитей и подтёков):
//            перерисовывается каждый кадр.
// Под телом каждой кляксы страница слегка размыта (один слой backdrop-filter, обрезанный по контурам клякс).
// Когда ничего не движется, холст не перерисовывается.
// Нужен WebGL2 с отрисовкой в 16-битную текстуру; где его нет, конструктор бросает ошибку и пасхалка выключается.

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const TAU = Math.PI * 2;
const ISO = 0.5;                                     // порог плотности: выше — жидкость
// Радиус штампа, при котором пятно веса w видно радиусом rVis (профиль пятна — (1 − u²)³)
const kr = (rVis, w = 1) => rVis / Math.sqrt(1 - Math.cbrt(ISO / w));
// Штампы поля плотности — по девять чисел: x1, y1, r1, вес «складывается», x2, y2, r2, вес «берётся наибольший», толщина.
// Толщина (0…1) говорит шейдеру, тело это или тонкая нить: у тонкого слоя кромка бледнее, иначе нити выглядят трещинами.
const fat = (rVis) => clamp((rVis - 2.4) / 5.5, 0, 1);                    // капля: чем мельче, тем «тоньше»
const disc = (x, y, rVis, w, thick = fat(rVis)) => { const r = kr(rVis, w); return [x, y, r, w, x, y, r, 0, thick]; };
const seg = (x1, y1, r1, x2, y2, r2, w, thick = 1) => [x1, y1, kr(r1, w), w, x2, y2, kr(r2, w), 0, thick];
const trail = (x1, y1, r1, x2, y2, r2, w = 1, thick = 0) => [x1, y1, kr(r1, w), 0, x2, y2, kr(r2, w), w, thick];
const STAMP = 9;

const VS_STAMP = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aA;      // x1, y1, r1, вес «складывается»
layout(location=2) in vec4 aB;      // x2, y2, r2, вес «берётся наибольший» (следы)
layout(location=3) in float aC;     // толщина слоя: 1 — тело кляксы, 0 — тонкая нить
uniform vec2 uSize;                 // размер окна в CSS-пикселях
out vec2 vP; out vec4 vA; out vec4 vB; out float vC;
void main() {
  float r = max(aA.z, aB.z);
  vec2 lo = min(aA.xy, aB.xy) - r, hi = max(aA.xy, aB.xy) + r;
  vec2 p = mix(lo, hi, aCorner);
  vP = p; vA = aA; vB = aB; vC = aC;
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
}`;
const FS_STAMP = `#version 300 es
precision highp float;
in vec2 vP; in vec4 vA; in vec4 vB; in float vC;
out vec4 o;
void main() {
  vec2 ab = vB.xy - vA.xy;
  float t = clamp(dot(vP - vA.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  float r = mix(vA.z, vB.z, t);
  float u = length(vP - vA.xy - ab * t) / r;
  float k = max(0.0, 1.0 - u * u); k = k * k * k;
  // R — плотность (складывается), A — плотность следов (берётся наибольшая), G — сколько из этого «толстого» слоя
  o = vec4(k * vA.w, k * (vA.w + vB.w) * vC, 0.0, k * vB.w);
}`;
const VS_QUAD = `#version 300 es
layout(location=0) in vec2 aCorner;
out vec2 vUv;
void main() { vUv = aCorner; gl_Position = vec4(aCorner * 2.0 - 1.0, 0.0, 1.0); }`;
// Рисунок жидкости по полю плотности. Высота плёнки h у кромки растёт круто (мениск), а дальше — пологим куполом:
// толстые места выпуклые, как у вязкой капли на стекле. По наклону считается нормаль, по нормали — всё остальное:
// тонкая тёмная кромка, серая тень на склонах, отражение «софтбокса» с чётким краем, светлая полоска у теневой кромки.
// Внутри — редкие пузырьки воздуха и островки пены. Тонкие нити светлее толстого тела: чем тоньше слой, тем слабее кромка.
const FS_SHADE = `#version 300 es
precision highp float;
uniform sampler2D uP, uT;
uniform vec2 uField;      // размер поля, тексели
uniform vec2 uCss;        // размер окна, CSS-пиксели
uniform float uPx;        // пикселей холста на тексель поля
uniform vec4 uFly;        // тень летящего плевка на стекле: x, y, радиус (CSS-пиксели), плотность
uniform float uGrain;     // масштаб мелких деталей (пузырьки, неровность), тексели поля
in vec2 vUv;
out vec4 o;
float rho(vec2 uv) { vec4 p = texture(uP, uv); return p.r + p.a + texture(uT, uv).r; }
float hash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.53); return fract(p.x * p.y); }
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 19.19)); }
// плавный шум и его наклон (x — значение, yz — производные)
vec3 noised(vec2 x) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
}
void main() {
  vec2 tx = 1.0 / uField;
  vec4 p0 = texture(uP, vUv), t0 = texture(uT, vUv);
  float c = p0.r + p0.a + t0.r;
  // тень на стекле: жидкость приподнята над страницей; свет сверху-слева
  float sh1 = rho(vUv + vec2(-1.6, 2.6) * tx), sh2 = rho(vUv + vec2(-3.6, 5.8) * tx);
  if (max(c, max(sh1, sh2)) < 0.03 && uFly.w <= 0.0) { o = vec4(0.0); return; }
  float shadow = smoothstep(0.2, 0.52, sh1) * 0.085 + smoothstep(0.3, 0.9, sh2) * 0.05;
  vec2 css = vec2(vUv.x, 1.0 - vUv.y) * uCss;
  if (uFly.w > 0.0) { float fd = length(css - uFly.xy) / uFly.z; shadow = max(shadow, uFly.w * (1.0 - smoothstep(0.55, 1.25, fd))); }

  vec2 g = 0.5 * vec2(rho(vUv + vec2(tx.x, 0.0)) - rho(vUv - vec2(tx.x, 0.0)), rho(vUv + vec2(0.0, tx.y)) - rho(vUv - vec2(0.0, tx.y)));
  float gl = length(g) + 1e-5;
  float d = (c - ${ISO.toFixed(1)}) / gl;                    // до кромки, тексели (внутри — плюс)
  float cover = clamp(d * uPx + 0.5, 0.0, 1.0);
  float s = max(c - ${ISO.toFixed(1)}, 0.0);
  // насколько толст слой: доля плотности, пришедшая от «толстых» штампов. Нить — тонкая (0), тело кляксы — толстое (1)
  float thk = smoothstep(0.12, 0.8, (p0.g + t0.g) / max(c, 0.05));

  const float C = 0.6;
  float q = s / (s + C);
  float hr = sqrt(q);
  float dRim = 0.5 / max(hr, 0.04) * C / ((s + C) * (s + C));     // мениск у кромки
  float dDome = 0.5 * exp(-0.5 * s);                              // купол толстых мест
  vec2 slope = -g * (dRim * 30.0 * mix(0.5, 1.0, thk) + dDome * 21.0);
  vec3 n0 = normalize(vec3(slope, 1.0));                          // форма самой капли
  // лёгкая неровность поверхности — блики получаются живыми, а не «по линейке»
  float body = smoothstep(0.3, 0.8, q);
  vec2 np = vUv * uField / uGrain;
  vec2 wav = (noised(np * 0.3).yz * 0.2 + noised(np * 0.83 + 7.3).yz * 0.07) * body;
  vec3 n = normalize(vec3(slope + wav, 1.0));

  // пузырьки воздуха: редкие одиночные; в островках пены — мелкие и тесно
  float clus = smoothstep(0.56, 0.68, noised(np * 0.1 + 3.1).x * 0.7 + noised(np * 0.27 + 9.4).x * 0.4) * body;
  float ring = 0.0, bdot = 0.0, bfill = 0.0;
  if (body > 0.01) {
    vec2 bu = np / 2.6, bi = floor(bu), bf = fract(bu);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 oo = vec2(float(i), float(j));
      vec2 hh = hash2(bi + oo + 41.0);
      float on = step(0.9 - 0.15 * clus, hh.x);
      float rb = 0.1 + 0.32 * hash(bi + oo + 5.5);
      vec2 pp = oo + 0.5 + 0.72 * (hh - 0.5) - bf;                // от точки до центра пузырька
      float dd = length(pp);
      ring = max(ring, (1.0 - smoothstep(0.0, 0.05, abs(dd - rb))) * on);
      bdot = max(bdot, (1.0 - smoothstep(0.0, rb * 0.42, length(pp - vec2(0.36, -0.36) * rb))) * on);
      bfill = max(bfill, (1.0 - smoothstep(rb * 0.7, rb, dd)) * on);
    }
    if (clus > 0.01) {
      // пена: пузырьки втрое мельче, почти в каждой ячейке
      vec2 fu = np / 0.9, fi = floor(fu), ff = fract(fu);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 oo = vec2(float(i), float(j));
        vec2 hh = hash2(fi + oo + 17.0);
        float on = step(1.0 - 0.86 * clus, hh.y);
        float sz = hash(fi + oo + 2.5);
        float rb = 0.13 + 0.36 * sz * sz;                         // больше мелких, изредка — крупный
        vec2 pp = oo + 0.5 + 0.8 * (hh - 0.5) - ff;
        float dd = length(pp);
        ring = max(ring, (1.0 - smoothstep(0.0, 0.11, abs(dd - rb))) * on * 0.8);
        bdot = max(bdot, (1.0 - smoothstep(0.0, rb * 0.5, length(pp - vec2(0.34, -0.34) * rb))) * on * 0.9);
        bfill = max(bfill, (1.0 - smoothstep(rb * 0.6, rb, dd)) * on);
      }
    }
    ring *= body; bdot *= body; bfill *= body;
  }

  vec3 L = normalize(vec3(-0.5, 0.62, 0.6));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float steep = 1.0 - n0.z;                                 // 0 — плоско, 1 — отвесная кромка
  float lit = dot(normalize(n0.xy + 1e-5), normalize(L.xy));// склон смотрит на свет (+1) или от него (−1)
  float toLight = smoothstep(-0.6, 0.9, lit);
  // тёмная кромка: у края прозрачной капли видно не страницу, а тёмное «вокруг». У тонких нитей она бледнее
  float line = smoothstep(0.46, 0.9, steep);
  float darkA = line * mix(0.22, 0.66, thk) * mix(1.0, 0.3, toLight);
  // серая тень на склонах с теневой стороны — объём
  darkA += smoothstep(0.03, 0.42, steep) * mix(0.15, 0.02, toLight) * mix(0.5, 1.0, thk);
  darkA += ring * 0.3;
  // отражение софтбокса: чёткое пятно там, где склон смотрит на свет; вокруг — мягкий ореол
  float nh = max(dot(n, H), 0.0);
  float soft = smoothstep(0.955, 0.985, nh) * smoothstep(0.02, 0.12, steep);
  float halo = pow(nh, 26.0) * 0.16 * body;
  // светлая полоска внутри кромки с теневой стороны — свет, собранный каплей; блик на самой кромке со стороны света
  float caust = smoothstep(0.1, 0.26, steep) * (1.0 - smoothstep(0.3, 0.52, steep)) * smoothstep(0.0, -0.85, lit);
  float glint = pow(max(dot(n0, H), 0.0), 60.0) * smoothstep(0.05, 0.3, steep);
  float spec = clamp(soft * mix(0.7, 0.96, thk) + halo + caust * 0.6 * mix(0.5, 1.0, thk) + glint * 0.9 + bdot * 0.9, 0.0, 1.0);
  darkA = clamp(darkA, 0.0, 1.0);
  // сама толща: едва заметная молочная вуаль, гуще в толстых местах; пена — белёсая
  float veil = 0.04 + 0.05 * body + 0.05 * smoothstep(1.2, 3.2, s) + clus * 0.1 + bfill * clus * 0.16;
  vec3 veilC = mix(vec3(0.7, 0.74, 0.77), vec3(0.95, 0.96, 0.95), clamp(clus + smoothstep(1.2, 3.2, s) * 0.6, 0.0, 1.0));

  vec3 col = veilC * veil;
  float a = veil;
  col = col * (1.0 - darkA) + vec3(0.1, 0.13, 0.17) * darkA; a = a * (1.0 - darkA) + darkA;
  col = col * (1.0 - spec) + vec3(spec); a = a * (1.0 - spec) + spec;
  col *= cover; a *= cover;
  float sa = shadow * (1.0 - cover);
  col += vec3(0.06, 0.08, 0.11) * sa * (1.0 - a); a += sa * (1.0 - a);
  o = vec4(col, a);
}`;

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Шейдер слюны: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Шейдер слюны: ${gl.getProgramInfoLog(p)}`);
  return p;
}

export class SpitScreen {
  constructor() {
    const root = this.root = document.createElement('div');
    root.className = 'spit';
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<div class="spit-blur"></div><canvas class="spit-gl"></canvas>';
    this.blur = root.querySelector('.spit-blur');
    const cv = this.canvas = root.querySelector('canvas');
    const gl = this.gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    if (!gl) throw new Error('нет WebGL2');
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) throw new Error('нет отрисовки в 16-битную текстуру');
    this.pStamp = program(gl, VS_STAMP, FS_STAMP);
    this.pShade = program(gl, VS_QUAD, FS_SHADE);
    this.u = {};
    for (const [p, names] of [[this.pStamp, ['uSize']], [this.pShade, ['uP', 'uT', 'uField', 'uCss', 'uPx', 'uFly', 'uGrain']]]) for (const n of names) this.u[n] = gl.getUniformLocation(p, n);
    // один квадрат на всё: и штампы (по экземпляру на штамп), и полноэкранный проход
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STAMP * 4, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STAMP * 4, 16); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STAMP * 4, 32); gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
    this.buf = new Float32Array(STAMP * 256);
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.dead = true; cancelAnimationFrame(this.raf); this.raf = 0; });
    document.body.appendChild(root);
    this.gen = 0; this.wipeT = 0; this.raf = 0; this.dead = false;
    this.onResize = null;
    window.addEventListener('resize', () => { if (!this.root.hidden && (window.innerWidth !== this.W || Math.abs(window.innerHeight - this.H) > 120) && this.onResize) this.onResize(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !this.root.hidden) this._kick(); });
    this.reset();
  }

  // новая серия: чистое стекло, поля и сетка покрытия под текущий размер окна
  reset() {
    clearTimeout(this.wipeT);
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.gen++;
    this.root.hidden = true;
    this.root.classList.remove('is-wiping');
    this.paths = [];
    this._clip();
    const W = this.W = window.innerWidth, H = this.H = window.innerHeight;
    const gl = this.gl, cv = this.canvas;
    // холст — не плотнее двух пикселей на точку и не больше ~2,4 Мп; поле — точка в точку, но не больше ~1 Мп
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2.4e6 / (W * H)));
    cv.width = Math.max(2, Math.round(W * dpr)); cv.height = Math.max(2, Math.round(H * dpr));
    const fs = Math.min(1, Math.sqrt(1.05e6 / (W * H)));
    const fw = Math.max(2, Math.round(W * fs)), fh = Math.max(2, Math.round(H * fs));
    if (!this.dead && (fw !== this.fw || fh !== this.fh)) {
      this.fw = fw; this.fh = fh;
      for (const k of ['P', 'T']) {
        if (this[k]) { gl.deleteTexture(this[k].tex); gl.deleteFramebuffer(this[k].fbo); }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, fw, fh, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('16-битная текстура не принимает отрисовку');
        this[k] = { tex, fbo };
      }
    }
    if (!this.dead) {
      gl.clearColor(0, 0, 0, 0);
      for (const k of ['P', 'T']) { gl.bindFramebuffer(gl.FRAMEBUFFER, this[k].fbo); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, cv.width, cv.height); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.items = [];            // всё, что сейчас движется
    this.fresh = [];            // штампы, которые в этом кадре прилипают к стеклу навсегда
    this.now = 0; this.last = 0;
    this.g = clamp(Math.round(Math.sqrt(W * H) / 26), 18, 44);
    this.cols = Math.ceil(W / this.g); this.rows = Math.ceil(H / this.g);
    this.cov = new Uint8Array(this.cols * this.rows);
    this.covered = 0; this.n = 0; this.prev = null;
  }

  get coverage() { return this.covered / this.cov.length; }
  get busy() { return this.items.length > 0; }

  _clip() {
    const cp = `path("${this.paths.join('') || 'M0 0'}")`;
    this.blur.style.clipPath = cp; this.blur.style.webkitClipPath = cp;
  }

  _mark(x, y, r) {
    const g = this.g, rr = r * r;
    const c0 = Math.max(0, Math.floor((x - r) / g)), c1 = Math.min(this.cols - 1, Math.floor((x + r) / g));
    const r0 = Math.max(0, Math.floor((y - r) / g)), r1 = Math.min(this.rows - 1, Math.floor((y + r) / g));
    for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) {
      const k = j * this.cols + i;
      if (!this.cov[k] && ((i + 0.5) * g - x) ** 2 + ((j + 0.5) * g - y) ** 2 <= rr) { this.cov[k] = 1; this.covered++; }
    }
  }

  // Куда плюнуть следующим: { x, y, r } в пикселях окна; null — стекло уже заплёвано.
  // Первый плевок — на видное место, ближе к середине. Дальше — в случайную чистую клетку, но не рядом с предыдущим:
  // голова вертится по всему экрану и попадает и в края, и в середину.
  next() {
    const W = this.W, H = this.H;
    if (this.coverage > 0.64 || this.n >= 26) return null;
    const N = this.cov.length, far = Math.hypot(W, H) * 0.28;
    let best = null;
    if (!this.n) best = { x: W * rnd(0.28, 0.72), y: H * rnd(0.2, 0.5) };
    for (let k = 0; k < 6 && !best; k++) {
      let i = Math.floor(Math.random() * N), guard = 0;
      while (this.cov[i] && guard++ < N) i = (i + 1) % N;
      const x = clamp(((i % this.cols) + rnd(0.2, 0.8)) * this.g, W * 0.05, W * 0.95), y = clamp((Math.floor(i / this.cols) + rnd(0.2, 0.8)) * this.g, H * 0.05, H * 0.9);
      if (k === 5 || Math.hypot(x - this.prev.x, y - this.prev.y) > far) best = { x, y };
    }
    // первые плевки — аккуратные, дальше смелее
    best.r = Math.sqrt(W * H) * (0.08 + 0.04 * Math.min(1, this.n / 9)) * rnd(0.85, 1.18);
    this._mark(best.x, best.y, best.r * 1.45);
    this.n++; this.prev = best;
    return best;
  }

  // Плевок летит от рта (from) в точку to и шлёпается о «стекло»; onLand — в момент шлепка
  launch(from, to, onLand) {
    if (this.dead) { if (onLand) onLand(); return; }
    this.root.hidden = false;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    let dx = (to.x - from.x) / (dist || 1), dy = (to.y - from.y) / (dist || 1);
    if (dist < to.r * 0.5) { const a = rnd(0, TAU); dx = Math.cos(a); dy = Math.sin(a); }      // почти в упор — растечётся куда придётся
    this.items.push({ kind: 'fly', t: 0, dur: clamp(0.4 + dist * 0.00025, 0.4, 0.56), from, to, dx, dy, ph: rnd(0, TAU), gen: this.gen, onLand });
    this._kick();
  }

  // ---------- что куда летит ----------
  _hit(f) {
    const { to, dx, dy } = f, R = to.r, px = -dy, py = dx;        // (px, py) — поперёк полёта
    const P = (al, ac) => [to.x + dx * al * R + px * ac * R, to.y + dy * al * R + py * ac * R];
    // Тело — как комета: тяжёлая голова там, куда попал плевок, и сужающийся хвост по ходу полёта. К нему — боковые
    // наплывы, тонкая плёнка-«перепонка» у переднего края и несколько «пальцев» — толстых коротких выплесков.
    // Каждая часть: [вдоль, поперёк, радиус, вес] в долях R; у отрезка ещё [вдоль2, поперёк2, радиус2].
    const core = [];
    const lobe = (al, ac, r, w, al2, ac2, r2) => core.push(al2 === undefined ? [al, ac, r, w] : [al, ac, r, w, al2, ac2, r2]);
    const bend = rnd(-0.16, 0.16);
    lobe(-0.18, 0, rnd(0.5, 0.58), 2.4);
    lobe(rnd(0.2, 0.32), bend * 0.5, rnd(0.42, 0.5), 2.2);
    lobe(rnd(0.6, 0.75), bend, rnd(0.3, 0.38), 2);
    lobe(rnd(0.95, 1.15), bend * 1.6, rnd(0.2, 0.27), 1.8);
    for (let i = 0, n = 2 + Math.floor(Math.random() * 3); i < n; i++) lobe(rnd(-0.45, 0.8), (Math.random() < 0.5 ? -1 : 1) * rnd(0.3, 0.52), rnd(0.18, 0.3), 1.6);
    for (let i = 0, n = 2 + Math.floor(Math.random() * 2); i < n; i++) lobe(rnd(0.7, 1.35), rnd(-0.5, 0.5), rnd(0.26, 0.4), rnd(0.72, 0.95));     // перепонка: тонкая, рваная
    const ang = Math.atan2(dy, dx);
    for (let i = 0, n = 4 + Math.floor(Math.random() * 4); i < n; i++) {
      // палец: от кромки наружу, по ходу полёта — длиннее; на конце иногда набухает капля
      const a = Math.random() < 0.7 ? rnd(-1.25, 1.25) : rnd(0, TAU), fwd = Math.max(0, Math.cos(a)), ca = Math.cos(a), sa = Math.sin(a);
      const r0 = 0.5 + 0.55 * fwd, len = rnd(0.14, 0.36) + 0.4 * fwd * Math.random(), w0 = rnd(0.07, 0.115);
      const al = 0.25 * fwd + ca * r0 * 0.78, ac = sa * 0.5, w1 = w0 * rnd(0.42, 0.68);
      lobe(al, ac, w0, 1.5, al + ca * len, ac + sa * len * 0.9, w1);
      if (Math.random() < 0.25) lobe(al + ca * len, ac + sa * len * 0.9, w1 * rnd(1.1, 1.45), 1.5);
    }
    for (let i = 0, n = 3 + Math.floor(Math.random() * 4); i < n; i++) {
      // мелкие бугорки по контуру — кромка не должна быть гладкой, как у лужицы
      const a = rnd(0, TAU), ca = Math.cos(a), sa = Math.sin(a), fwd = Math.max(0, ca);
      lobe(0.25 * fwd + ca * (0.5 + 0.5 * fwd) * 0.82, sa * 0.52, rnd(0.07, 0.12), 1.3);
    }
    const hit = { kind: 'hit', t: 0, dur: 0.36, x: to.x, y: to.y, core: core.map((c) => { const [x, y] = P(c[0], c[1]); return c.length > 4 ? [x, y, c[2] * R, c[3], ...P(c[4], c[5]), c[6] * R] : [x, y, c[2] * R, c[3]]; }), gen: f.gen };
    this.items.push(hit);
    // след удара: тонкая плёнка от точки попадания назад, против хода — плевок проехал по стеклу
    const [sx0, sy0] = P(-rnd(0.75, 1.05), rnd(-0.1, 0.1));
    this.fresh.push(trail(to.x, to.y, R * 0.3, sx0, sy0, R * 0.12, 0.64, 0.7));
    // нити: вылетают веером по ходу полёта. У тела нить толстая, дальше быстро истончается, изгибается и рвётся на бусины
    for (let i = 0, n = 3 + Math.floor(Math.random() * 3); i < n; i++) {
      const a = i < n - 1 ? ang + rnd(-1.15, 1.15) : rnd(0, TAU);
      const len = R * rnd(0.9, 2.9) * (Math.abs(a - ang) < 0.5 ? 1.15 : 0.8), tau = rnd(0.09, 0.14);
      const sx = to.x + Math.cos(a) * R * 0.5, sy = to.y + Math.sin(a) * R * 0.42;
      this.items.push({ kind: 'streak', t: -rnd(0, 0.04), x: sx, y: sy, lx: sx, ly: sy, vx: Math.cos(a) * len / tau, vy: Math.sin(a) * len / tau, tau,
        w0: clamp(R * rnd(0.065, 0.105), 2.4, 11), w1: clamp(R * rnd(0.018, 0.026), 1.2, 2.8), bead: clamp(R * rnd(0.055, 0.12), 2.6, 13),
        next: rnd(0.3, 0.6) * len, gone: 0, len, sag: rnd(-0.03, 0.16) * len / tau, curl: rnd(-2.2, 2.2), gen: f.gen });
    }
    // мелкие брызги: больше — по ходу полёта
    for (let i = 0, n = 10 + Math.floor(Math.random() * 14); i < n; i++) {
      const a = Math.random() < 0.65 ? ang + rnd(-1.3, 1.3) : rnd(0, TAU), q = R * (0.95 + 2.3 * Math.random() ** 1.7);
      const big = Math.random() < 0.2;
      this.fresh.push(disc(to.x + Math.cos(a) * q, to.y + Math.sin(a) * q * 0.9, clamp(R * (big ? rnd(0.04, 0.085) : rnd(0.012, 0.03)), 1.1, 9), 1.3));
    }
    // подтёки: начинаются не сразу и ползут рывками
    for (let i = 0, n = R > 60 ? 2 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 2); i < n; i++) {
      const c = hit.core[Math.floor(Math.random() * 4)];
      const bead = clamp(R * rnd(0.07, 0.12), 3.2, 14);
      const x = c[0] + rnd(-0.5, 0.5) * c[2], y = c[1] + c[2] * 0.55;
      this.items.push({ kind: 'drip', t: -rnd(0.5, 3.2), x, y, lx: x, ly: y, v: 0, vt: rnd(25, 70), sw: rnd(0.3, 0.9), bead, w: Math.max(1.7, bead * rnd(0.36, 0.5)),
        max: Math.min(R * rnd(0.7, 3.4), this.H + 30 - y), gone: 0, drift: 0, gen: f.gen });
    }
    // размытие страницы под телом кляксы (эллипс чуть меньше тела, повёрнут по ходу полёта)
    const rx = R * 0.92, ry = R * 0.66, deg = f1(ang * 180 / Math.PI);
    const cx = to.x + dx * R * 0.08, cy = to.y + dy * R * 0.08, ex = Math.cos(ang) * rx, ey = Math.sin(ang) * rx;
    this.paths.push(`M${f1(cx - ex)} ${f1(cy - ey)}A${f1(rx)} ${f1(ry)} ${deg} 1 0 ${f1(cx + ex)} ${f1(cy + ey)}A${f1(rx)} ${f1(ry)} ${deg} 1 0 ${f1(cx - ex)} ${f1(cy - ey)}Z`);
    this._clip();
  }

  // Шаг времени: двигает всё живое, собирает штампы кадра. Возвращает тень летящего плевка [x, y, r, a] или null
  _step(dt) {
    const T = this.tr; T.length = 0;
    let fly = null;
    const keep = [];
    for (const it of this.items) {
      if (it.gen !== this.gen) continue;
      it.t += dt;
      if (it.kind === 'fly') {
        const u = clamp(it.t / it.dur, 0, 1);
        if (u >= 1) { this._hit(it); if (it.onLand) it.onLand(); continue; }
        // летит к зрителю: по экрану — с разгоном, растёт — всё быстрее (перспектива)
        const k = u ** 1.5, x = it.from.x + (it.to.x - it.from.x) * k, y = it.from.y + (it.to.y - it.from.y) * k - Math.sin(u * Math.PI) * 10;
        const r = 3.2 + (it.to.r * 0.5 - 3.2) * u ** 2.4;
        const wob = it.ph + it.t * 19;
        T.push(disc(x, y, r, 1.7, 1));
        T.push(disc(x + Math.cos(wob) * r * 0.5, y + Math.sin(wob) * r * 0.42, r * 0.55, 1.3, 1));
        T.push(disc(x + Math.cos(wob * 0.7 + 2.4) * r * 0.55, y + Math.sin(wob * 0.7 + 2.4) * r * 0.5, r * 0.42, 1.3, 1));
        // хвост против хода и пара отставших капель
        T.push(seg(x, y, r * 0.5, x - it.dx * r * 1.7, y - it.dy * r * 1.7 + r * 0.25, r * 0.12, 1.2, 1));
        T.push(disc(x - it.dx * r * 2.5, y - it.dy * r * 2.5 + r * 0.5, r * 0.16, 1.3));
        if (u > 0.3) T.push(disc(x - it.dx * r * 3.6 + Math.cos(wob) * 3, y - it.dy * r * 3.6 + r * 0.9, r * 0.1, 1.3));
        fly = [x + 6 + 16 * (1 - u), y + 9 + 22 * (1 - u), r * (1.25 + 0.6 * (1 - u)), 0.2 * u];
      } else if (it.kind === 'hit') {
        const u = clamp(it.t / it.dur, 0, 1), e = 1 - (1 - u) ** 3, sp = 0.3 + 0.7 * e, gr = 0.5 + 0.5 * e;
        const out = u >= 1 ? this.fresh : T;
        const mx = (v) => it.x + (v - it.x) * sp, my = (v) => it.y + (v - it.y) * sp;
        for (const c of it.core) out.push(c.length > 4 ? seg(mx(c[0]), my(c[1]), c[2] * gr, mx(c[4]), my(c[5]), c[6] * gr, c[3]) : disc(mx(c[0]), my(c[1]), c[2] * gr, c[3], 1));
        if (u >= 1) continue;
      } else if (it.kind === 'streak') {
        if (it.t > 0) {
          const k = Math.exp(-it.t / it.tau), step = dt * k;
          // нить провисает и закручивается: летит не по линейке
          const cs = Math.cos(it.curl * dt), sn = Math.sin(it.curl * dt), vx = it.vx * cs - it.vy * sn;
          it.vy = it.vx * sn + it.vy * cs + it.sag * dt; it.vx = vx;
          it.x += it.vx * step; it.y += it.vy * step;
          const seg1 = Math.hypot(it.x - it.lx, it.y - it.ly);
          it.gone += seg1;
          const prog = clamp(it.gone / it.len, 0, 1), w = it.w1 + (it.w0 - it.w1) * (1 - prog) ** 2.6;
          if (seg1 > 0.4) { this.fresh.push(trail(it.lx, it.ly, it.wl || w, it.x, it.y, w, 1, fat(w) * 0.6)); it.wl = w; it.lx = it.x; it.ly = it.y; }
          // бусины: нить рвётся на капли там, где она уже тонкая
          if (it.gone > it.next && prog < 0.92) { it.next = it.gone + rnd(0.1, 0.34) * it.len; this.fresh.push(disc(it.x, it.y, clamp(it.bead * rnd(0.3, 0.72), 1.7, 8), 1.3)); }
          if (k < 0.03) { this.fresh.push(disc(it.x, it.y, it.bead, 1.5)); continue; }      // остановилась: на конце остаётся капля
          T.push(disc(it.x, it.y, it.bead, 1.5));
        }
      } else if (it.kind === 'drip') {
        if (it.t > 0) {
          // ползёт рывками: то разгоняется, то почти встаёт
          it.sw -= dt;
          if (it.sw <= 0) {
            it.sw = rnd(0.35, 1.3);
            const slow = Math.random() < 0.3;
            it.vt = slow ? rnd(2, 9) : rnd(22, 95);
            if (slow && it.gone > it.bead * 2) this.fresh.push(disc(it.x, it.y, it.bead * rnd(0.5, 0.75), 1.4));      // притормозила — остался бугорок
          }
          it.v += (it.vt - it.v) * (1 - Math.exp(-dt * 5));
          it.y += it.v * dt; it.gone += it.v * dt;
          it.drift += rnd(-1, 1) * dt * 22; it.drift *= 0.985; it.x += it.drift * dt * 4;
          const seg1 = it.y - it.ly, w = it.w * (1 - 0.45 * clamp(it.gone / it.max, 0, 1));
          if (seg1 > 0.5) { this.fresh.push(trail(it.lx, it.ly, w, it.x, it.y, w, 1, fat(w) * 0.6)); it.lx = it.x; it.ly = it.y; }
          const bead = it.bead * (1 - 0.3 * clamp(it.gone / it.max, 0, 1));
          if (it.gone >= it.max || it.y > this.H + 40) { this.fresh.push(disc(it.x, it.y, bead, 1.6)); continue; }
          // капля на конце — вытянута вниз
          T.push(seg(it.x, it.y - bead * 0.5, bead * 0.7, it.x, it.y + bead * 0.25, bead, 1.5, fat(bead)));
        }
      }
      keep.push(it);
    }
    this.items = keep;
    return fly;
  }

  _draw(list, target, clear) {
    const gl = this.gl, n = list.length;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, this.fw, this.fh);
    if (clear) gl.clear(gl.COLOR_BUFFER_BIT);
    if (!n) return;
    if (this.buf.length < n * STAMP) this.buf = new Float32Array(n * STAMP * 2);
    const b = this.buf;
    for (let i = 0; i < n; i++) b.set(list[i], i * STAMP);
    gl.useProgram(this.pStamp);
    gl.uniform2f(this.u.uSize, this.W, this.H);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, b.subarray(0, n * STAMP), gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.MAX);       // плотность складывается, следы — по наибольшему
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    gl.disable(gl.BLEND);
  }

  _frame(time) {
    this.raf = 0;
    if (this.dead || this.root.hidden) return;
    const dt = this.last ? Math.min(0.05, (time - this.last) / 1000) : 1 / 60;
    this.last = time;
    this.render(dt);
    if (this.items.length) this.raf = requestAnimationFrame((t) => this._frame(t)); else this.last = 0;
  }

  // один кадр: шаг времени и отрисовка (отдельно — чтобы кадры можно было шагать вручную)
  render(dt, shade = true) {
    const gl = this.gl;
    this.tr = this.tr || [];
    const fly = this._step(dt);
    if (this.fresh.length) { this._draw(this.fresh, this.P, false); this.fresh.length = 0; }
    if (!shade) return;
    this._draw(this.tr, this.T, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.pShade);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.P.tex); gl.uniform1i(this.u.uP, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.T.tex); gl.uniform1i(this.u.uT, 1);
    gl.uniform2f(this.u.uField, this.fw, this.fh);
    gl.uniform2f(this.u.uCss, this.W, this.H);
    gl.uniform1f(this.u.uPx, this.canvas.width / this.fw);
    gl.uniform1f(this.u.uGrain, this.canvas.width / this.fw >= 1.5 ? 5.6 : 9);
    gl.uniform4f(this.u.uFly, ...(fly || [0, 0, 1, 0]));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  _kick() { if (!this.raf && !this.dead) this.raf = requestAnimationFrame((t) => this._frame(t)); }

  // Посетитель очнулся: всё съезжает вниз, стекло чистое. Возвращает true, если на экране что-то было
  wipe() {
    this.gen++;                                      // летящие плевки уже не долетят
    if (this.root.hidden || this.root.classList.contains('is-wiping')) return false;
    const had = this.n > 0;
    this.root.classList.add('is-wiping');
    clearTimeout(this.wipeT);
    this.wipeT = setTimeout(() => this.reset(), 820);
    return had;
  }
}
