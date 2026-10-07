// Модель головы: какую версию качать и как. Модуль ни от чего не зависит — работает ещё до того, как загрузился 3D-движок.
//
// Версии (лежат в assets/, собираются скриптом из исходной head.glb — см. README, «Модель головы»):
//   head.glb    — полная: текстура кожи 2048². Компьютеры и планшеты.
//   head-m.glb  — для телефонов: те же сетки, текстура кожи 1024². На экране телефона голова шириной до 330 точек,
//                 разницы не видно, а качать на треть меньше.
// Рядом с каждой лежит она же, сжатая gzip (.glb.gz): сервер модели не сжимает, поэтому сжатую версию сайт качает
// и распаковывает сам. Браузер без распаковщика (Safari старше 16.4) берёт обычную .glb.
// Проверить глазами: адрес …/?model=full или …/?model=phone — взять версию независимо от устройства.

const want = (() => { try { return new URLSearchParams(location.search).get('model'); } catch (_) { return null; } })();
const phone = want === 'phone' || (want !== 'full' && window.matchMedia('(max-width:600px) and (pointer:coarse)').matches);
export const MODEL_URL = phone ? 'assets/head-m.glb' : 'assets/head.glb';

const isGlb = (buf) => {
  if (!buf || buf.byteLength < 20) return false;
  const v = new DataView(buf);
  return v.getUint32(0, true) === 0x46546c67 && v.getUint32(8, true) === buf.byteLength;      // 'glTF' и верная длина
};

async function packed(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const buf = await r.arrayBuffer();
  if (isGlb(buf)) return buf;                                   // сервер распаковал сам — пришла готовая модель
  const out = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if (!isGlb(out)) throw new Error(`${url}: после распаковки это не модель`);
  return out;
}

// Байты модели. Сначала сжатая версия; не вышло (нет распаковщика, файла или он битый) — обычная.
export async function fetchModel(url = MODEL_URL) {
  if (typeof DecompressionStream === 'function' && typeof Blob.prototype.stream === 'function') {
    try { return await packed(`${url}.gz`); } catch (e) { console.warn('Сжатая модель не подошла — беру обычную', e); }
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}

// Загрузчики модели (разбор glTF и распаковка сеток) нужны только самой модели, а не мозгу, который появляется первым.
// Начинаем качать их вместе с моделью, чтобы к её приходу они были готовы.
export const LOADERS = ['vendor/three/addons/loaders/GLTFLoader.js', 'vendor/three/addons/utils/BufferGeometryUtils.js', 'vendor/three/addons/libs/meshopt_decoder.module.js'];
export function warmLoaders() {
  for (const href of LOADERS) {
    const l = document.createElement('link');
    l.rel = 'modulepreload'; l.href = href;
    document.head.appendChild(l);
  }
}

// Ждёт, пока файл придёт по сети (не «выполнится», а именно скачается): так модель начинает качаться ровно тогда,
// когда движок уже скачан, и не делит с ним канал. Браузер этого не сообщает — не ждём вовсе.
export function fetched(part, fallback) {
  const hit = (list) => list.some((e) => e.name.includes(part) && e.responseEnd > 0);
  return new Promise((resolve) => {
    let done = false;
    const ok = () => { if (!done) { done = true; resolve(); } };
    if (fallback) fallback.then(ok, ok);
    try {
      if (hit(performance.getEntriesByType('resource'))) return ok();
      const po = new PerformanceObserver((l) => { if (hit(l.getEntries())) { po.disconnect(); ok(); } });
      po.observe({ type: 'resource', buffered: true });
    } catch (_) { ok(); }
  });
}
