// Конфетти: голова доехала до визитки в конце кейса — вокруг неё хлопушка. Один холст поверх страницы на две секунды,
// потом он убирается. При «меньше движения» не вызывается (см. js/app.js).
const COLORS = ['#FF4D6A', '#5C7EFF', '#FFD84D', '#1D1D1F', '#7BDD8C', '#EF8733', '#C77DFF'];

export function confetti(x, y, { count = 110, colors = COLORS, spread = 1 } = {}) {
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  document.body.appendChild(c);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const rnd = (a, b) => a + Math.random() * (b - a);
  // вылетают веером вверх и в стороны, потом падают, кувыркаясь
  const ps = Array.from({ length: count }, () => {
    const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05), v = rnd(5, 15) * spread;
    return {
      x, y, vx: Math.cos(a) * v * rnd(0.6, 1.2), vy: Math.sin(a) * v, r: rnd(0, Math.PI * 2), vr: rnd(-0.3, 0.3),
      w: rnd(6, 11), h: rnd(3, 6), col: colors[Math.floor(Math.random() * colors.length)], round: Math.random() < 0.25, wob: rnd(0, 6),
    };
  });
  const t0 = performance.now(), LIFE = 2300;
  let raf = 0;
  const step = (now) => {
    const k = (now - t0) / LIFE;
    g.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.32; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.wob += 0.18;
      g.save();
      g.globalAlpha = k > 0.72 ? Math.max(0, 1 - (k - 0.72) / 0.28) : 1;
      g.translate(p.x + Math.sin(p.wob) * 1.5, p.y);
      g.rotate(p.r);
      g.fillStyle = p.col;
      if (p.round) { g.beginPath(); g.arc(0, 0, p.h * 0.7, 0, Math.PI * 2); g.fill(); } else g.fillRect(-p.w / 2, -p.h / 2 * Math.abs(Math.cos(p.wob)), p.w, p.h * Math.abs(Math.cos(p.wob)) + 0.6);
      g.restore();
    }
    if (k < 1) raf = requestAnimationFrame(step); else c.remove();
  };
  raf = requestAnimationFrame(step);
  return () => { cancelAnimationFrame(raf); c.remove(); };
}
