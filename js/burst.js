// «Разлёт» работ из папки: картинки вылетают из папки и раскладываются по свободному месту экрана,
// не залезая на голову, папки, шапку и субтитры. Раскладка случайная, но равномерная (лучший из кандидатов).

const rnd = (a, b) => a + Math.random() * (b - a);
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const grow = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });

// items: [{ src, w, h }] — натуральные размеры картинок (для пропорций)
// avoid: прямоугольники { x, y, w, h }, куда класть нельзя; area: { w, h } — размер экрана
export function layout(items, avoid, area, { size = 180, margin = 12, max = 12, tries = 40 } = {}) {
  const placed = [];
  const blocks = avoid.map((r) => grow(r, 14));
  const list = items.slice(0, max).map((it) => {
    const ar = (it.w || 1) / (it.h || 1);
    const long = size * rnd(0.82, 1.18);
    const w = ar >= 1 ? long : long * ar, h = ar >= 1 ? long / ar : long;
    return { ...it, dw: Math.round(w), dh: Math.round(h) };
  }).sort((a, b) => b.dw * b.dh - a.dw * a.dh);
  for (const it of list) {
    let best = null;
    for (let scale = 1; scale >= 0.7 && !best; scale -= 0.15) {
      const w = it.dw * scale, h = it.dh * scale;
      for (let k = 0; k < tries; k++) {
        const r = { x: rnd(margin, area.w - margin - w), y: rnd(margin, area.h - margin - h), w, h };
        if (r.x < margin || r.y < margin) continue;
        const hit = blocks.some((b) => overlap(r, b) > 0);
        if (hit) continue;
        const crowd = placed.reduce((s, p) => s + overlap(r, p), 0);
        if (crowd > 0.12 * w * h) continue;
        // чем дальше от уже лежащих, тем лучше — так картинки расходятся по всему свободному месту
        const cx = r.x + w / 2, cy = r.y + h / 2;
        let d = Infinity;
        for (const p of placed) d = Math.min(d, Math.hypot(cx - (p.x + p.w / 2), cy - (p.y + p.h / 2)) - (Math.max(p.w, p.h) + Math.max(w, h)) / 2);
        const score = placed.length ? d : rnd(0, 1);
        if (!best || score > best.score) best = { ...r, score };
      }
    }
    if (best) placed.push({ ...best, src: it.src, print: !!it.print, rot: rnd(-9, 9) });
  }
  return placed;
}

export class Burst {
  constructor(root, { reducedMotion = false } = {}) {
    this.root = root; this.rm = reducedMotion;
    this.live = [];          // картинки, которые сейчас на экране
    this.from = null;
  }

  // from: прямоугольник папки, откуда вылетают картинки
  show(from, items, avoid, opts = {}) {
    this.hide();
    const area = { w: this.root.clientWidth || window.innerWidth, h: this.root.clientHeight || window.innerHeight };
    // места могут прийти готовыми (телефон: работы встают по бокам головы) — тогда раскладка не считается
    const spots = opts.spots || layout(items, avoid, area, opts);
    const fx = from.x + from.w / 2, fy = from.y + from.h * 0.35;
    this.from = { x: fx, y: fy };
    const batch = [];
    spots.forEach((s, i) => {
      const img = new Image();
      img.className = s.print ? 'art is-print' : 'art';
      img.alt = '';
      img.decoding = 'async';
      img.src = s.src;
      img.width = Math.round(s.w); img.height = Math.round(s.h);
      img.style.width = `${Math.round(s.w)}px`; img.style.height = `${Math.round(s.h)}px`;
      img.style.zIndex = String(1 + Math.floor(Math.random() * 20));
      const start = `translate(${fx - s.w / 2}px, ${fy - s.h / 2}px) rotate(${s.rot * 0.2}deg) scale(.22)`;
      const end = `translate(${s.x}px, ${s.y}px) rotate(${s.rot}deg) scale(1)`;
      img.style.transform = end;
      this.root.appendChild(img);
      const anim = this.rm
        ? img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: 'both' })
        : img.animate([{ transform: start, opacity: 0 }, { transform: start, opacity: 1, offset: 0.08 }, { transform: end, opacity: 1 }],
          { duration: 640 + i * 18, delay: i * 34, easing: 'cubic-bezier(.16,1.18,.3,1)', fill: 'both' });
      batch.push({ img, anim, s });
    });
    this.live = batch;
    return spots.length;
  }

  // картинки втягиваются обратно в папку
  hide() {
    const batch = this.live; this.live = [];
    if (!batch.length) return;
    const f = this.from || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const n = batch.length;
    batch.forEach(({ img, anim, s }, i) => {
      let cur = img.style.transform;
      try { cur = getComputedStyle(img).transform; } catch (_) { /* noop */ }
      anim.cancel();
      img.style.transform = cur;
      const back = `translate(${f.x - s.w / 2}px, ${f.y - s.h / 2}px) rotate(0deg) scale(.2)`;
      const a = this.rm
        ? img.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'both' })
        : img.animate([{ transform: cur, opacity: 1 }, { transform: back, opacity: 0 }],
          { duration: 300, delay: (n - i) * 10, easing: 'cubic-bezier(.55,0,.8,.2)', fill: 'both' });
      a.finished.then(() => img.remove()).catch(() => img.remove());
    });
  }
}
