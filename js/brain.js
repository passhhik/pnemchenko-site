// Мозг со стикерами. Его видно, пока голова «собирается» при загрузке (js/head.js, сборка): глаза, рот, очки,
// пирсинг, мозг — и только потом всё это закрывает кожа. Мозг ярко-розовый и мокрый на вид, стикеры — как на
// обклеенном лимоне: с белой каймой, ложатся поверх извилин.
// Всё строится на лету: форма — шар с выдавленными бороздами, стикеры — картинки, нарисованные на холсте.
// Чтобы заменить стикер своей картинкой (например, фото кота), впишите её в STICKERS ниже: { img: 'assets/brain/cat.png', … }.
import * as THREE from '../vendor/three/three.module.js';

// Где мозг сидит в голове (координаты головы: x — вправо, y — вверх, z — к зрителю) и его полуоси
export const BRAIN = { center: [0, 0.4, -0.1], radii: [0.56, 0.47, 0.68] };
const LIFT = 0.035;      // на сколько стикер приподнят над поверхностью (в долях радиуса): лежит на извилинах, не тонет в бороздах

// ---------- шум ----------
const hash = (x, y, z) => {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1103515245);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
    l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v), w);
}
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Гладкая форма без извилин: по направлению d (единичный вектор) — точка поверхности. На ней же лежат стикеры.
function shell(dx, dy, dz, out) {
  const [rx, ry, rz] = BRAIN.radii;
  const flat = dy < 0 ? 0.74 : 1;                              // снизу мозг площе
  const taper = 1 - 0.1 * Math.max(0, dz) + 0.05 * Math.max(0, -dz);   // лобные доли чуть у́же, затылок шире
  return out.set(dx * rx * taper, dy * ry * flat, dz * rz);
}
// Извилины: полосы, изогнутые шумом (как отпечаток пальца), плюс щель между полушариями.
// Возвращает [смещение вглубь (в долях радиуса), 0 — борозда … 1 — гребень извилины]
function folds(dx, dy, dz) {
  const px = dx * 2.2, py = dy * 2.2, pz = dz * 2.2;
  const wx = noise(px + 11.3, py + 2.1, pz + 5.7), wy = noise(px * 1.7 + 4.7, py * 1.7 + 9.2, pz * 1.7 + 1.3), wz = noise(pz * 1.3 + 7.1, px * 1.3 + 3.3, py * 1.3 + 8.8);
  const f = noise(px * 1.25 + wx * 1.9, py * 1.25 + wy * 1.9, pz * 1.25 + wz * 1.9) * 0.72 + noise(px * 2.9 + 3.3, py * 2.9 + 6.1, pz * 2.9 + 0.4) * 0.28;
  const ridge = Math.pow(Math.abs(Math.sin(f * Math.PI * 5.5)), 0.36);      // широкие извилины, узкие борозды
  const fissure = Math.exp(-(dx * dx) / (2 * 0.05 * 0.05)) * sstep(-0.75, -0.1, dy) * 0.9;
  return [-0.075 * (1 - ridge) - 0.14 * fissure, ridge * (1 - fissure)];
}

// Шар из треугольников одного размера (икосаэдр, разбитый пять раз: ~10 тыс. вершин, борозды получаются гладкими).
// Соседние треугольники делят вершины — так и нормали гладкие, и строится он за миллисекунды.
function icosphere(levels) {
  const t = (1 + Math.sqrt(5)) / 2;
  const P = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  let F = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  for (let i = 0; i < P.length; i += 3) { const l = Math.hypot(P[i], P[i + 1], P[i + 2]); P[i] /= l; P[i + 1] /= l; P[i + 2] /= l; }
  for (let lv = 0; lv < levels; lv++) {
    const mid = new Map(), next = [];
    const half = (a, b) => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      let m = mid.get(key);
      if (m === undefined) {
        const x = P[a * 3] + P[b * 3], y = P[a * 3 + 1] + P[b * 3 + 1], z = P[a * 3 + 2] + P[b * 3 + 2], l = Math.hypot(x, y, z);
        m = P.length / 3; P.push(x / l, y / l, z / l); mid.set(key, m);
      }
      return m;
    };
    for (let i = 0; i < F.length; i += 3) {
      const a = F[i], b = F[i + 1], c = F[i + 2], ab = half(a, b), bc = half(b, c), ca = half(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    F = next;
  }
  return { P, F };
}
function brainGeometry() {
  const { P, F } = icosphere(5), n = P.length / 3;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), v = new THREE.Vector3(), c = new THREE.Color();
  const deep = new THREE.Color().setRGB(0.6, 0.05, 0.28, THREE.SRGBColorSpace), top = new THREE.Color().setRGB(1, 0.42, 0.72, THREE.SRGBColorSpace);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const [d, ridge] = folds(x, y, z);
    shell(x, y, z, v).multiplyScalar(1 + d);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    c.copy(deep).lerp(top, sstep(0.05, 0.85, ridge) * (0.9 + 0.1 * noise(x * 9, y * 9, z * 9)));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(F);
  g.computeVertexNormals();
  return g;
}

// ---------- стикеры ----------
const S = 256;      // сторона холста стикера
function canvas() { const c = document.createElement('canvas'); c.width = c.height = S; return c; }
// Белая кайма «по контуру», как у вырубной наклейки: силуэт рисунка штампуется по кругу, сверху — сам рисунок
function dieCut(art, border = 11) {
  const sil = canvas(), sx = sil.getContext('2d');
  sx.drawImage(art, 0, 0);
  sx.globalCompositeOperation = 'source-in';
  sx.fillStyle = '#fff'; sx.fillRect(0, 0, S, S);
  const out = canvas(), ctx = out.getContext('2d');
  for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2; ctx.drawImage(sil, Math.cos(a) * border, Math.sin(a) * border); }
  ctx.drawImage(sil, 0, 0);
  ctx.drawImage(art, 0, 0);
  return out;
}
const FONT = '"Arial Black","Helvetica Neue",Arial,sans-serif';
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const draw = {
  // значок системным шрифтом устройства: на Mac и iPhone — их родные эмодзи
  emoji(ctx, o) {
    ctx.font = `${o.font || 150}px ${EMOJI}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.char, S / 2, S / 2 + 8);
  },
  rainbow(ctx) {
    const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#0a84ff', '#af52de'];
    ctx.lineCap = 'butt'; ctx.lineWidth = 15;
    colors.forEach((c, i) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(S / 2, S * 0.68, 96 - i * 15, Math.PI, 0); ctx.stroke(); });
    ctx.fillStyle = '#fff';
    for (const x of [S / 2 - 62, S / 2 + 62]) for (const [dx, dy, r] of [[-16, 0, 17], [2, -9, 21], [20, 1, 16]]) { ctx.beginPath(); ctx.arc(x + dx, S * 0.69 + dy, r, 0, Math.PI * 2); ctx.fill(); }
  },
  cursor(ctx) {
    ctx.translate(S / 2, S / 2); ctx.rotate(-0.12); ctx.translate(-62, -92);
    ctx.fillStyle = '#111'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const [x, y] of [[0, 0], [0, 158], [38, 124], [66, 186], [96, 172], [68, 112], [120, 112]]) ctx.lineTo(x, y);
    ctx.closePath(); ctx.fill();
  },
  heart(ctx) {
    const g = ctx.createLinearGradient(0, 50, 0, 220);
    g.addColorStop(0, '#ff5a8a'); g.addColorStop(1, '#ff1f5a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(S / 2, 212);
    ctx.bezierCurveTo(20, 140, 28, 44, 92, 50);
    ctx.bezierCurveTo(114, 52, S / 2, 70, S / 2, 92);
    ctx.bezierCurveTo(S / 2, 70, 142, 52, 164, 50);
    ctx.bezierCurveTo(228, 44, 236, 140, S / 2, 212);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.beginPath(); ctx.ellipse(86, 88, 22, 12, -0.6, 0, Math.PI * 2); ctx.fill();
  },
  // надпись на цветной плашке: овал, «таблетка» или звезда
  label(ctx, o) {
    ctx.fillStyle = o.bg;
    ctx.beginPath();
    if (o.shape === 'star') {
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 58 : 112; ctx.lineTo(S / 2 + Math.cos(a) * r, S / 2 + 6 + Math.sin(a) * r); }
      ctx.closePath();
    } else if (o.shape === 'pill') { ctx.arc(66, S / 2, 44, Math.PI / 2, Math.PI * 1.5); ctx.arc(S - 66, S / 2, 44, -Math.PI / 2, Math.PI / 2); ctx.closePath(); }
    else ctx.ellipse(S / 2, S / 2, 104, 66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = o.fg;
    ctx.font = `900 ${o.font || 64}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.text, S / 2, S / 2 + (o.dy || 4));
  },
};

// Какие стикеры и где: at — направление от центра мозга (x — вправо, y — вверх, z — к зрителю), size — размер, roll — поворот.
// Котов пока два условных; пришлёте фото — встанут настоящие: { img: 'assets/brain/кот.png', at: […], size: …, roll: … }
export const STICKERS = [
  { kind: 'emoji', char: '🙄', at: [0.02, 0.2, 1], size: 0.3, roll: 0.1 },
  { kind: 'rainbow', at: [-0.62, 0.52, 0.62], size: 0.36, roll: -0.25 },
  { kind: 'cursor', at: [0.56, 0.02, 0.84], size: 0.3, roll: 0.15 },
  { kind: 'emoji', char: '💅', at: [0.6, 0.62, 0.52], size: 0.3, roll: 0.3 },
  { kind: 'heart', at: [-0.4, -0.3, 0.9], size: 0.26, roll: -0.2 },
  { kind: 'emoji', char: '🐱', at: [-0.86, -0.02, 0.52], size: 0.29, roll: -0.12 },
  { kind: 'emoji', char: '🐈', at: [0.22, -0.42, 0.9], size: 0.28, roll: 0.08 },
  { kind: 'label', text: '⌘Z', bg: '#1f4fd8', fg: '#ff8fc7', shape: 'oval', font: 70, at: [-0.22, 0.78, 0.6], size: 0.3, roll: 0.2 },
  { kind: 'label', text: 'Aa', bg: '#111111', fg: '#ffffff', shape: 'star', font: 62, at: [0.18, 0.86, 0.5], size: 0.3, roll: -0.15 },
  { kind: 'label', text: '1px', bg: '#12b8a6', fg: '#ffffff', shape: 'pill', font: 58, at: [0.9, 0.3, 0.42], size: 0.26, roll: 0.35 },
];

function stickerTexture(st) {
  const art = canvas(), ctx = art.getContext('2d');
  if (st.image) {
    // своя картинка: вписываем в квадрат, сохраняя пропорции
    const k = Math.min((S - 44) / st.image.width, (S - 44) / st.image.height), w = st.image.width * k, h = st.image.height * k;
    ctx.drawImage(st.image, (S - w) / 2, (S - h) / 2, w, h);
  } else (draw[st.kind] || draw.emoji)(ctx, st);
  const tex = new THREE.CanvasTexture(dieCut(art));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
// Лоскут, изогнутый по форме мозга: сетка точек вокруг направления at
function stickerGeometry(at, size, roll) {
  const N = 8, c = new THREE.Vector3(at[0], at[1], at[2]).normalize();
  const t = new THREE.Vector3().crossVectors(Math.abs(c.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), c).normalize();
  const b = new THREE.Vector3().crossVectors(c, t);
  const tr = t.clone().multiplyScalar(Math.cos(roll)).addScaledVector(b, Math.sin(roll)), br = b.clone().multiplyScalar(Math.cos(roll)).addScaledVector(t, -Math.sin(roll));
  const pos = [], uv = [], idx = [], d = new THREE.Vector3(), p = new THREE.Vector3();
  for (let iy = 0; iy <= N; iy++) for (let ix = 0; ix <= N; ix++) {
    const u = (ix / N) * 2 - 1, v = (iy / N) * 2 - 1;
    d.copy(c).addScaledVector(tr, u * size).addScaledVector(br, v * size).normalize();
    shell(d.x, d.y, d.z, p).multiplyScalar(1 + LIFT);
    pos.push(p.x, p.y, p.z); uv.push(ix / N, iy / N);
  }
  for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) { const a = iy * (N + 1) + ix; idx.push(a, a + 1, a + N + 1, a + 1, a + N + 2, a + N + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Собирает мозг: группа с самим мозгом и стикерами. dispose() освобождает память, когда мозг спрятан под кожей.
export function makeBrain() {
  const group = new THREE.Group();
  group.name = 'Brain';
  group.position.set(BRAIN.center[0], BRAIN.center[1], BRAIN.center[2]);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.22, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.3,          // мокрый блеск
    emissive: 0xff2a85, emissiveIntensity: 0.14,                          // яркий розовый даже в тени
  });
  const body = new THREE.Mesh(brainGeometry(), mat);
  body.frustumCulled = false;
  group.add(body);
  const stickers = [];
  const add = (st) => {
    const m = new THREE.MeshStandardMaterial({ map: stickerTexture(st), alphaTest: 0.5, alphaToCoverage: true, roughness: 0.45, metalness: 0, envMapIntensity: 0.5,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(stickerGeometry(st.at, st.size, st.roll || 0), m);
    mesh.frustumCulled = false; mesh.renderOrder = 1;
    group.add(mesh); stickers.push(mesh);
  };
  // Стикеры рисуются по одному, с передышками: мозг появится только через пару секунд сборки, а страница в это время
  // не должна замирать (значки-эмодзи на некоторых устройствах рисуются небыстро). Один стикер — сразу: вместе с ним
  // заранее соберётся шейдер для остальных.
  const queue = STICKERS.slice();
  let alive = true;
  const first = queue.findIndex((st) => !st.img && st.kind !== 'emoji');
  if (first >= 0) add(queue.splice(first, 1)[0]);
  const next = () => {
    const st = alive && queue.shift();
    if (!st) return;
    if (st.img) {
      // своя картинка подгружается отдельно: появится на мозге, как только загрузится
      const im = new Image();
      im.onload = () => { if (alive) add({ ...st, image: im }); };
      im.src = st.img;
    } else add(st);
    setTimeout(next, 30);
  };
  setTimeout(next, 80);
  group.userData.dispose = () => {
    alive = false;
    body.geometry.dispose(); mat.dispose();
    for (const s of stickers) { s.geometry.dispose(); s.material.map.dispose(); s.material.dispose(); }
  };
  return group;
}
