// Точка входа. Содержимое берётся из content/*.json; здесь — шапка, главный экран с папками,
// «разлёт» работ, субтитры, каталог по дуге, кейсы и всё, что связано с головой.
import { Voice } from './voice.js';
import { Subtitles } from './subtitles.js';
import { Burst } from './burst.js';
import { UI } from './i18n.js';
import { content, loadContent, reloadDraft, tx, t, count, esc, srcOf, projectsOf, peekItems, isStack } from './content.js';
import { LINES, REACTIONS } from './lines.js';
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

// Аналитика: подключите счётчик (Метрика, GA4, Plausible…) к window.dataLayer
export function track(event, props = {}) {
  (window.dataLayer = window.dataLayer || []).push({ event, ...props });
  if (debug) console.debug('[track]', event, props);
}

const els = {
  topbar: $('[data-topbar]'), logo: $('[data-logo]'), mark: $('[data-logo-mark]'), nav: $('.topnav'), lang: $('[data-lang]'),
  sound: $('[data-sound]'), allWork: $('.topnav [href="#/work"]'),
  stage: $('#stage'), loader: $('[data-loader]'), pct: $('[data-loader-pct]'),
  folders: $('[data-folders]'), burst: $('[data-burst]'), subs: $('[data-subs]'), veil: $('[data-veil]'),
  views: { hero: $('[data-screen="hero"]'), work: $('[data-screen="work"]'), case: $('[data-screen="case"]') },
};

const HEAD_AR = 1.33;             // пропорции головы, пока модель не загрузилась (потом берутся с самой модели)
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
    push(p.cover, true, true);
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

  // шапка: на главной логотип крупный (как в макете), внутри сайта — компактный
  let padTop, logoW, hdr;
  if (!mobile) {
    padTop = hero ? clamp(H * 0.042, 12, 60) : clamp(1.2 * u, 10, 22);
    logoW = hero ? clamp(27 * u, 200, 640) : clamp(13 * u, 132, 250);
    hdr = hero ? padTop + logoW / logoAR : padTop * 2 + Math.max(clamp(3.3 * u, 40, 66), logoW / logoAR);
  } else {
    rs.setProperty('--pad-top', hero ? '12px' : '8px');
    padTop = parseFloat(getComputedStyle(els.topbar).paddingTop) || 12;      // с учётом «чёлки» телефона
    logoW = hero ? Math.min(0.83 * W, 0.105 * H * logoAR) : Math.min(0.42 * W, 36 * logoAR);
    hdr = hero ? padTop + logoW / logoAR + 6 : padTop * 2 + Math.max(36, logoW / logoAR);
  }
  if (!mobile) rs.setProperty('--pad-top', `${padTop.toFixed(1)}px`);
  rs.setProperty('--logo-w', `${logoW.toFixed(1)}px`);
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
    // телефон: логотип, голова, три строки субтитров, лента папок, кнопки под большим пальцем
    subsSize = clamp(0.05 * W, 16, 32);
    subsH = subsSize * SUBS_LH * 3;
    subsW = Math.min(W - 28, subsSize * 30);
    const bar = els.nav.getBoundingClientRect().height || 66;
    fw = clamp((0.27 * H - 59) / 0.795, 140, 0.62 * W);
    rs.setProperty('--mfw', `${fw.toFixed(1)}px`);
    folderEls.forEach((el) => {
      el.style.setProperty('--fw', `${fw.toFixed(1)}px`);
      el.style.removeProperty('--x'); el.style.removeProperty('--y');
    });
    // высоту папки с подписью берём по факту: длинное название раздела может занять две строки
    const em = clamp(fw * 0.078, 15, 26);
    const fh = Math.max(fw * 0.795 + em * 3.9, ...folderEls.map((el) => el.offsetHeight || 0));
    const avail = H - hdr - 8 - 14 - subsH - 18 - fh - 8 - bar;
    width = clamp(avail / ar, 110, 0.66 * W);
    const hh = width * ar;
    top = hdr + 8 + Math.max(0, (avail - hh) * 0.5);
    subsY = top + hh + 14;
    if (!geo.centered && folderEls.length) {
      // лента открывается на первом разделе, соседние выглядывают по бокам
      geo.centered = true;
      const first = folderEls[0];
      els.folders.scrollLeft = first.offsetLeft - (W - fw) / 2;
    }
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
let openId = null, openT = 0, closeT = 0, dragging = null;
function openFolder(el) {
  const id = el.dataset.section;
  if (openId === id || dragging) return;
  folderEls.forEach((f) => f.classList.toggle('is-open', f === el));
  openId = id;
  const items = shuffle(artsOf(id).map((a) => ({ ...a, ...(sizes.get(a.src) || (a.cover ? { w: 4, h: 3 } : { w: 1, h: 1 })) })));
  const u = Math.min(window.innerWidth, 1.5 * window.innerHeight) / 100;
  burst.show(rectOf($('.gf-body', el)), items, avoidRects(el),
    { size: geo.mobile ? clamp(window.innerWidth * 0.22, 68, 110) : clamp(12 * u, 110, 230), max: BURST_MAX });
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
    // положили папку на лицо — голова возмущается
    const r = head && head.rect;
    if (r && x > r.x + r.w * 0.12 && x < r.x + r.w * 0.88 && y > r.y + r.h * 0.1 && y < r.y + r.h * 0.9) say('drag_face', { force: true });
    else say(REACTIONS.dragFolder, { pick: true });
    track('folder_drag', { section: el.dataset.section });
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dragstart', (e) => e.preventDefault());

  el.addEventListener('click', (e) => {
    // отпустили после перетаскивания — это не клик
    if (performance.now() - dropped < 400) { e.preventDefault(); return; }
    // на телефоне наведения нет: касание показывает работы и через мгновение открывает раздел
    if (lastPointer !== 'touch' || reduced) return;
    e.preventDefault();
    openFolder(el);
    setTimeout(() => { location.hash = el.getAttribute('href'); }, 750);
  });
}

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

// наклон телефона (гироскоп). Android: включается сразу. iPhone/iPad: нужно разрешение —
// просим плашкой, а не системным окном «из ниоткуда».
let tiltTip = null, tiltAsk = false;
async function askTilt() {
  let state = 'denied';
  try { state = await DeviceOrientationEvent.requestPermission(); } catch (_) { /* отказ или нет жеста */ }
  store.set('tilt', state);
  if (state === 'granted') { head.enableTilt(); say('tilt_on', { force: true }); } else say('tilt_denied', { force: true });
  track('tilt_permission', { state });
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
  head.addEventListener('glasseson', () => { clearTimeout(lookT); if (!selfReturned) say('glasses_on', { force: true }); selfReturned = false; head.wink('R'); });
  head.onTick = (dt) => { voice.tick(dt); };
  head.onFrame = updateVeil;

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
        DeviceOrientationEvent.requestPermission().then((st) => { if (st === 'granted') head.enableTilt(); }).catch(() => {});
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
let lastActivity = performance.now(), idleCount = 0;
function greet() {
  if (greeted) return;
  greeted = true;
  activity();               // отсчёт «скучающих» реплик — от приветствия, а не от начала загрузки
  const returning = store.get('seen', false);
  store.set('seen', true);
  // если за эти полсекунды посетитель уже ушёл в каталог — приветствие главного экрана там не нужно
  setTimeout(() => {
    if (view === 'hero') say(returning ? ['hello_back'] : ['hello_1', touchUI ? 'hello_2_touch' : 'hello_2'], { force: true });
  }, reduced ? 0 : 500);
}
function activity() { lastActivity = performance.now(); }
['pointermove', 'pointerdown', 'pointerup', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, activity, { passive: true }));
setInterval(() => {
  if (view !== 'hero' || !greeted || openId || dragging || idleCount >= REACTIONS.idle.length) return;
  if (head && head.drags.size) { activity(); return; }
  const last = Math.max(lastActivity, head ? head.tilt.lastMove : 0);
  if (performance.now() - last > 14000) { say(REACTIONS.idle[idleCount++], { force: true }); activity(); }
}, 1000);

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
  const vars = { name: tx(site.name), nameGen: tx(site.nameGen) || tx(site.name), role: tx(site.role) };
  subs = new Subtitles({
    el: els.subs, srEl: $('[data-subs-sr]'), voice, reducedMotion: reduced,
    lines: { ...LINES.ru, ...(LINES[content.lang] || {}) },
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
  try {
    const { Head } = await import('./head.js');
    head = new Head(els.stage, { reducedMotion: reduced });
    wireHead();
    head.setMode(view === 'hero' ? 'hero' : 'corner');
    layout();
    await head.load((p) => { els.pct.textContent = Math.round(p * 100) + '%'; });
  } catch (e) {
    // нет WebGL, не скачался модуль или модель — сайт остаётся рабочим, просто без головы
    console.warn('3D-голова недоступна', e);
    document.body.classList.add('no-webgl');
    head = null;
  }
  layout();
  els.loader.classList.add('is-done');
  setTimeout(() => { els.loader.hidden = true; }, 600);
  preloadArtifacts();
  await voice.init();
  booted = true;
  if (view === 'hero') greet();
  // Плашка про наклон (iPhone/iPad): появляется после приветствия и сама уходит, если её не тронули
  if (tiltTip && store.get('tilt') == null) {
    setTimeout(() => {
      if (view !== 'hero') return;
      tiltTip.hidden = false;
      setTimeout(() => { tiltTip.hidden = true; }, 12000);
    }, 4000);
  }
}
boot();
