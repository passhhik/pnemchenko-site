// Полароид (Figma: страница «Полароид»). Голову растянули и замерли — она считает «три, два, один» (js/app.js),
// и capture() снимает её прямо с 3D-холста. Карточка выезжает сверху, переворачивается, и снимок на ней мягко
// проявляется. Дальше посетитель лепит наклейки из палитры по бокам, подписывает карточку и сохраняет — она улетает
// в архив (кружок с фотками на главной и страница #/archive, js/archive.js).
import { content, tx, t, esc, isStack } from './content.js';
import { stickerSet, stickerSrc } from './stickers.js';
import { Subtitles } from './subtitles.js';
import { savePolaroid, hasPolaroid, CAPTION_MAX } from './polaroids.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) { /* noop */ } };
export const AR = 341 / 281;     // карточка: высота к ширине — как у настоящего полароида
const ROT = 8;                   // наклон карточки в редакторе, градусы по часовой (в Figma −8°)
const SHOT = 640;                // сторона снимка, пикселей
const STK = 0.3;                 // наклейка на карточке — доля ширины карточки (в макете 89 из 281)
// Палитра на компьютере — центры кружков из макета (доли экрана 1440×803), по порядку набора наклеек:
// клоун, череп, корейское сердечко, писс, пацифик | какашка, сердечко, класс, чорт, рок
const POS = [[0.2837, 0.2534], [0.1205, 0.2983], [0.2045, 0.4776], [0.1094, 0.637], [0.2531, 0.7005],
  [0.776, 0.2983], [0.8885, 0.4527], [0.7823, 0.5722], [0.9191, 0.2846], [0.9115, 0.6215]];

// ---------- снимок ----------
// Голову снимает она сама (head.snapshot): своей камерой и в одном и том же разрешении — на компьютере и на телефоне
// кадр получается одинаковый. Дальше — проявка: квадрат вокруг головы, стена, тень, плёнка.
export function capture(head) {
  if (!head || !head.loaded || !head.snapshot) return null;
  try {
    const snap = head.snapshot(1280);
    return snap ? develop(snap.canvas, snap.head) : null;
  } catch (e) {
    console.warn('Полароид: голову снять не получилось', e);
    return null;
  }
}

// Кадр: квадрат вокруг головы на светлой стене под вспышкой, мягкая тень и лёгкий плёночный оттенок — едва заметный:
// винтаж только угадывается, лицо и цвет головы остаются чистыми, углы почти не темнеют.
// Зерно в файл не кладём (оно раздувает его вдвое) — его добавляет страница поверх фото.
function develop(roi, hr) {
  const W = roi.width, H = roi.height, d = roi.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (d[(y * W + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) { x0 = hr.x; y0 = hr.y; x1 = hr.x + hr.w; y1 = hr.y + hr.h; }
  const side = Math.max((x1 - x0) * 1.1, (y1 - y0) * 1.1, Math.max(hr.w, hr.h) * 1.15);      // голова почти во весь кадр, сверху немного воздуха
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - side * 0.01;
  const out = mk(SHOT, SHOT), o = out.getContext('2d', { willReadFrequently: true });
  const bg = o.createRadialGradient(SHOT * 0.5, SHOT * 0.4, SHOT * 0.04, SHOT * 0.5, SHOT * 0.5, SHOT * 0.8);
  bg.addColorStop(0, '#F7F6F3'); bg.addColorStop(0.6, '#EFEDE9'); bg.addColorStop(1, '#DEDBD5');
  o.fillStyle = bg; o.fillRect(0, 0, SHOT, SHOT);
  const k = SHOT / side, dx = SHOT / 2 - cx * k, dy = SHOT / 2 - cy * k, off = SHOT * 4;
  o.save();
  o.shadowColor = 'rgba(40,34,30,.2)'; o.shadowBlur = SHOT * 0.028;
  o.shadowOffsetX = off + SHOT * 0.03; o.shadowOffsetY = SHOT * 0.032;
  o.drawImage(roi, dx - off, dy, W * k, H * k);          // рисуем за краем — на холсте остаётся только тень
  o.restore();
  o.drawImage(roi, dx, dy, W * k, H * k);
  grade(o);
  return out;
}
// Плёнка — намёком: тени едва приподняты, светлые чуть мягче, цвета чуть меньше, углы темнеют совсем немного
const LUT = (() => {
  const curve = (lift, top, gm) => {
    const a = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) { const x = i / 255, s = x * x * (3 - 2 * x), y = 0.72 * x + 0.28 * s; a[i] = Math.round((lift + (top - lift) * Math.pow(y, gm)) * 255); }
    return a;
  };
  return [curve(0.018, 0.99, 1), curve(0.022, 0.985, 1), curve(0.03, 0.975, 1.01)];
})();
function grade(o) {
  const img = o.getImageData(0, 0, SHOT, SHOT), d = img.data, c = SHOT / 2, R2 = c * c * 2;
  const [LR, LG, LB] = LUT;
  for (let y = 0; y < SHOT; y++) {
    const yy = (y - c * 0.96) ** 2;
    for (let x = 0; x < SHOT; x++) {
      const i = (y * SHOT + x) * 4;
      let r = LR[d[i]], g = LG[d[i + 1]], b = LB[d[i + 2]];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * 0.96; g = l + (g - l) * 0.96; b = l + (b - l) * 0.96;
      const q = ((x - c) ** 2 + yy) / R2, v = 1 - 0.07 * q * Math.sqrt(q);
      d[i] = r * v; d[i + 1] = g * v; d[i + 2] = b * v; d[i + 3] = 255;
    }
  }
  o.putImageData(img, 0, 0);
}

// webp; где браузер его не кодирует (старый Safari) — jpeg, и не больше 190 КБ
function toBlob(cv) {
  const as = (type, q) => new Promise((res) => { try { cv.toBlob((b) => res(b), type, q); } catch (_) { res(null); } });
  return (async () => {
    const w = await as('image/webp', 0.84);
    if (w && w.type === 'image/webp' && w.size < 190e3) return w;
    for (const q of [0.86, 0.78, 0.68, 0.56]) { const j = await as('image/jpeg', q); if (j && j.size < 190e3) return j; }
    return null;
  })();
}

// ---------- редактор ----------
// shot — снимок (холст), archive — кружок «Архив» (туда улетает карточка), onClose(итог, запись) — 'saved' | 'retake' | 'close' | 'failed'
export function openPolaroid({ shot, reduced = false, voice, lines, fmt, archive = null, onClose = () => {} }) {
  const set = stickerSet(content.site, tx).slice(0, POS.length).map((s) => ({ ...s, src: stickerSrc(s) })).filter((s) => s.src);
  const prevFocus = document.activeElement;
  const root = document.createElement('div');
  root.className = 'pol';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', t('polaroid'));
  root.innerHTML = `<div class="pol-stage">
      <div class="pol-card"><div class="pol-turn">
        <div class="pc pc--edit pol-front">
          <span class="pc-photo"><i class="pc-dev"></i></span>
          <span class="pc-capbox"><textarea class="pc-cap" rows="1" maxlength="${CAPTION_MAX}" placeholder="${esc(t('polCaptionPh'))}" aria-label="${esc(t('polCaption'))}" spellcheck="false" autocomplete="off" enterkeyhint="done"></textarea></span>
          <span class="pc-stks"></span>
        </div>
        <div class="pol-back" aria-hidden="true"></div>
      </div></div>
      <div class="pol-pal" role="group" aria-label="${esc(t('polStickers'))}">${set.map((s, i) => `<button class="pol-st" type="button" data-i="${i}" aria-label="${esc(t('polSticker', { name: s.name }))}" title="${esc(s.name)}"><img src="${esc(s.src)}" alt="" draggable="false"></button>`).join('')}</div>
      <div class="pol-dlg" tabindex="-1">
        <div class="pol-say"></div>
        <div class="pol-acts"><button class="btn btn--line" type="button" data-act="retake">${esc(t('polRetake'))}</button><button class="btn" type="button" data-act="save">${esc(t('polSave'))}</button></div>
      </div>
      <button class="pol-x" type="button" data-act="close" aria-label="${esc(t('polClose'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <p class="visually-hidden" aria-live="polite" data-sr></p>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const stage = $('.pol-stage'), card = $('.pol-card'), turn = $('.pol-turn'), cap = $('.pc-cap'), layer = $('.pc-stks');
  const photo = $('.pc-photo'), pal = $('.pol-pal'), dlg = $('.pol-dlg'), sr = $('[data-sr]');
  shot.classList.add('pc-shot');
  photo.insertBefore(shot, photo.firstChild);
  // Затемнение — отдельным слоем под логотипом и кружком «Архив»; сам редактор — над ними: наклейки, карточка и окно
  // перекрывают всё (наклейку можно утащить хоть на логотип)
  const scrim = document.createElement('div');
  scrim.className = 'pol-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  const mark = (c) => { root.classList.add(c); scrim.classList.add(c); };
  document.body.appendChild(scrim);
  document.body.appendChild(root);
  document.body.classList.add('is-pol');
  const dsubs = new Subtitles({ el: $('.pol-say'), srEl: sr, voice, lines, fmt, reducedMotion: reduced });
  const geo = { cw: 0, ch: 0, cx: 0, cy: 0 };
  // Наклейки — настоящие: каждая одна. home — её место в палитре, at — куда её перетащили по экрану (доли экрана),
  // stuck — где она на карточке ({ x, y, r, el }, доли карточки). order — порядок наклеивания: позже — значит сверху
  const S = set.map(() => ({ home: { x: 0, y: 0 }, at: null, stuck: null }));
  const order = [];
  const again = hasPolaroid();               // карточка у посетителя уже есть — эта её заменит
  let ready = false, busy = false, closed = false, askT = 0, ss = 80;

  // ---------- раскладка ----------
  // Компьютер — по макету: карточка по центру, наклейки кружками по бокам, окно с репликой и кнопками внизу.
  // Телефон: карточка по центру, наклейки двумя столбиками по её бокам, окно — внизу во всю ширину.
  function layout() {
    const W = window.innerWidth, H = window.innerHeight, u = Math.min(W, 1.5 * H) / 100, mob = isStack();
    root.classList.toggle('is-mob', mob);
    root.style.setProperty('--dfs', `${(mob ? clamp(W * 0.046, 16, 20) : clamp(2 * u, 18, 30)).toFixed(1)}px`);
    dlg.style.width = `${(mob ? W - 20 : clamp(43 * u, 400, 640)).toFixed(1)}px`;
    const logo = document.querySelector('[data-logo]');
    const lb = logo ? logo.getBoundingClientRect().bottom : 60;
    const top = lb + (mob ? 10 : 16), bot = dlg.getBoundingClientRect().top - (mob ? 14 : 20);
    const sn = Math.sin((ROT * Math.PI) / 180), cs = Math.cos((ROT * Math.PI) / 180);
    const bbH = (w) => w * (AR * cs + sn), bbW = (w) => w * (cs + AR * sn);
    let cw = mob ? Math.min(W * 0.6, 360) : clamp(23.3 * u, 180, 440);
    if (bbH(cw) > bot - top) cw = Math.max(110, (bot - top) / (AR * cs + sn));
    const cy = mob ? top + (bot - top) * 0.47 : clamp(H * 0.435, top + bbH(cw) / 2, Math.max(top + bbH(cw) / 2, bot - bbH(cw) / 2));
    Object.assign(geo, { cw, ch: cw * AR, cx: W / 2, cy });
    card.style.width = `${cw.toFixed(1)}px`;
    card.style.left = `${geo.cx.toFixed(1)}px`;
    card.style.top = `${cy.toFixed(1)}px`;
    root.style.setProperty('--cw', `${cw.toFixed(1)}px`);
    const btns = [...pal.children];
    if (!mob) {
      ss = clamp(7.4 * u, 56, 120);
      btns.forEach((b, i) => { S[i].home = { x: POS[i][0] * W, y: POS[i][1] * H }; });
    } else {
      const half = Math.ceil(btns.length / 2), bh = bbH(cw), col = (W - bbW(cw)) / 2;
      ss = clamp(Math.min(col - 6, bh / (half + 0.4)), 34, 64);
      btns.forEach((b, i) => {
        const left = i < half, k = left ? i : i - half, n = left ? half : btns.length - half;
        const x = (left ? col / 2 : W - col / 2) + (k % 2 ? 1 : -1) * Math.min(5, col * 0.06);
        S[i].home = { x, y: cy - bh / 2 + ss / 2 + (n > 1 ? ((bh - ss) * k) / (n - 1) : (bh - ss) / 2) };
      });
    }
    root.style.setProperty('--s', `${ss.toFixed(1)}px`);
    btns.forEach((b, i) => { b.style.setProperty('--i', String(i)); spot(i); });
  }
  // наклейка в палитре — на своём месте или там, куда её перетащили
  function spot(i) {
    const b = pal.children[i], at = S[i].at, W = window.innerWidth, H = window.innerHeight;
    const p = at ? { x: at.fx * W, y: at.fy * H } : S[i].home;
    b.style.setProperty('--x', `${p.x.toFixed(1)}px`);
    b.style.setProperty('--y', `${p.y.toFixed(1)}px`);
    return p;
  }
  let raf = 0;
  const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { layout(); fitCap(); keyboard(); }); };

  // ---------- появление: картридж сверху, переворот, проявка ----------
  function enter() {
    layout();
    fitCap();
    requestAnimationFrame(() => mark('is-in'));                        // затемнение проявляется
    if (reduced) { root.classList.add('is-up', 'is-dev'); reveal(); return; }
    turn.style.transform = 'rotateY(180deg)';                            // выезжает рубашкой вверх
    const slide = card.animate([
      { transform: `translate(-50%, calc(-50% - ${(geo.cy + geo.ch).toFixed(0)}px)) rotate(${ROT - 10}deg)` },
      { transform: `translate(-50%, -50%) rotate(${ROT}deg)` },
    ], { duration: 1150, delay: 220, easing: 'cubic-bezier(.22,.8,.26,1)', fill: 'backwards' });
    slide.finished.then(() => {
      if (closed) return;
      turn.style.transform = '';
      const flip = turn.animate([
        { transform: 'rotateY(180deg)' },
        { transform: 'rotateY(90deg) scale(1.06)', offset: 0.5 },
        { transform: 'rotateY(0deg)' },
      ], { duration: 720, easing: 'cubic-bezier(.45,0,.2,1)' });
      setTimeout(() => { if (!closed) root.classList.add('is-up'); }, 260);
      flip.finished.then(() => { if (!closed) { root.classList.add('is-dev'); reveal(); } }, () => {});
    }, () => {});
  }
  function reveal() {
    ready = true;
    ask();
    // на компьютере — сразу в подпись; на телефоне клавиатура сама не выезжает: фокус на окне с репликой
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) cap.focus({ preventScroll: true });
    else dlg.focus({ preventScroll: true });
  }
  const ask = () => { clearTimeout(askT); dsubs.say(again ? 'photo_ask_again' : 'photo_ask', { force: true }); };

  // ---------- наклейки ----------
  // Каждая наклейка одна. Её таскают по экрану и оставляют где угодно. Над карточкой она уже в том размере и наклоне,
  // в каком ляжет, и приклеивается ровно там, где её отпустили, — заготовленных мест нет. На другую наклейку не клеится:
  // над занятым местом она бледнеет, а отпущенная там — возвращается, откуда её взяли. Приклеенную не утащить — только
  // отклеить нажатием, и она вернётся на своё место; нижнюю не отклеить, пока сверху другая.
  const rad = (ROT * Math.PI) / 180;
  const center = () => { const r = card.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  function toCard(px, py) {
    const c = center(), dx = px - c.x, dy = py - c.y;
    return { x: (dx * Math.cos(-rad) - dy * Math.sin(-rad)) / geo.cw + 0.5, y: (dx * Math.sin(-rad) + dy * Math.cos(-rad)) / geo.ch + 0.5 };
  }
  function toClient(x, y) {
    const c = center(), lx = (x - 0.5) * geo.cw, ly = (y - 0.5) * geo.ch;
    return { x: c.x + lx * Math.cos(rad) - ly * Math.sin(rad), y: c.y + lx * Math.sin(rad) + ly * Math.cos(rad) };
  }
  const onCard = (p) => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1;
  const announce = (text) => { sr.textContent = text; };
  // расстояние между наклейками на карточке — в долях размера наклейки
  const gap = (a, b) => Math.hypot((a.x - b.x) * geo.cw, (a.y - b.y) * geo.ch) / (geo.cw * STK);
  const blocked = (c) => order.some((k) => gap(S[k].stuck, c) < 0.62);
  const covered = (i) => order.slice(order.indexOf(i) + 1).some((k) => gap(S[k].stuck, S[i].stuck) < 0.9);
  function line(id) { clearTimeout(askT); dsubs.say(id, { force: true }); askT = setTimeout(ask, 3400); }
  // прилипла: наклейка из палитры становится частью карточки
  function stick(i, x, y, r = Math.round(rnd(-14, 14)), pop = true) {
    const st = set[i], b = pal.children[i];
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'pc-stk';
    el.dataset.i = String(i);
    el.setAttribute('aria-label', t('polPlaced', { name: st.name }));
    el.innerHTML = `<img src="${esc(st.src)}" alt="" draggable="false">`;
    S[i].stuck = { x: clamp(x, 0, 1), y: clamp(y, 0, 1), r, el };
    S[i].at = null;
    el.style.left = `${(S[i].stuck.x * 100).toFixed(2)}%`;
    el.style.top = `${(S[i].stuck.y * 100).toFixed(2)}%`;
    el.style.setProperty('--r', `${r}deg`);
    layer.appendChild(el);
    order.push(i);
    b.classList.add('is-used');
    b.setAttribute('aria-hidden', 'true');
    b.tabIndex = -1;
    // прилетела сама — подпрыгивает; донесли рукой — её прижимают к карточке
    if (pop && !reduced) {
      el.animate(pop === 'press' ? [
        { transform: `translate(-50%,-50%) rotate(${r}deg) scale(1.06)` },
        { transform: `translate(-50%,-50%) rotate(${r}deg) scale(.97)`, offset: 0.55 },
        { transform: `translate(-50%,-50%) rotate(${r}deg) scale(1)` },
      ] : [
        { transform: `translate(-50%,-50%) rotate(${r}deg) scale(1.16)` },
        { transform: `translate(-50%,-50%) rotate(${r}deg) scale(.95)`, offset: 0.6 },
        { transform: `translate(-50%,-50%) rotate(${r}deg) scale(1)` },
      ], { duration: pop === 'press' ? 200 : 260, easing: 'ease-out' });
    }
    vibrate(8);
    announce(t('polAdded', { name: st.name, n: order.length }));
  }
  // отклеить нажатием: если сверху лежит другая — сначала её
  function peel(i) {
    const p = S[i].stuck;
    if (!p || busy) return;
    if (covered(i)) {
      if (!reduced) p.el.animate([{ transform: `translate(-50%,-50%) rotate(${p.r}deg)` }, { transform: `translate(-50%,-50%) rotate(${p.r - 6}deg)` }, { transform: `translate(-50%,-50%) rotate(${p.r + 6}deg)` }, { transform: `translate(-50%,-50%) rotate(${p.r}deg)` }], { duration: 300 });
      line('photo_peel_top');
      return;
    }
    const from = toClient(p.x, p.y), b = pal.children[i];
    order.splice(order.indexOf(i), 1);
    S[i].stuck = null;
    const was = document.activeElement === p.el;
    p.el.remove();
    b.classList.remove('is-used');
    b.removeAttribute('aria-hidden');
    b.tabIndex = 0;
    const to = spot(i);
    fly(b, inStage(from.x, from.y), to);
    if (was) b.focus({ preventScroll: true });
    announce(t('polRemoved', { name: set[i].name }));
  }
  // перелёт наклейки в палитре из точки from на её место (сама кнопка уже стоит там)
  function fly(b, from, to, ms = 380) {
    if (reduced) return Promise.resolve();
    const dx = from.x - to.x, dy = from.y - to.y;
    return b.animate([
      { transform: `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px)) scale(1.06)` },
      { transform: 'translate(-50%,-50%) scale(1)' },
    ], { duration: ms, easing: 'cubic-bezier(.3,.7,.3,1)' }).finished.catch(() => {});
  }
  // свободное место на карточке: подальше от уже наклеенных, лучше — на фото
  function freeSpot() {
    let best = null, bd = 0;
    for (let k = 0; k < 40; k++) {
      const c = { x: rnd(0.18, 0.82), y: rnd(k < 30 ? 0.13 : 0.6, k < 30 ? 0.68 : 0.88) };
      const d = order.reduce((m, j) => Math.min(m, gap(S[j].stuck, c)), 9);
      if (d > bd) { bd = d; best = c; }
    }
    return bd >= 0.62 ? best : null;
  }
  // нажали наклейку (или Enter): она сама летит на свободное место карточки
  function autoPlace(i) {
    if (!ready || busy || S[i].stuck) return;
    const c = freeSpot();
    if (!c) { line('photo_full'); return; }
    const b = pal.children[i], br = b.getBoundingClientRect(), to = toClient(c.x, c.y), r = Math.round(rnd(-14, 14));
    if (reduced) { stick(i, c.x, c.y, r, false); return; }
    b.classList.add('is-flying');
    b.animate([
      { transform: 'translate(-50%,-50%) scale(1)' },
      { transform: `translate(calc(-50% + ${((to.x - br.left - br.width / 2) * 0.5).toFixed(1)}px), calc(-50% + ${((to.y - br.top - br.height / 2) * 0.5 - 40).toFixed(1)}px)) rotate(${(ROT + r) / 2}deg) scale(1.15)`, offset: 0.5 },
      { transform: `translate(calc(-50% + ${(to.x - br.left - br.width / 2).toFixed(1)}px), calc(-50% + ${(to.y - br.top - br.height / 2).toFixed(1)}px)) rotate(${ROT + r}deg) scale(${((geo.cw * STK) / br.width).toFixed(3)})` },
    ], { duration: 440, easing: 'cubic-bezier(.3,.6,.3,1)' }).finished.then(() => {
      b.classList.remove('is-flying');
      if (!closed && !S[i].stuck) stick(i, c.x, c.y, r);
    }, () => b.classList.remove('is-flying'));
  }

  // нажали наклейку и не потащили — она подпрыгивает, а голова подсказывает, что её надо тащить
  function hint(b) {
    if (!reduced) b.animate([{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,-50%) scale(1.14) rotate(-8deg)', offset: 0.35 }, { transform: 'translate(-50%,-50%) scale(.96) rotate(5deg)', offset: 0.7 }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 420, easing: 'ease-out' });
    line('photo_drag');
  }
  // перетаскивание наклейки: идёт за пальцем куда угодно; над карточкой — в размере и наклоне, как ляжет.
  // Наклейки лежат внутри сцены редактора, а сцену на телефоне поднимает клавиатура (--kb): координаты пальца —
  // экранные, поэтому место наклейки считаем от верхнего левого угла сцены. Иначе при открытой клавиатуре наклейка
  // ехала выше пальца, а приклеивалась под ним
  const inStage = (x, y) => { const r = stage.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
  const place = (b, x, y) => { const p = inStage(x, y); b.style.setProperty('--x', `${p.x.toFixed(1)}px`); b.style.setProperty('--y', `${p.y.toFixed(1)}px`); };
  let drag = null;
  function onMove(e) {
    const d = drag;
    if (!d || e.pointerId !== d.pid) return;
    const x = e.clientX - d.ox, y = e.clientY - d.oy;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
      d.moved = true;
      d.b.style.setProperty('--r', `${d.r}deg`);
      d.b.style.setProperty('--k', ((geo.cw * STK) / (d.b.offsetWidth || ss)).toFixed(3));
      d.b.classList.add('is-held');
      root.classList.add('is-dragging');
    }
    place(d.b, x, y);
    const c = toCard(x, y), over = onCard(c);
    d.b.classList.toggle('is-over', over);
    d.b.classList.toggle('is-blocked', over && blocked(c));
  }
  function onUp(e) {
    const d = drag;
    if (!d || e.pointerId !== d.pid) return;
    stopDrag();
    d.b.classList.remove('is-held', 'is-over', 'is-blocked');
    if (!d.moved) { if (e.type === 'pointerup') hint(d.b); return; }
    const x = e.clientX - d.ox, y = e.clientY - d.oy, W = window.innerWidth, H = window.innerHeight;
    const c = toCard(x, y);
    if (onCard(c)) {
      if (!blocked(c) && e.type === 'pointerup') { stick(d.i, c.x, c.y, d.r, 'press'); return; }      // отпустили над карточкой — приклеилась ровно тут
      const to = d.from;                                 // на другую наклейку не клеится — возвращается, откуда взяли
      place(d.b, to.x, to.y);
      fly(d.b, { x, y }, to, 320);
      if (e.type === 'pointerup') line('photo_on_sticker');
      return;
    }
    // оставили на экране — там и лежит (не за краем); место — в долях сцены
    const m = Math.max(24, ss * 0.45), q = inStage(x, y);
    S[d.i].at = { fx: clamp(q.x, m, W - m) / W, fy: clamp(q.y, m, H - m) / H };
    const p = spot(d.i);
    if (Math.abs(p.x - q.x) > 1 || Math.abs(p.y - q.y) > 1) fly(d.b, q, p, 240);
  }
  function stopDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    root.classList.remove('is-dragging');
    drag = null;
  }
  pal.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.pol-st');
    if (!b || b.classList.contains('is-used') || b.classList.contains('is-flying') || !ready || busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    drag = { i: Number(b.dataset.i), b, pid: e.pointerId, x0: e.clientX, y0: e.clientY, ox: e.clientX - cx, oy: e.clientY - cy, from: { x: cx, y: cy }, moved: false, r: Math.round(rnd(-14, 14)) };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
  // клавиатура: Enter на наклейке в палитре — наклеить; на карточке — Enter или Delete отклеивают
  pal.addEventListener('click', (e) => { const b = e.target.closest('.pol-st'); if (b && e.detail === 0) autoPlace(Number(b.dataset.i)); });
  // приклеенная отклеивается нажатием; если её пытались тащить — нет: отклеить перетаскиванием нельзя,
  // она только качнётся — держится
  let press = null;
  const pressMove = (e) => { if (press && e.pointerId === press.pid && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) press.moved = true; };
  const pressEnd = (e) => { if (press && e.pointerId === press.pid) { window.removeEventListener('pointermove', pressMove); window.removeEventListener('pointerup', pressEnd); window.removeEventListener('pointercancel', pressEnd); } };
  layer.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.pc-stk')) return;
    press = { pid: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    window.addEventListener('pointermove', pressMove);
    window.addEventListener('pointerup', pressEnd);
    window.addEventListener('pointercancel', pressEnd);
  });
  layer.addEventListener('click', (e) => {
    const el = e.target.closest('.pc-stk');
    if (!el) return;
    if (e.detail !== 0 && press && press.moved) {
      const p = S[Number(el.dataset.i)].stuck;
      if (p && !reduced) p.el.animate([{ transform: `translate(-50%,-50%) rotate(${p.r}deg)` }, { transform: `translate(-50%,-50%) rotate(${p.r - 4}deg)` }, { transform: `translate(-50%,-50%) rotate(${p.r + 3}deg)` }, { transform: `translate(-50%,-50%) rotate(${p.r}deg)` }], { duration: 260 });
      return;
    }
    peel(Number(el.dataset.i));
  });
  layer.addEventListener('keydown', (e) => {
    const el = e.target.closest('.pc-stk');
    if (el && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); peel(Number(el.dataset.i)); }
  });

  // ---------- подпись ----------
  // Enter: на компьютере ⌘/Ctrl+Enter — сохранить; на телефоне «Готово» на клавиатуре прячет её (новой строки в подписи нет)
  cap.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) save();
    else if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) cap.blur();
  });
  // Подпись стоит посередине белого поля, как на готовой карточке в архиве, тем же кеглем: поле растёт по строкам,
  // а третьей строки не будет — текст, который в две не влезает, просто не печатается
  const twoLines = () => parseFloat(getComputedStyle(cap).lineHeight) * 2 + 1;
  function fitCap() {
    cap.style.height = '0px';
    cap.style.height = `${cap.scrollHeight}px`;
  }
  let capOk = '';
  cap.addEventListener('input', () => {
    const v = cap.value.replace(/\s*\n\s*/g, ' ');
    let cut = [...v].slice(0, CAPTION_MAX).join('');
    if (cut !== cap.value) cap.value = cut;
    fitCap();
    if (cap.scrollHeight > twoLines()) {
      const pos = Math.max(0, cap.selectionStart - (cap.value.length - capOk.length));
      cap.value = capOk; fitCap();
      try { cap.setSelectionRange(pos, pos); } catch (_) { /* поле не в фокусе */ }
    }
    capOk = cap.value;
  });
  // Телефон: клавиатура закрывает низ экрана — сдвигаем всё вверх ровно настолько, чтобы подпись осталась видна
  const vv = window.visualViewport;
  function keyboard() {
    let shift = 0;
    if (vv && document.activeElement === cap && isStack()) {
      const cur = parseFloat(stage.style.getPropertyValue('--kb')) || 0;
      const bottom = cap.getBoundingClientRect().bottom - cur, limit = vv.offsetTop + vv.height - 12;
      shift = Math.min(0, limit - bottom);
    }
    stage.style.setProperty('--kb', `${shift.toFixed(0)}px`);
  }
  cap.addEventListener('focus', () => setTimeout(keyboard, 60));
  cap.addEventListener('blur', () => setTimeout(keyboard, 60));
  if (vv) { vv.addEventListener('resize', keyboard); vv.addEventListener('scroll', keyboard); }

  // ---------- кнопки ----------
  async function save() {
    if (!ready || busy) return;
    busy = true;
    root.classList.add('is-busy');
    if (document.activeElement === cap) cap.blur();
    const s = order.map((i) => ({ e: set[i].id, x: S[i].stuck.x, y: S[i].stuck.y, r: S[i].stuck.r })), c = cap.value;
    let entry = null;
    try { const blob = await toBlob(shot); if (blob) entry = await savePolaroid({ blob, c, s }); } catch (e) { console.warn('Полароид не сохранился', e); }
    if (closed) return;
    await flyAway();
    finish(entry ? 'saved' : 'failed', entry);
  }
  // карточка уменьшается и улетает в кружок «Архив»
  function flyAway() {
    document.body.classList.remove('is-pol');              // шапка и кружок архива возвращаются, пока карточка летит
    mark('is-out');
    stage.style.setProperty('--kb', '0px');
    if (reduced) return Promise.resolve();
    const b = archive && archive.getBoundingClientRect();
    const has = b && b.width > 0;
    const to = has ? { x: b.left + b.width * 0.62, y: b.top + b.height * 0.55 } : { x: window.innerWidth - 90, y: window.innerHeight - 90 };
    const k = has ? (b.width * 0.48) / geo.cw : 0.2;
    const dx = to.x - geo.cx, dy = to.y - geo.cy;
    return card.animate([
      { transform: `translate(-50%,-50%) rotate(${ROT}deg)` },
      { transform: `translate(calc(-50% + ${(dx * 0.35).toFixed(0)}px), calc(-50% + ${(dy * 0.2 - 30).toFixed(0)}px)) rotate(${ROT - 4}deg) scale(${(0.5 + k * 0.5).toFixed(3)})`, offset: 0.4 },
      { transform: `translate(calc(-50% + ${dx.toFixed(0)}px), calc(-50% + ${dy.toFixed(0)}px)) rotate(${ROT + 6}deg) scale(${k.toFixed(3)})`, opacity: 0.2 },
    ], { duration: 720, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' }).finished.then(() => {
      if (has) { archive.classList.remove('is-bump'); void archive.offsetWidth; archive.classList.add('is-bump'); }
    }, () => {});
  }
  function retake() {
    if (busy) return;
    busy = true;
    mark('is-out');
    if (reduced) { finish('retake'); return; }
    card.animate([
      { transform: `translate(-50%,-50%) rotate(${ROT}deg)` },
      { transform: `translate(-50%, calc(-50% - ${(geo.cy + geo.ch).toFixed(0)}px)) rotate(${ROT + 12}deg)` },
    ], { duration: 520, easing: 'cubic-bezier(.55,0,.75,.2)', fill: 'forwards' }).finished.then(() => finish('retake'), () => finish('retake'));
  }
  function dismiss() {
    if (busy) return;
    busy = true;
    mark('is-out');
    if (reduced) { finish('close'); return; }
    card.animate([{ opacity: 1 }, { opacity: 0, transform: `translate(-50%, -46%) rotate(${ROT + 3}deg) scale(.92)` }], { duration: 260, easing: 'ease-in', fill: 'forwards' })
      .finished.then(() => finish('close'), () => finish('close'));
  }
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'save') save();
    else if (a.dataset.act === 'retake') retake();
    else if (a.dataset.act === 'close') dismiss();
  });
  // Esc — закрыть; Tab ходит только внутри окна
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); return; }
    if (e.key !== 'Tab') return;
    const f = [...root.querySelectorAll('button:not([disabled]), textarea')].filter((el) => el.getClientRects().length);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
  });
  window.addEventListener('resize', onResize);

  function finish(res, entry = null) {
    if (closed) return;
    closed = true;
    stopDrag();
    clearTimeout(askT);
    dsubs.clear();
    window.removeEventListener('resize', onResize);
    if (vv) { vv.removeEventListener('resize', keyboard); vv.removeEventListener('scroll', keyboard); }
    document.body.classList.remove('is-pol');
    root.remove();
    scrim.remove();
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    onClose(res, entry, again);
  }

  enter();
  return {
    close() { finish('close'); },
    get open() { return !closed; },
  };
}
