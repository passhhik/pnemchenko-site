// Точка входа. Содержимое берётся из content/*.json; здесь — шапка, главный экран с папками,
// «разлёт» работ, субтитры, каталог по дуге, кейсы и всё, что связано с головой.
import { Voice } from './voice.js';
import { Subtitles } from './subtitles.js';
import { Burst } from './burst.js';
import { UI } from './i18n.js';
import { content, loadContent, reloadDraft, tx, t, count, esc, srcOf, projectsOf, peekItems, thumbOf, isStack } from './content.js';
import { linesFor, REACTIONS } from './lines.js';
import { installFolderDefs, folderHTML } from './folders.js';
import { setTheme } from './theme.js';
import { createCatalog } from './arc.js';
import { renderCase } from './case.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const touchUI = window.matchMedia('(hover: none)').matches;     // телефон/планшет: наведения нет
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const box = (st) => ({
  get(k, d = null) { try { const v = st().getItem('ph:' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { st().setItem('ph:' + k, JSON.stringify(v)); } catch (_) { /* noop */ } },
});
const store = box(() => localStorage);        // помнит посетителя между визитами
const session = box(() => sessionStorage);    // живёт, пока открыта вкладка
const debug = /^(localhost|127\.)/.test(location.hostname);
const rs = document.documentElement.style;
const query = new URLSearchParams(location.search);
document.documentElement.classList.toggle('is-touch', touchUI);      // стилям: наведения нет — каталог защёлкивается на папке

// Аналитика: подключите счётчик (Метрика, GA4, Plausible…) к window.dataLayer
export function track(event, props = {}) {
  (window.dataLayer = window.dataLayer || []).push({ event, ...props });
  if (debug) console.debug('[track]', event, props);
}

const els = {
  topbar: $('[data-topbar]'), logo: $('[data-logo]'), mark: $('[data-logo-mark]'), nav: $('.topnav'), lang: $('[data-lang]'),
  sound: $('[data-sound]'), allWork: $('.topnav [href="#/work"]'),
  stage: $('#stage'), loader: $('[data-loader]'), ph: $('[data-ph]') || document.createElement('div'),      // заглушки нет в прежней версии страницы (кэш) — тогда работаем без неё
  folders: $('[data-folders]'), burst: $('[data-burst]'), subs: $('[data-subs]'), veil: $('[data-veil]'),
  views: { hero: $('[data-screen="hero"]'), work: $('[data-screen="work"]'), case: $('[data-screen="case"]') },
};

const HEAD_AR = 1.33;             // пропорции головы, пока модель не загрузилась (потом берутся с самой модели)
const MOBILE_HEAD = 0.76;         // телефон: голова (от уха до уха) занимает не больше этой доли ширины экрана
const SUBS_LH = 1.15;             // межстрочный интервал субтитров — тот же, что у .subs в css/style.css
let head = null, subs = null, catalog = null, caseView = null;
let view = null, folderEls = [], logoAR = 393 / 95;
const voice = new Voice({ head: { setMouth(v) { if (head) head.setMouth(v); } } });
// Невидимый двойник кружка в углу (стили те же, что у .stage.is-corner): по нему голова знает,
// куда лететь при переходе в каталог, ещё до того, как сцена туда доехала
const cornerProbe = document.createElement('div');
cornerProbe.className = 'corner-probe';
cornerProbe.setAttribute('aria-hidden', 'true');
document.body.appendChild(cornerProbe);

const hasLine = (id) => !!(subs && subs.lines[id]);
const say = (ids, opts) => { if (subs && !content.preview) subs.say((Array.isArray(ids) ? ids : [ids]).filter(hasLine), opts); };
const lookAtEl = (el) => {
  if (!head) return;
  if (!el) { head.clearLook(); return; }
  const r = el.getBoundingClientRect();
  head.lookAtClient(r.left + r.width / 2, r.top + r.height / 2);
};

// ---------- тексты и шапка ----------
function applyContent() {
  const site = content.site, name = tx(site.name), role = tx(site.role);
  $$('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  $$('[data-name]').forEach((el) => { el.textContent = name; });
  $$('[data-role]').forEach((el) => { el.textContent = role; });
  $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
  els.logo.setAttribute('aria-label', `${name} — ${t('home')}`);
  els.stage.setAttribute('aria-label', t('stage'));
  els.folders.setAttribute('aria-label', t('sections'));
  els.nav.setAttribute('aria-label', t('menu'));
  const desc = tx(site.description);
  if (desc) { const m = $('meta[name="description"]'); if (m) m.content = desc; }

  // резюме: нет файла — кнопки скрываем, чтобы посетитель не получил битую ссылку
  const cv = tx(site.cv);
  $$('[data-cv]').forEach((a) => { if (cv) a.href = cv; if (site.cvFileName) a.download = site.cvFileName; });
  document.body.classList.toggle('no-cv', !cv);
  if (cv && !content.preview) {
    fetch(cv, { method: 'HEAD', cache: 'no-cache' })
      .then((r) => { if (!r.ok) document.body.classList.add('no-cv'); })
      .catch(() => document.body.classList.add('no-cv'));
  }
  const mail = String(site.email || '').trim();
  $$('[data-email]').forEach((a) => { a.hidden = !mail; if (mail) { a.href = 'mailto:' + mail; a.textContent = mail; } });

  // логотип-подпись: красится в цвет интерфейса (чёрный на белом, белый на цветном фоне проекта)
  if (site.logo) {
    const url = new URL(site.logo, document.baseURI).href;
    els.mark.style.setProperty('--logo-url', `url("${url}")`);
    els.logo.classList.remove('is-text');
    els.logo.classList.add('is-ready');
    const im = new Image();
    im.onload = () => { if (im.naturalWidth && im.naturalHeight) { logoAR = im.naturalWidth / im.naturalHeight; rs.setProperty('--logo-ar', String(logoAR)); layout(); } };
    im.onerror = () => textLogo(name);
    im.src = url;
  } else textLogo(name);

  // переключатель языка появляется, когда в content/site.json включено больше одного языка
  const langs = (site.languages || []).filter((l) => UI[l]);
  els.lang.innerHTML = langs.length > 1
    ? langs.map((l) => `<button class="lang" type="button" data-set-lang="${l}" lang="${l}" aria-pressed="${l === content.lang}">${l.toUpperCase()}</button>`).join('')
    : '';
}
function textLogo(name) {
  els.logo.classList.add('is-text', 'is-ready');
  els.mark.textContent = name;
}
els.lang.addEventListener('click', (e) => {
  const b = e.target.closest('[data-set-lang]');
  if (!b || b.dataset.setLang === content.lang) return;
  store.set('lang', b.dataset.setLang);
  const url = new URL(location.href);
  if (url.searchParams.has('lang')) { url.searchParams.delete('lang'); location.replace(url.href); } else location.reload();
});

// ---------- звук ----------
els.sound.insertAdjacentHTML('beforeend', '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>');
function setSound(on, announce) {
  voice.setEnabled(on);
  store.set('sound', !!on);
  els.sound.setAttribute('aria-pressed', String(!!on));
  if (on && announce) say('sound_on', { force: true });
  track('sound', { on: !!on });
}
els.sound.addEventListener('click', () => setSound(!voice.enabled, true));
if (store.get('sound', false)) {
  // браузер разрешит звук только после первого действия посетителя — тогда и включим
  voice.enabled = true;
  els.sound.setAttribute('aria-pressed', 'true');
}
window.addEventListener('pointerdown', () => { if (voice.enabled) voice.unlock(); }, { once: true });

// ---------- папки разделов на главной ----------
const sectionProjects = (id) => projectsOf(id);
// что выглядывает из папки при наведении: по одной картинке из разных проектов раздела
function peekOf(id) {
  const per = sectionProjects(id).map(peekItems);
  const out = [];
  for (let k = 0; k < 3 && out.length < 3; k++) for (const list of per) if (list[k] && out.length < 3) out.push(list[k]);
  return out;
}
// всё, что разлетается по экрану: остальные работы и обложки — не больше дюжины на раздел, по порядку проектов
const BURST_MAX = 12;
function artsOf(id) {
  const out = [], seen = new Set(peekOf(id).map(srcOf));
  const push = (src, print, cover) => { if (src && !seen.has(src)) { seen.add(src); out.push({ src, print, cover }); } };
  for (const p of sectionProjects(id)) {
    (p.artifacts || []).forEach((a) => push(srcOf(a), !(a && typeof a === 'object' && a.cut), false));
    push(thumbOf(p), true, true);
  }
  return out.slice(0, BURST_MAX);
}
function buildFolders() {
  installFolderDefs();
  els.folders.innerHTML = (content.site.sections || []).map((s) => {
    const ps = sectionProjects(s.id);
    return folderHTML({
      href: `#/work?cat=${encodeURIComponent(s.id)}`, title: tx(s.label), pill: count(ps.length, 'project'),
      items: peekOf(s.id), stickers: ps.map((p) => p.sticker).filter(Boolean), tint: s.folder,
      cls: 'gf--section', attrs: `data-section="${esc(s.id)}"`, lazy: false,
    });
  }).join('');
  folderEls = $$('.gf', els.folders);
  folderEls.forEach(bindFolder);
}

// ---------- раскладка: шапка и главный экран ----------
const geo = { subs: null, mobile: false, fw: 220, centered: false };
function layout() {
  const W = window.innerWidth, H = window.innerHeight, mobile = isStack();
  const u = Math.min(W, 1.5 * H) / 100;                       // единица макета, как --u в стилях
  const hero = (view || 'hero') === 'hero';
  geo.mobile = mobile;

  // шапка: на главной логотип крупный (как в макете), внутри сайта — компактный.
  // Логотип — отдельный слой (на главной он лежит под головой), поэтому его место считаем здесь, а не сеткой шапки.
  let padTop, logoW, hdr, logoY;
  if (!mobile) {
    padTop = hero ? clamp(H * 0.042, 12, 60) : clamp(1.2 * u, 10, 22);
    logoW = hero ? clamp(27 * u, 200, 640) : clamp(13 * u, 132, 250);
    const row = hero ? logoW / logoAR : Math.max(clamp(3.3 * u, 40, 66), logoW / logoAR);
    hdr = hero ? padTop + row : padTop * 2 + row;
    logoY = padTop + (row - logoW / logoAR) / 2;
  } else {
    rs.setProperty('--pad-top', hero ? '12px' : '8px');
    padTop = parseFloat(getComputedStyle(els.topbar).paddingTop) || 12;      // с учётом «чёлки» телефона
    // телефон: логотип — треть ширины экрана; всё освободившееся место отдаём голове
    logoW = hero ? W / 3 : Math.min(W / 3, 36 * logoAR);
    const row = hero ? logoW / logoAR : Math.max(36, logoW / logoAR);
    hdr = hero ? padTop + row + 4 : padTop * 2 + row;
    logoY = padTop + (row - logoW / logoAR) / 2;
  }
  if (!mobile) rs.setProperty('--pad-top', `${padTop.toFixed(1)}px`);
  rs.setProperty('--logo-w', `${logoW.toFixed(1)}px`);
  rs.setProperty('--logo-y', `${logoY.toFixed(1)}px`);
  rs.setProperty('--hdr', `${Math.ceil(hdr)}px`);
  if (!hero) return;

  const ar = (head && head.aspect) || HEAD_AR;                // высота головы к её ширине (по ушам)
  const cx = W / 2;
  const saved = mobile || content.preview ? {} : session.get('folders', {});
  let width, top, subsY, subsW, subsSize, subsH, fw;
  if (!mobile) {
    // ритм макета: логотип — 3,6u — голова — 3,6u — субтитры (до верха букв), под ними поля побольше
    subsSize = clamp(2.77 * u, 18, 58);
    subsH = subsSize * SUBS_LH * 2;
    const gapTop = 3.6 * u, gapSubs = 2.9 * u, bottom = Math.max(4 * u, 26);
    const avail = H - hdr - gapTop - gapSubs - subsH - bottom;
    width = Math.max(120, Math.min(30.75 * u, avail / ar));
    const hh = width * ar;
    // лишняя высота: сначала до 3u под субтитры (как в макете), остальное — поровну сверху и снизу
    top = hdr + gapTop + Math.max(0, avail - hh - 3 * u) / 2;
    subsY = top + hh + gapSubs;
    subsW = Math.min(72 * u, W - 48);
    fw = clamp(18.5 * u, 150, 400);
    const L = cx - width / 2, R = cx + width / 2;
    folderEls.forEach((el, i) => {
      el.style.setProperty('--fw', `${fw.toFixed(1)}px`);
      el.style.setProperty('--tilt', `${Number(((content.site.sections || [])[i] || {}).tilt) || 0}deg`);
    });
    (content.site.sections || []).forEach((s, i) => {
      const el = folderEls[i];
      if (!el) return;
      // габариты наклонённой папки вместе с подписью — по факту, а не на глаз
      const t = Math.abs(Number(s.tilt) || 0) * Math.PI / 180, h0 = el.offsetHeight || fw * 1.1;
      const bw = fw * Math.cos(t) + h0 * Math.sin(t), bh = h0 * Math.cos(t) + fw * Math.sin(t);
      const at = saved[s.id];
      let [px, py] = at || s.pos || [[0.85, 0.5], [0.17, 0.66], [0.17, 0.3]][i % 3];
      let x = px * W, y = py * H;
      if (!at) {
        // расставлены автором: не ближе к голове, чем нужно, не дальше разумного на очень широком экране и не на субтитрах
        x = px < 0.5 ? Math.min(x, L - 1.5 * u - bw / 2) : Math.max(x, R + 1.5 * u + bw / 2);
        x = clamp(x, cx - 62 * u, cx + 62 * u);
        if (Math.abs(x - cx) - bw / 2 < subsW / 2) y = Math.min(y, subsY - bh / 2 - 0.3 * u);
      }
      x = clamp(x, bw / 2 + 6, W - bw / 2 - 6);
      y = clamp(y, bh / 2 + 6, H - bh / 2 - 6);
      el.style.setProperty('--x', `${x.toFixed(1)}px`); el.style.setProperty('--y', `${y.toFixed(1)}px`);
    });
    geo.centered = false;
  } else {
    // телефон: маленький логотип, крупная голова, три строки субтитров, лента папок, кнопки под большим пальцем
    subsSize = clamp(0.05 * W, 16, 32);
    subsH = subsSize * SUBS_LH * 3;
    subsW = Math.min(W - 28, subsSize * 30);
    const bar = els.nav.getBoundingClientRect().height || 66;
    // папки компактные: соседние разделы почти целиком видны по бокам, а высота уходит голове
    fw = clamp(0.2 * H, 116, 0.5 * W);
    rs.setProperty('--mfw', `${fw.toFixed(1)}px`);
    folderEls.forEach((el) => {
      el.style.setProperty('--fw', `${fw.toFixed(1)}px`);
      el.style.removeProperty('--x'); el.style.removeProperty('--y');
    });
    // высоту папки с подписью берём по факту: длинное название раздела может занять две строки
    const em = clamp(fw * 0.078, 15, 26);
    const room = (tight) => {
      els.folders.classList.toggle('is-tight', tight);
      const fh = Math.max(fw * 0.795 + em * (tight ? 2.1 : 3.9), ...folderEls.map((el) => el.offsetHeight || 0));
      return H - hdr - 12 - subsH - 12 - fh - 6 - bar;
    };
    // на невысоком экране (телефон с панелями браузера) счётчик проектов под папкой уступает место голове
    let avail = room(false);
    if (avail / ar < 0.6 * W) avail = room(true);
    width = clamp(avail / ar, 110, MOBILE_HEAD * W);
    const hh = width * ar;
    top = hdr + Math.max(0, (avail - hh) * 0.5);
    subsY = top + hh + 12;
    if (!geo.centered && folderEls.length) {
      // лента открывается на первом разделе, соседние выглядывают по бокам
      geo.centered = true;
      const first = folderEls[0];
      els.folders.scrollLeft = first.offsetLeft - (W - fw) / 2;
    }
    if (!folderEls.some((f) => f.classList.contains('is-cur'))) stripScroll();
  }
  geo.fw = fw;
  geo.subs = { x: cx - subsW / 2, y: subsY, w: subsW, h: subsH };
  if (head) head.setLayout({ cx, cy: top + (width * ar) / 2, width });
  // место головы — для силуэта в предпросмотре админки (там 3D не загружается)
  rs.setProperty('--ph-x', `${(cx - width / 2).toFixed(1)}px`); rs.setProperty('--ph-y', `${top.toFixed(1)}px`);
  rs.setProperty('--ph-w', `${width.toFixed(1)}px`); rs.setProperty('--ph-h', `${(width * ar).toFixed(1)}px`);
  rs.setProperty('--subs-x', `${cx}px`); rs.setProperty('--subs-y', `${subsY.toFixed(1)}px`);
  rs.setProperty('--subs-w', `${subsW.toFixed(1)}px`); rs.setProperty('--subs-size', `${subsSize.toFixed(2)}px`);
}
let raf = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { layout(); closeFolder(); }); });

// ---------- «разлёт» работ при наведении на папку ----------
const burst = new Burst(els.burst, { reducedMotion: reduced });
const sizes = new Map();
// Пропорции картинок берём из содержимого (админка записывает их при загрузке). Сами картинки для «разлёта»
// подгружаются заранее, но понемногу и только те, что могут вылететь; при экономии трафика — по наведению.
function knownSizes() {
  for (const p of content.projects) for (const a of p.artifacts || []) if (a && a.w && a.h) sizes.set(a.src, { w: a.w, h: a.h });
}
function preloadArtifacts() {
  if (navigator.connection && navigator.connection.saveData) return;
  const list = [...new Set((content.site.sections || []).flatMap((s) => artsOf(s.id).map((a) => a.src)))];
  let i = 0;
  const next = () => {
    if (i >= list.length) return;
    const src = list[i++], im = new Image();
    im.decoding = 'async';
    im.onload = () => { if (!sizes.has(src)) sizes.set(src, { w: im.naturalWidth, h: im.naturalHeight }); next(); };
    im.onerror = next;
    im.src = src;
  };
  next(); next();
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
function avoidRects(openEl) {
  const list = [rectOf(els.logo), rectOf(els.nav)];
  for (const f of folderEls) {
    const r = rectOf(f);
    // у открытой папки работы выглядывают вверх и в стороны — оставляем им место
    if (f === openEl) { const k = geo.fw * 0.36; list.push({ x: r.x - k * 0.45, y: r.y - k, w: r.w + k * 0.9, h: r.h + k }); } else list.push(r);
  }
  // голова поворачивается к папке — берём запас по бокам, чтобы работы не легли на щёку
  if (head && head.rect) { const r = head.rect, pad = r.w * 0.07; list.push({ x: r.x - pad, y: r.y, w: r.w + pad * 2, h: r.h }); }
  if (geo.subs) list.push(geo.subs);
  return list;
}
// Телефон: свободного места вокруг головы почти нет, поэтому работы встают по бокам головы и выглядывают
// из-за неё (слой работ лежит под головой): по углам над висками, у ушей и у подбородка.
const FLANK = [[0, 0.03, 1], [1, 0.07, 1], [0, 0.86, 1], [1, 0.9, 1], [0, 0.45, 0.82], [1, 0.5, 0.82]];   // сторона, высота вдоль головы, размер
function flankSpots(items) {
  const r = head && head.rect, W = window.innerWidth;
  if (!r) return [];
  const base = clamp(W * 0.25, 76, 190);
  const floor = (geo.subs ? geo.subs.y : r.y + r.h) - 6;        // ниже — субтитры: на них работы не кладём
  const rnd = (a, b) => a + Math.random() * (b - a);
  return items.slice(0, FLANK.length).map((it, i) => {
    const [side, k, sz] = FLANK[i];
    const ar = (it.w || 1) / (it.h || 1), long = base * sz * rnd(0.92, 1.08);
    const w = ar >= 1 ? long : long * ar, h = ar >= 1 ? long / ar : long;
    const x = side ? W - w - rnd(6, 12) : rnd(6, 12);
    const y = clamp(r.y + r.h * k - h / 2 + rnd(-6, 6), 6, floor - h);
    return { x, y, w, h, src: it.src, print: !!it.print, rot: rnd(4, 11) * (side ? 1 : -1) };
  });
}
let openId = null, openT = 0, closeT = 0, dragging = null;
function openFolder(el) {
  const id = el.dataset.section;
  if (openId === id || dragging) return;
  folderEls.forEach((f) => f.classList.toggle('is-open', f === el));
  openId = id;
  const items = shuffle(artsOf(id).map((a) => ({ ...a, ...(sizes.get(a.src) || (a.cover ? { w: 4, h: 3 } : { w: 1, h: 1 })) })));
  const u = Math.min(window.innerWidth, 1.5 * window.innerHeight) / 100;
  burst.show(rectOf($('.gf-body', el)), items, avoidRects(el),
    geo.mobile ? { spots: flankSpots(items) } : { size: clamp(12 * u, 110, 230), max: BURST_MAX });
  say(`folder_${id}`, { force: true });
  lookAtEl(el);
  track('folder_open', { section: id });
}
function closeFolder() {
  clearTimeout(openT);
  if (!openId) return;
  openId = null;
  folderEls.forEach((f) => f.classList.remove('is-open'));
  burst.hide();
  if (head) head.clearLook();
}
let lastPointer = 'mouse';
window.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, { capture: true, passive: true });

function bindFolder(el) {
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch' || dragging) return;
    clearTimeout(closeT); clearTimeout(openT);
    openT = setTimeout(() => openFolder(el), 60);
  });
  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch') return;
    clearTimeout(openT);
    closeT = setTimeout(closeFolder, 160);
  });
  el.addEventListener('focus', () => { if (el.matches(':focus-visible')) openFolder(el); });
  el.addEventListener('blur', () => { closeT = setTimeout(() => { if (!els.folders.contains(document.activeElement)) closeFolder(); }, 0); });

  // папку можно утащить в любое место экрана (на телефоне папки стоят лентой и не таскаются)
  let d = null, dropped = 0;
  el.addEventListener('pointerdown', (e) => {
    if (geo.mobile || (e.pointerType === 'mouse' && e.button !== 0)) return;
    d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, ox: parseFloat(el.style.getPropertyValue('--x')) || 0, oy: parseFloat(el.style.getPropertyValue('--y')) || 0, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
  });
  el.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 6) return;
      d.moved = true; dragging = el;
      closeFolder();
      el.classList.add('is-dragging');
    }
    const W = window.innerWidth, H = window.innerHeight, m = geo.fw * 0.3;
    el.style.setProperty('--x', `${clamp(d.ox + dx, m, W - m).toFixed(1)}px`);
    el.style.setProperty('--y', `${clamp(d.oy + dy, m, H - m).toFixed(1)}px`);
  });
  const end = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const moved = d.moved;
    d = null;
    if (!moved) return;
    dragging = null; dropped = performance.now();
    el.classList.remove('is-dragging');
    const x = parseFloat(el.style.getPropertyValue('--x')), y = parseFloat(el.style.getPropertyValue('--y'));
    const at = [x / window.innerWidth, y / window.innerHeight];
    if (content.preview) {
      // в предпросмотре админки папки расставляет автор сайта: место уходит в настройки раздела
      if (window.parent !== window) window.parent.postMessage({ type: 'ph:folder', id: el.dataset.section, pos: at }, location.origin);
      return;
    }
    const all = session.get('folders', {});
    all[el.dataset.section] = at;
    session.set('folders', all);
    // положили папку на лицо — голова возмущается; унесли к самому краю экрана — просит не прятать кейсы
    const r = head && head.rect, W = window.innerWidth, H = window.innerHeight;
    if (r && x > r.x + r.w * 0.12 && x < r.x + r.w * 0.88 && y > r.y + r.h * 0.1 && y < r.y + r.h * 0.9) say('drag_face', { force: true });
    else if (x < W * 0.1 || x > W * 0.9 || y < H * 0.12 || y > H * 0.88) say('drag_folder_far', { force: true });
    else say(REACTIONS.dragFolder, { pick: true });
    track('folder_drag', { section: el.dataset.section });
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dragstart', (e) => e.preventDefault());

  el.addEventListener('click', (e) => {
    // отпустили после перетаскивания — это не клик
    if (performance.now() - dropped < 400) { e.preventDefault(); return; }
    if (lastPointer !== 'touch') return;
    // лента на телефоне: касание боковой папки ставит её в центр (там она раскроется), касание центральной — открывает раздел
    if (geo.mobile && stripCenter().el !== el) { e.preventDefault(); stripTo(el); return; }
    if (reduced || openId === el.dataset.section) return;
    // наведения нет: касание показывает работы и через мгновение открывает раздел
    e.preventDefault();
    openFolder(el);
    setTimeout(() => { location.hash = el.getAttribute('href'); }, 750);
  });
}

// ---------- телефон: лента папок ----------
// Лента защёлкивается на папке (scroll-snap в стилях). Папка, вставшая в центр, раскрывается и показывает работы.
// Пока лента едет, голова следит за подъезжающей папкой — на телефоне она следит только за папками и за наклоном
// (за пальцем — нет, см. head.js).
let stripArmed = false, stripT = 0, lookT = 0;
function stripCenter() {
  const mid = window.innerWidth / 2;
  let el = null, off = Infinity, x = mid, y = 0;
  for (const f of folderEls) {
    const r = f.getBoundingClientRect(), cx = r.left + r.width / 2, d = Math.abs(cx - mid);
    if (d < off) { off = d; el = f; x = cx; y = r.top + r.width * 0.4; }
  }
  return { el, off, x, y, mid };
}
function stripTo(el, smooth = true) {
  stripArmed = true;
  els.folders.scrollTo({ left: el.offsetLeft - (els.folders.clientWidth - el.offsetWidth) / 2, behavior: smooth && !reduced ? 'smooth' : 'auto' });
}
// взгляд возвращается к посетителю, когда папки перестали ехать
function holdLook(ms = 1900) { clearTimeout(lookT); lookT = setTimeout(() => { if (head && geo.mobile && !dragging) head.clearLook(); }, ms); }
function stripSettle() {
  clearTimeout(stripT);
  if (!geo.mobile || view !== 'hero' || !stripArmed) return;
  const c = stripCenter();
  if (!c.el || c.off > 10) return;                 // палец ещё держит ленту между папками
  if (openId !== c.el.dataset.section) { openFolder(c.el); vibrate(8); }
  holdLook();
}
function stripScroll() {
  if (!geo.mobile || view !== 'hero') return;
  const c = stripCenter();
  if (!c.el) return;
  folderEls.forEach((f) => f.classList.toggle('is-cur', f === c.el));      // текущая папка — та, что ближе к центру
  if (!stripArmed) return;                          // ленту поставил на место скрипт, а не посетитель
  // раскрытая папка уехала из центра — работы возвращаются в неё
  if (openId && (c.el.dataset.section !== openId || c.off > c.el.offsetWidth * 0.3)) closeFolder();
  // взгляд ведёт папка, которая сейчас ближе к центру; сдвиг усилен, чтобы поворот головы читался
  if (head) head.lookAtClient(c.mid + (c.x - c.mid) * 2.2, c.y);
  holdLook();
  clearTimeout(stripT);
  stripT = setTimeout(stripSettle, 140);
}
els.folders.addEventListener('scroll', stripScroll, { passive: true });
els.folders.addEventListener('scrollend', stripSettle);
['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach((ev) => els.folders.addEventListener(ev, () => { stripArmed = true; }, { passive: true }));
const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) { /* noop */ } };
if (debug) window.__strip = () => ({ armed: stripArmed, openId, mobile: geo.mobile, view });

// ---------- роутинг ----------
let catalogHi = false, switchT = 0, greeted = false, booted = false;
function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  if (parts[0] === 'work' && parts[1]) return show('case', { slug: decodeURIComponent(parts[1]) });
  if (parts[0] === 'work') return show('work', { cat: params.get('cat') || 'all' });
  return show('hero');
}
function show(next, opts = {}) {
  const prev = view;
  if (prev === 'work') catalog.activate(false);          // каталог запоминает, где его оставили
  if (caseView) { caseView.destroy(); caseView = null; }
  view = next;
  closeFolder();
  // логотип и шапка плавно меняют размер только при переходе между экранами (не при загрузке и не при ресайзе)
  if (prev && prev !== next) {
    document.body.classList.add('is-switching');
    clearTimeout(switchT);
    switchT = setTimeout(() => document.body.classList.remove('is-switching'), 800);
  }
  document.body.dataset.view = next;
  if (next !== 'hero') els.ph.hidden = true;
  if (tiltTip && next !== 'hero') tiltTip.hidden = true;
  els.stage.classList.toggle('is-corner', next !== 'hero');
  for (const [k, el] of Object.entries(els.views)) el.hidden = k !== next;
  if (next === 'work') els.allWork.setAttribute('aria-current', 'page'); else els.allWork.removeAttribute('aria-current');
  if (head) { head.setMode(next === 'hero' ? 'hero' : 'corner'); head.clearLook(); head.setSceneColor(next === 'hero' ? '#FFFFFF' : '#D9D9D9'); }
  if (next !== 'case') setTheme(null);
  layout();
  const name = tx(content.site.name);
  if (next === 'work') {
    catalog.setCategory(opts.cat, true);
    catalog.activate(true, { restore: prev === 'case' });
    document.title = `${t('work')} — ${name}`;
    if (prev && prev !== 'work') $('#work-title').focus({ preventScroll: true });
    if (!catalogHi) { catalogHi = true; say(touchUI ? 'catalog_hi_touch' : 'catalog_hi', { force: true }); }
    track('view_catalog', { cat: opts.cat });
  } else if (next === 'case') {
    const p = content.projects.find((x) => x.slug === opts.slug);
    if (!p) { location.replace('#/work'); return; }
    const keep = content.preview && prev === 'case' ? window.scrollY : 0;      // в предпросмотре админки страница не прыгает наверх
    caseView = renderCase(els.views.case, p, { reduced, say: (text) => { if (subs && !content.preview) subs.say(text, { force: true }); } });
    window.scrollTo(0, keep);
    requestAnimationFrame(() => { if (view === 'case') window.scrollTo(0, keep); });      // на случай, если каталог ещё доезжал плавной прокруткой
    document.title = `${caseView.title} — ${name}`;
    if (!content.preview) $('h1', els.views.case).focus({ preventScroll: true });
    say('open_project', { force: true });
    track('open_project', { slug: p.slug });
  } else {
    window.scrollTo(0, 0);
    document.title = `${name} — ${tx(content.site.role)}`;
    if (prev) {
      if (subs) subs.clear();
      $('#hero-title').focus({ preventScroll: true });
      if (booted) greet();      // пришли по ссылке на кейс и впервые вышли на главную — голова здоровается
    }
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view === 'case') location.hash = '#/work'; });
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a');
  if (!a) return;
  if (a.matches('[data-cv]')) { say('cv', { force: true }); track('cv_download'); }
  else if (a.dataset.contact) track('contact', { via: a.dataset.contact });
});

// ---------- голова: щипки, очки, размытие, наклон ----------
// Без очков всё размыто. Резко — только сквозь линзы: в размытии вырезаны отверстия точно по их контуру,
// а сама оправа рисуется отдельным слоем поверх.
let veilOn = false;
function updateVeil() {
  const b = head ? head.blind : 0;
  if (b < 0.004) { if (veilOn) { veilOn = false; els.veil.hidden = true; } return; }
  if (!veilOn) { veilOn = true; els.veil.hidden = false; }
  const st = els.veil.style;
  st.setProperty('--blind', b.toFixed(3));
  st.setProperty('--blur', (9 * Math.pow(b, 1.35)).toFixed(2));
  let d = `M0 0H${window.innerWidth}V${window.innerHeight}H0Z`;
  for (const poly of head.lensOutlines()) d += `M${poly.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z`;
  const cp = `path(evenodd, "${d}")`;
  st.clipPath = cp; st.webkitClipPath = cp;
}

// Наклон телефона, эффект присутствия. Логотип лежит «в глубине» за головой: телефон повернули — он смещается
// в сторону зрителя, и голова отделяется от фона, как предмет за стеклом. Сдвигаем знак внутри ссылки: место самой
// ссылки-логотипа участвует в раскладке папок и меняться не должно.
let parX = 0, parY = 0;
function parallax() {
  const tl = head.tilt;
  const on = tl.w > 0.001 && view === 'hero';
  const k = Math.min(window.innerWidth, 520) * 0.07;           // «глубина» логотипа: пикселей на единицу тангенса угла
  const x = on ? Math.round(tl.px * k * 2) / 2 : 0, y = on ? Math.round(-tl.py * k * 2) / 2 : 0;
  if (x === parX && y === parY) return;
  parX = x; parY = y;
  els.mark.style.transform = x || y ? `translate3d(${x}px, ${y}px, 0)` : '';
}

// наклон телефона (гироскоп). Android: включается сразу. iPhone/iPad: нужно разрешение —
// просим плашкой, а не системным окном «из ниоткуда».
let tiltTip = null, tiltAsk = false;
const tiltLog = { asked: 0, state: '', err: '' };          // что ответил браузер — для справки ?diag
async function askTilt() {
  let state = '';
  tiltLog.asked++; tiltLog.err = '';
  try { state = await DeviceOrientationEvent.requestPermission(); } catch (e) { tiltLog.err = String((e && e.message) || e); }
  tiltLog.state = state || 'сбой';
  if (state) store.set('tilt', state);                      // сбой — не отказ: его не запоминаем, в следующий раз спросим снова
  if (state === 'granted') { head.enableTilt(); say('tilt_on', { force: true }); } else say('tilt_denied', { force: true });
  track('tilt_permission', { state: state || 'error' });
}

// Вызывается один раз, когда голова создана: подписки на её события
function wireHead() {
  head.setSceneColor(view === 'hero' ? '#FFFFFF' : '#D9D9D9');      // контровой свет цвета фона: голова «сидит» в сцене
  head.cornerRect = () => cornerProbe.getBoundingClientRect();
  if (debug) window.__head = head;

  let selfReturned = false, lookT = 0;
  head.addEventListener('grab', (e) => {
    activity();
    const r = e.detail.region;
    if (REACTIONS[r]) say(REACTIONS[r], { pick: true });
    track('grab', { region: r });
  });
  head.addEventListener('release', (e) => {
    const s = e.detail.stretch;
    voice.boing(s);
    if (s > 0.75) say(REACTIONS.stretch, { force: true, pick: true });
    store.set('stretched', true);
  });
  head.addEventListener('poke', () => { voice.boing(0.2); say(REACTIONS.poke, { pick: true }); });
  head.addEventListener('glassesoff', () => {
    selfReturned = false;
    say(REACTIONS.glassesOff, { force: true, pick: true });
    // подсказка, зачем это всё: сквозь линзы мир резкий
    clearTimeout(lookT);
    if (!session.get('lensTip', false)) lookT = setTimeout(() => { if (head.glasses.off) { session.set('lensTip', true); say('glasses_look', { force: true }); } }, 3200);
    track('glasses_off');
  });
  head.addEventListener('glassesreturn', () => { selfReturned = true; clearTimeout(lookT); say('glasses_self', { force: true }); });
  head.addEventListener('glasseson', () => { clearTimeout(lookT); if (!selfReturned) say('glasses_on', { force: true }); selfReturned = false; });
  head.addEventListener('spit', (e) => onSpit(e.detail));
  // сборка при загрузке: настоящий мозг появился — розовое пятно-заглушка под ним гаснет
  head.addEventListener('introstep', (e) => { if (e.detail.part === 'brain') { els.ph.classList.add('is-out'); setTimeout(() => { els.ph.hidden = true; }, 320); } });
  head.onTick = (dt) => { voice.tick(dt); };
  head.onFrame = () => { updateVeil(); parallax(); };

  // Датчик наклона браузеры отдают только сайту, открытому по https (защищённое соединение):
  // по http события не приходят вовсе, и голова на телефоне следит только за папками.
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const tiltOk = coarse && !reduced && window.isSecureContext && 'DeviceOrientationEvent' in window;
  tiltAsk = tiltOk && typeof DeviceOrientationEvent.requestPermission === 'function';
  if (tiltOk && !tiltAsk) head.enableTilt();
  if (tiltAsk) {
    tiltTip = document.createElement('div');
    tiltTip.className = 'tip';
    tiltTip.hidden = true;
    tiltTip.setAttribute('role', 'group');
    tiltTip.setAttribute('aria-label', t('tiltLabel'));
    tiltTip.innerHTML = '<svg class="tip-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="8" y="2.5" width="8" height="13" rx="2" transform="rotate(-12 12 9)"/><path d="M4.5 17.5a10 10 0 0 0 15 0"/><path d="M19.5 14v3.5H16"/></svg>' +
      `<span class="tip-text">${esc(t('tiltText'))}</span>` +
      `<button class="tip-btn" type="button">${esc(t('tiltOn'))}</button>` +
      `<button class="tip-close" type="button" aria-label="${esc(t('tiltNo'))}">×</button>`;
    document.body.appendChild(tiltTip);
    tiltTip.querySelector('.tip-btn').addEventListener('click', async () => { await askTilt(); tiltTip.hidden = true; });
    tiltTip.querySelector('.tip-close').addEventListener('click', () => { store.set('tilt', 'dismissed'); track('tilt_permission', { state: 'dismissed' }); tiltTip.hidden = true; });
    if (store.get('tilt') === 'granted') {
      const again = () => {
        window.removeEventListener('touchend', again); window.removeEventListener('click', again);
        tiltLog.asked++;
        DeviceOrientationEvent.requestPermission().then((st) => { tiltLog.state = st; if (st === 'granted') head.enableTilt(); }).catch((e) => { tiltLog.state = 'сбой'; tiltLog.err = String((e && e.message) || e); });
      };
      window.addEventListener('touchend', again); window.addEventListener('click', again);
    }
  }
  head.addEventListener('tiltstart', () => {
    if (!tiltAsk && !store.get('tiltHi', false)) { store.set('tiltHi', true); say('tilt_hi', { force: true }); }
    track('tilt_start');
  });
}

// ---------- приветствие и бездействие ----------
let lastActivity = performance.now();
function greet() {
  if (greeted) return;
  greeted = true;
  activity();               // отсчёт «скучающих» реплик — от приветствия, а не от начала загрузки
  spit.input = performance.now() + 600;
  const returning = store.get('seen', false);
  store.set('seen', true);
  // если за эти полсекунды посетитель уже ушёл в каталог — приветствие главного экрана там не нужно
  setTimeout(() => {
    // вторая реплика — про то, как здесь смотреть папки: навести, нажать или листать ленту (телефон)
    if (view === 'hero') say(returning ? ['hello_back'] : ['hello_1', isStack() ? 'hello_2_strip' : touchUI ? 'hello_2_touch' : 'hello_2'], { force: true });
  }, reduced ? 0 : 500);
}
function activity() { lastActivity = performance.now(); }
// движение мыши сюда попадает отфильтрованным — см. ниже, где считается бездействие для плевков
['pointerdown', 'pointerup', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, activity, { passive: true }));
// Посетитель затих на главной — голова окликает его («Эй, ты тут?»). Тишина считается с последнего
// действия посетителя или с конца последней реплики головы: договорила, подождала — и только потом окликает.
// Первый раз — через несколько секунд, дальше реже и не больше трёх реплик за одно затишье: потом она молчит
// (а если ждать совсем долго — начнёт плеваться).
const idle = { i: 0, n: 0, mark: 0, at: 0 };      // следующая реплика; сколько сказано за это затишье; когда оно началось; когда говорила
const spokeUntil = () => (subs ? Math.max(subs.busyUntil, subs.readUntil) : 0);      // до какого момента голова говорит (и её дочитывают)
setInterval(() => {
  if (view !== 'hero' || !greeted || openId || dragging || spit.state !== 'off') return;
  if (head && head.drags.size) { activity(); return; }
  const now = performance.now(), last = Math.max(lastActivity, head ? head.tilt.lastMove : 0);
  if (last > idle.mark) { idle.mark = last; idle.n = 0; }                 // посетитель шевельнулся — затишье считаем заново
  if (idle.n >= 3 || speaking()) return;
  // первая реплика — через 7 секунд; если плевкам задана совсем короткая задержка, оклик звучит раньше, чтобы успеть до них.
  // Когда весь список уже прозвучал, голова окликает реже (вдвое, втрое…), чтобы не надоедать
  const round = 1 + Math.floor(idle.i / REACTIONS.idle.length);
  const wait = idle.n ? 13000 : Math.min(7, Math.max(2.5, SPIT_AFTER * 0.6)) * 1000 * round;
  if (now - (idle.n ? idle.at : Math.max(last, spokeUntil())) < wait) return;
  say(REACTIONS.idle[idle.i++ % REACTIONS.idle.length], { force: true });
  idle.n++; idle.at = now;
}, 500);
// ---------- пасхалка: посетитель «залип» — голова заплёвывает экран ----------
// Если долго ничего не трогать, голова начинает плевать в экран — по одному, с паузами: слюна летит, шлёпается
// о «стекло», стекает. Так понемногу заполняется весь экран. Любое действие посетителя — и стекло вытирается.
// Сама слюна — в js/spit.js, движение головы — в head.js (spit).
// СКОЛЬКО ЖДАТЬ — задаётся в админке: «Настройки сайта» → «Плевки» (минуты бездействия; 0 — выключить).
// В содержимом это site.spitAfter; пока оно не загрузилось — 10 минут. Проверить с любым значением можно адресом: …/?spit=5 (секунды).
const SPIT_DEFAULT_MIN = 10;
let SPIT_AFTER = SPIT_DEFAULT_MIN * 60;       // секунды
function spitDelay(site) {
  const q = Number(query.get('spit'));
  if (q > 0) return q;
  const m = site ? site.spitAfter : undefined;
  if (m === 0 || m === '0') return Infinity;                      // выключено
  return (Number(m) > 0 ? Number(m) : SPIT_DEFAULT_MIN) * 60;
}
const spit = { state: 'off', fx: null, n: 0, t: 0, to: null, pending: null, input: performance.now(), px: -1, py: -1 };   // state: off | on | done | dead
if (debug) window.__spit = spit;
const speaking = () => !!subs && (document.body.classList.contains('is-speaking') || performance.now() < Math.max(subs.busyUntil, subs.readUntil));
// Настоящее действие посетителя (не наклон телефона и не речь головы): отсчёт заново, плевки стираются
function userInput() {
  spit.input = performance.now();
  if (spit.state === 'on' || spit.state === 'done') stopSpit();
}
['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((ev) => window.addEventListener(ev, userInput, { passive: true, capture: true }));
window.addEventListener('pointermove', (e) => {
  // браузер шлёт «движение» и когда под неподвижным курсором что-то поменялось — считаем только настоящий сдвиг
  if (Math.hypot(e.clientX - spit.px, e.clientY - spit.py) < 4) return;
  spit.px = e.clientX; spit.py = e.clientY;
  activity();
  userInput();
}, { passive: true });
document.addEventListener('visibilitychange', () => { spit.input = performance.now(); });      // считаем только время, когда вкладка на виду
setInterval(() => {
  if (spit.state !== 'off' || !head || !head.loaded || !booted || reduced || document.hidden) return;
  if (head.drags.size || dragging || [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended)) { spit.input = performance.now(); return; }
  // отсчёт — с последнего действия посетителя или с конца последней реплики: голова не плюёт, едва договорив
  if (performance.now() - Math.max(spit.input, spokeUntil()) > SPIT_AFTER * 1000 && !speaking()) startSpit();
}, 250);

async function startSpit() {
  spit.state = 'on'; spit.n = 0; spit.almost = false;
  try {
    if (!spit.fx) { const { SpitScreen } = await import('./spit.js'); spit.fx = new SpitScreen(); spit.fx.onResize = userInput; }   // окно повернули или растянули — стекло вытирается
  } catch (e) { console.warn('Плевки недоступны', e); spit.state = 'dead'; return; }
  if (spit.state !== 'on') return;                 // пока модуль грузился, посетитель очнулся
  spit.fx.reset();
  say('spit_warn', { force: true });
  spit.t = setTimeout(spitAim, 2400);
  track('spit_start');
}
// Голова шкодничает, а не строчит очередями. Один плевок — маленькая сценка: присмотрелась к чистому месту, набрала
// в щёки, плюнула, проводила плевок взглядом и глянула на посетителя — ну как? Пауза — и всё сначала.
// Стекло заполняется понемногу: десяток-полтора плевков примерно за минуту.
const spitRnd = (a, b) => a + Math.random() * (b - a);
function spitAim() {
  if (spit.state !== 'on' || !head) return;
  if (speaking()) { spit.t = setTimeout(spitAim, 250); return; }          // договорит — тогда и плюнет
  const to = spit.pending || spit.fx.next();       // куда плюнуть: в ещё чистое место; null — стекло заплёвано
  if (!to) { spitDone(); return; }
  spit.pending = to;
  head.lookAtClient(to.x, to.y);                   // присматривается
  spit.t = setTimeout(spitFire, spit.n ? spitRnd(450, 800) : 900);
}
function spitFire() {
  if (spit.state !== 'on' || !head) return;
  const hark = spit.n > 0 && Math.random() < 0.3;  // иногда — с долгим «хррр»
  if (!head.spit({ wind: hark ? 0.95 : spitRnd(0.5, 0.75), hark })) { spit.t = setTimeout(spitFire, 150); return; }
  spit.to = spit.pending; spit.pending = null;
  spit.n++;
  spit.t = setTimeout(spitAim, 4500);              // страховка: если плевок почему-то не вылетит или не долетит, серия идёт дальше
}
function spitDone() {
  if (spit.state !== 'on') return;
  clearTimeout(spit.t);
  spit.state = 'done';
  if (head) head.clearLook();
  say('spit_done', { force: true });
  track('spit_done', { n: spit.n });
}
// голова «выстрелила» — плевок летит от рта в экран. Первый — с «Тьфу!». Дальше она комментирует уже после шлепка:
// после каждого второго плевка — очередная реплика из списка, а когда чистого стекла осталось мало — «Ещё чуть-чуть».
const SPIT_SAY = ['spit_5', 'spit_2', 'spit_4', 'spit_3', 'spit_6'];
const SPIT_ALMOST = 0.52;        // доля заплёванного стекла, с которой «ещё чуть-чуть» (серия кончается на 0,64 — см. next() в spit.js)
function onSpit({ from }) {
  const to = spit.to, n = spit.n;
  if (spit.state !== 'on' || !to) return;
  spit.to = null;
  voice.spit(0.7);
  if (n === 1) say('spit_1', { force: true });
  spit.fx.launch(from, to, () => {
    voice.splat(0.6); vibrate(10);
    if (spit.state !== 'on') return;
    clearTimeout(spit.t);
    setTimeout(() => { if (spit.state === 'on' && head) head.clearLook(); }, 500);        // посмотрела, как растеклось, — и на посетителя
    let line = null;
    if (!spit.almost && spit.fx.coverage > SPIT_ALMOST) { spit.almost = true; line = 'spit_7'; }
    else if (n % 2 === 0) line = SPIT_SAY[n / 2 - 1] || null;
    if (line) setTimeout(() => { if (spit.state === 'on') say(line, { force: true }); }, 450);
    spit.t = setTimeout(spitAim, n < 4 ? spitRnd(2400, 3800) : spitRnd(1700, 3200));
  });
}
function stopSpit() {
  clearTimeout(spit.t);
  spit.state = 'off'; spit.to = null; spit.pending = null;
  if (head) { head.stopSpit(); head.clearLook(); }
  if (spit.fx && spit.fx.wipe()) say('spit_back', { force: true });
  spit.input = performance.now();
  track('spit_wipe', { n: spit.n });
}

// ---------- проверка на телефоне: адрес …/?diag показывает, что видит сайт ----------
// Удобно, когда «на телефоне что-то не так»: размер экрана, размер головы, защищено ли соединение и жив ли датчик наклона.
let modelAt = 0;
// Как сайт загрузился: сколько файлов и мегабайт пришло по сети, сжимает ли их сервер, сколько браузер взял из своей памяти
// и через сколько секунд была готова модель головы. Старые браузеры размеров не сообщают — тогда пишем только число файлов.
function netLine() {
  try {
    const all = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')].filter((e) => e.name.startsWith(location.origin));
    if (!all.length) return 'загрузка: браузер не сообщает';
    const mb = (b) => (b / 1048576).toFixed(1).replace('.', ',');
    let wire = 0, raw = 0, kept = 0, text = 0, packed = 0, known = false;
    for (const e of all) {
      if (e.decodedBodySize == null) continue;
      known = true;
      wire += e.transferSize || 0; raw += e.decodedBodySize || 0;
      if (!e.transferSize && e.decodedBodySize) kept++;
      if (/\.(js|css|json|html|svg)(\?|$)|\/(\?[^/]*)?$/.test(e.name) && e.decodedBodySize > 2000) { text++; if (e.encodedBodySize && e.encodedBodySize < e.decodedBodySize * 0.95) packed++; }
    }
    const ready = modelAt ? `; модель через ${(modelAt / 1000).toFixed(1).replace('.', ',')} с` : '';
    if (!known) return `загрузка: файлов ${all.length}${ready}`;
    return `загрузка: файлов ${all.length}, по сети ${mb(wire)} из ${mb(raw)} МБ, сжатие: ${!text ? '—' : packed ? 'есть' : 'нет'}, из памяти браузера: ${kept}${ready}`;
  } catch (_) { return 'загрузка: браузер не сообщает'; }
}
function diag() {
  const el = document.createElement('pre');
  el.className = 'diag';
  document.body.appendChild(el);
  const yes = (v) => (v ? 'да' : 'нет');
  const deg = (v) => Math.round((v || 0) * 57.3);
  // скорость: сколько кадров в секунду рисует голова и с какой плотностью пикселей (она подстраивается под устройство)
  const fpsLine = () => {
    const q = head && head.q;
    if (!q) return 'кадры: головы нет';
    return `кадры: ${q.fps}/с${q.calm ? ' (покой — вдвое реже)' : ''}, плотность ${q.ratio.toFixed(2)} из ${(window.devicePixelRatio || 1).toFixed(2)}${q.pinned ? ', закреплена' : ''}`;
  };
  const draw = () => {
    const W = window.innerWidth, H = window.innerHeight, r = head && head.rect, tl = head && head.tilt;
    // наклон включён — остаются две строки про него: справка не должна закрывать лицо, на которое смотрят
    el.textContent = (tl && tl.on && tl.n ? [
      fpsLine(),
      `наклон: событий ${tl.n}, углы α β γ ${[tl.a, tl.b, tl.g].map((v) => (v == null ? '—' : Math.round(v))).join(' ')}`,
      `зритель ${deg(tl.ty)}° ${deg(tl.tp)}°, крен ${deg(tl.lean)}° → голова ${deg(tl.yaw)}° ${deg(tl.pitch)}° ${deg(tl.roll)}°`,
    ] : [
      `экран ${W}×${H} @${(window.devicePixelRatio || 1).toFixed(2)}, раскладка: ${isStack() ? 'телефон' : 'компьютер'}`,
      `голова: ${r ? `${Math.round(r.w)} px — ${Math.round((r.w / W) * 100)}% ширины` : (head ? 'в углу' : 'нет (WebGL)')}`,
      `https: ${yes(window.isSecureContext)} (${location.protocol}//${location.host})`,
      fpsLine(),
      netLine(),
      `датчик наклона: ${'DeviceOrientationEvent' in window ? 'есть' : 'нет'}; разрешение: ${tiltAsk ? (store.get('tilt') || 'не спрошено') : 'не нужно'}`,
      `запрос разрешения: ${tiltLog.asked ? `${tiltLog.asked} раз, ответ: ${tiltLog.state || 'ждём'}${tiltLog.err ? ` (${tiltLog.err})` : ''}` : 'не отправлялся'}`,
      `наклон: ${tl && tl.on ? 'включён, событий пока нет' : 'выключен'}`,
      `касание: ${yes(window.matchMedia('(pointer: coarse)').matches)}; меньше движения: ${yes(reduced)}; плевки: ${Number.isFinite(SPIT_AFTER) ? `через ${SPIT_AFTER} с` : 'выключены'}`,
    ]).join('\n');
  };
  draw();
  setInterval(draw, 500);
  // Ползунки эффекта присутствия: подобрать на телефоне, как голова отвечает на наклон (значения — в справке выше)
  if (head && window.matchMedia('(pointer: coarse)').matches) {
    const box = document.createElement('div');
    box.className = 'tune';
    box.innerHTML = [['depth', 'объём', -1, 1], ['follow', 'доворот', 0, 1], ['roll', 'крен', 0, 1]]
      .map(([k, label, min, max]) => `<label><span>${label} <output>${head.tiltCfg[k]}</output></span><input type="range" min="${min}" max="${max}" step="0.05" value="${head.tiltCfg[k]}" data-k="${k}" aria-label="${label}"></label>`).join('');
    box.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      head.tiltCfg[k] = Number(e.target.value);
      e.target.parentNode.querySelector('output').textContent = e.target.value;
    });
    document.body.appendChild(box);
  }
}

// ---------- предпросмотр из админки: содержимое приходит черновиком, голова не нужна ----------
function redraw() {
  knownSizes();
  applyContent();
  buildFolders();
  catalog.render();
  route();
}
if (content.preview) {
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'ph:draft' || !catalog) return;
    // сначала адрес (без лишнего перехода), потом содержимое: у проекта мог поменяться адрес страницы
    const want = e.data.hash || '';
    const moved = want && want !== (location.hash || '#/');
    if (moved) history.replaceState(null, '', want);
    if (reloadDraft()) redraw(); else if (moved) route();
    if (e.data.focus) setTimeout(() => catalog.focus(e.data.focus), 80);      // «папка в каталоге»: показать проект открытым
    if (e.data.block != null) {                                                // открыли блок в админке — показываем его
      setTimeout(() => { const el = document.querySelector(`[data-b="${Number(e.data.block)}"]`); if (el) el.scrollIntoView({ block: 'center' }); }, 60);
    }
  });
}

// ---------- старт ----------
async function boot() {
  try {
    await loadContent();
  } catch (e) {
    console.error(e);
    els.loader.textContent = 'Не удалось загрузить содержимое сайта. Обновите страницу.';
    return;
  }
  const site = content.site;
  SPIT_AFTER = spitDelay(site);
  const vars = { name: tx(site.name), nameGen: tx(site.nameGen) || tx(site.name), role: tx(site.role) };
  subs = new Subtitles({
    el: els.subs, srEl: $('[data-subs-sr]'), voice, reducedMotion: reduced,
    lines: linesFor(content.lang, site.lines),          // исходные реплики и поверх — свои, из админки
    fmt: (s) => String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''),
  });
  if (debug) window.__subs = subs;
  knownSizes();
  applyContent();
  buildFolders();
  catalog = createCatalog(els.views.work, {
    reduced, onHover: lookAtEl,
    onFilter(cat, n) {
      history.replaceState(null, '', cat === 'all' ? '#/work' : `#/work?cat=${encodeURIComponent(cat)}`);
      say(n ? `filter_${cat}` : 'empty', { force: true });
      track('filter', { cat });
    },
  });
  layout();
  route();                                   // шапка, папки и каталог уже работают — голова догружается следом
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => layout());

  if (content.preview) {
    document.body.classList.add('no-webgl', 'is-preview');
    els.loader.hidden = true;
    if (window.parent !== window) window.parent.postMessage({ type: 'ph:ready' }, location.origin);
    return;
  }
  // Загрузка без процентов. Пока качается 3D-движок, на месте мозга — розовое размытое пятно (место ему задаёт layout).
  // Движок готов — пятно сменяет настоящий мозг: он висит и покачивается, пока качается модель. Модель пришла —
  // голова собирается по частям (head.js, INTRO) и только потом здоровается.
  els.ph.hidden = view !== 'hero';
  try {
    const { Head } = await import('./head.js');
    head = new Head(els.stage, { reducedMotion: reduced });
    wireHead();
    head.setMode(view === 'hero' ? 'hero' : 'corner');
    layout();
    // тому, кто здесь уже был, сборку показываем быстрее: он её видел
    await head.load(null, { intro: view === 'hero', rate: store.get('seen', false) ? 1.4 : 1 });
    modelAt = performance.now();             // модель скачана и разобрана (для справки ?diag)
  } catch (e) {
    // нет WebGL, не скачался модуль или модель — сайт остаётся рабочим, просто без головы
    console.warn('3D-голова недоступна', e);
    document.body.classList.add('no-webgl');
    head = null;
  }
  layout();
  if (!head || !head.intro.on) els.ph.hidden = true;
  els.loader.hidden = true;
  preloadArtifacts();
  await voice.init();
  if (head) await head.ready;                // голова собралась
  booted = true;
  spit.input = performance.now();      // бездействие считаем с момента, когда сайт готов, а не пока он грузился
  if (view === 'hero') greet();
  if (query.has('diag')) diag();
  // Плашка про наклон (iPhone/iPad): появляется после приветствия и сама уходит, если её не тронули
  // В режиме ?diag плашка видна сразу и не уходит, даже если раньше от неё отказались: так наклон можно включить заново.
  if (tiltTip && query.has('diag')) tiltTip.hidden = view !== 'hero';
  else if (tiltTip && store.get('tilt') == null) {
    setTimeout(() => {
      if (view !== 'hero') return;
      tiltTip.hidden = false;
      setTimeout(() => { tiltTip.hidden = true; }, 20000);
    }, 4000);
  }
}
boot();
