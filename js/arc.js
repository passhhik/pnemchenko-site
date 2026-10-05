// Каталог: папки проектов стоят на большой дуге и едут по ней при прокрутке — ближние крупнее и чуть не в фокусе.
// При наведении на папку фон страницы принимает стиль проекта. На телефоне — обычная лента сверху вниз.
import { content, tx, t, count, esc, projectsOf, peekItems, sectionById, isStack } from './content.js';
import { folderHTML } from './folders.js';
import { setTheme, themeOf } from './theme.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const G = 1.25;                 // во сколько раз папка крупнее соседней (ближе к зрителю — крупнее)
const A0 = 10, DA = 7;          // наклон папки в фокусе и шаг по дуге, градусы
const FW = 27, RHO = 260;       // ширина папки в фокусе и радиус дуги, в единицах макета (1% ширины экрана)
const FOCUS = [0.62, 0.4];     // где на экране стоит папка в фокусе
const LN_G = Math.log(G);
const NEAR = -3.1, FAR = 3.4;   // дальше этих позиций папки не видны
const INDEX_ROWS = 9;           // сколько названий видно в списке слева внизу

export function createCatalog(root, { onFilter, onHover, reduced = false }) {
  const state = { cat: 'all', list: [], active: false, items: [], step: 400, raf: 0, hoverT: 0, hovered: null, saved: {}, rowH: 0 };
  root.innerHTML = `
    <h1 class="visually-hidden" id="work-title" tabindex="-1">${esc(t('work'))}</h1>
    <div class="arc-side">
      <div class="filters" role="group" aria-label="${esc(t('filter'))}" data-filters></div>
      <nav class="arc-index" aria-hidden="true"><ol data-index></ol></nav>
    </div>
    <ol class="arc" data-arc></ol>
    <p class="empty" data-empty hidden>${esc(t('empty'))}</p>
    <div class="arc-track" data-track aria-hidden="true"></div>`;
  const arc = root.querySelector('[data-arc]');
  const index = root.querySelector('[data-index]');
  const track = root.querySelector('[data-track]');
  const filters = root.querySelector('[data-filters]');
  const empty = root.querySelector('[data-empty]');
  const mobile = isStack;
  const noHover = window.matchMedia('(hover: none)').matches;      // планшет: наведения нет — фон задаёт папка в фокусе
  // у дуги спрятано всё, что за краем; фокус на невидимой папке не должен сдвигать саму дугу
  arc.addEventListener('scroll', () => { arc.scrollTop = 0; arc.scrollLeft = 0; });

  function renderFilters() {
    const secs = content.site.sections || [];
    filters.innerHTML = [`<button class="chip" type="button" data-cat="all">${esc(t('all'))} <span class="chip-n">${projectsOf('all').length}</span></button>`]
      .concat(secs.map((s) => `<button class="chip" type="button" data-cat="${esc(s.id)}">${esc(tx(s.label))} <span class="chip-n">${projectsOf(s.id).length}</span></button>`)).join('');
    filters.querySelectorAll('.chip').forEach((ch) => {
      ch.setAttribute('aria-pressed', String(ch.dataset.cat === state.cat));
      ch.addEventListener('click', () => setCategory(ch.dataset.cat));
    });
  }

  function render() {
    state.list = projectsOf(state.cat);
    const sec = sectionById(state.cat);
    // заголовок раздела едет по дуге первым — пока каталог не прокрутили, он занимает место «предыдущей» папки
    const head = `<li class="arc-item arc-title" aria-hidden="true"><p class="arc-h">${esc(sec ? tx(sec.label) : t('allWork'))}</p><p class="arc-n">${esc(count(state.list.length, 'project'))}</p></li>`;
    arc.innerHTML = head + state.list.map((p, i) => `<li class="arc-item" data-i="${i}">${folderHTML({
      href: `#/work/${encodeURIComponent(p.slug)}`, title: tx(p.title), pill: String(p.year || ''),
      items: peekItems(p), stickers: [p.sticker], tint: p.folder, cls: 'gf--project gf--auto', attrs: `data-i="${i}"`, lazy: i > 3,
    })}</li>`).join('');
    index.innerHTML = state.list.map((p, i) => `<li><a href="#/work/${encodeURIComponent(p.slug)}" data-i="${i}" tabindex="-1">${esc(tx(p.title))}</a></li>`).join('');
    state.title = arc.firstElementChild;
    state.items = [...arc.children].slice(1);
    state.links = [...index.querySelectorAll('a')];
    empty.hidden = state.list.length > 0;
    renderFilters();
    measure();
    layout();
  }

  // длина прокрутки: один проект — один шаг; у каждого шага — точка «прилипания»
  function measure() {
    const H = window.innerHeight, n = state.list.length;
    state.step = clamp(H * 0.5, 240, 520);
    if (mobile()) { track.style.height = '0px'; track.innerHTML = ''; return; }
    track.style.height = `${H + Math.max(0, n - 1) * state.step}px`;
    track.innerHTML = state.list.map((_, i) => `<i style="top:${i * state.step}px"></i>`).join('');
    state.rowH = state.links[0] ? state.links[0].offsetHeight : 0;
  }

  const pos = () => (mobile() ? 0 : window.scrollY / state.step);

  function layout() {
    state.raf = 0;
    if (!state.active) return;
    if (mobile()) {
      for (const li of [state.title, ...state.items]) { li.style.transform = ''; li.style.filter = ''; li.style.zIndex = ''; li.style.opacity = ''; li.classList.remove('is-far'); }
      return;
    }
    const W = window.innerWidth, H = window.innerHeight, u = Math.min(W, 1.5 * H) / 100;
    const fw = clamp(FW * u, 200, 560);
    const rho = RHO * u, a0 = A0 * Math.PI / 180;
    const Fx = W * FOCUS[0], Fy = H * FOCUS[1];
    const Cx = Fx + rho * Math.sin(a0), Cy = Fy - rho * Math.cos(a0);
    const p = pos();
    const cur = clamp(Math.round(p), 0, Math.max(0, state.list.length - 1));
    const place = (li, dr, isTitle) => {
      const hidden = dr < NEAR || dr > FAR;
      const d = clamp(dr, NEAR, FAR);
      const sigma = (1 - G ** (-d)) / LN_G;             // путь по дуге: ближние папки крупнее, им нужно больше места
      const a = a0 - (DA * Math.PI / 180) * sigma;
      const x = Cx - rho * Math.sin(a), y = Cy + rho * Math.cos(a);
      const s = clamp(G ** (-d), 0.45, 2.1);
      const deg = a * 180 / Math.PI;
      li.classList.toggle('is-far', hidden || d < -1.3 || d > 2.6);      // сильно размытые и совсем дальние папки — фон, а не кнопки
      li.style.setProperty('--fw', `${fw.toFixed(1)}px`);
      li.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${deg.toFixed(2)}deg) scale(${s.toFixed(3)})`;
      // «глубина резкости»: то, что ближе фокуса, слегка размыто; дальние — чуть-чуть. Заголовок остаётся резким.
      const blur = reduced || hidden || isTitle ? 0 : (d < 0 ? Math.max(0, -d - 0.55) * 3.2 : Math.max(0, d - 1.6) * 1.6);
      li.style.filter = blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : '';
      li.style.opacity = hidden ? '0' : String(clamp(1 - Math.max(0, -d - 2.2) * 1.4, 0, 1) * clamp(1 - Math.max(0, d - 2.6) * 1.6, 0, 1));
      li.style.zIndex = String(200 - Math.round(d * 20));
    };
    place(state.title, -1 - p, true);
    state.items.forEach((li, i) => place(li, i - p, false));
    state.links.forEach((a, i) => a.classList.toggle('is-current', i === cur));
    if (noHover && state.list.length && state.hovered !== cur) hover(cur);
    // длинный список названий показывает окно вокруг текущего проекта
    const rows = state.links.length;
    index.style.transform = rows > INDEX_ROWS && state.rowH ? `translateY(${-clamp(cur - 4, 0, rows - INDEX_ROWS) * state.rowH}px)` : '';
  }
  const schedule = () => { if (!state.raf) state.raf = requestAnimationFrame(layout); };

  function scrollToIndex(i, smooth = true) {
    if (mobile()) {
      const el = state.items[i];
      if (el) el.scrollIntoView({ behavior: smooth && !reduced ? 'smooth' : 'auto', block: 'center' });
      return;
    }
    window.scrollTo({ top: clamp(i, 0, Math.max(0, state.list.length - 1)) * state.step, behavior: smooth && !reduced ? 'smooth' : 'auto' });
  }

  // фон в стиле проекта: на компьютере — под курсором или фокусом, на телефоне — у проекта в центре экрана
  function hover(i) {
    clearTimeout(state.hoverT);
    if (i === state.hovered) return;
    state.hovered = i;
    const p = i == null ? null : state.list[i];
    // фон меняется, когда курсор задержался на папке: при быстрой прокрутке под курсором он не мигает
    clearTimeout(state.themeT);
    state.themeT = setTimeout(() => setTheme(themeOf(p)), p ? 130 : 0);
    if (onHover) onHover(i == null || !state.items[i] ? null : state.items[i].querySelector('.gf'));
  }
  const unhover = () => { clearTimeout(state.hoverT); state.hoverT = setTimeout(() => hover(null), 140); };
  const idxOf = (target) => { const el = target.closest && target.closest('[data-i]'); return el ? Number(el.dataset.i) : null; };
  arc.addEventListener('pointerover', (e) => { if (e.pointerType === 'touch') return; const i = idxOf(e.target); if (i != null) hover(i); });
  arc.addEventListener('pointerout', (e) => { if (e.pointerType === 'touch') return; if (!e.relatedTarget || !arc.contains(e.relatedTarget) || idxOf(e.relatedTarget) == null) unhover(); });
  arc.addEventListener('focusin', (e) => { const i = idxOf(e.target); if (i == null) return; if (e.target.matches(':focus-visible')) { scrollToIndex(i); hover(i); } });
  arc.addEventListener('focusout', unhover);
  index.addEventListener('pointerover', (e) => { const i = idxOf(e.target); if (i == null || e.pointerType === 'touch') return; hover(i); scrollToIndex(i); });
  index.addEventListener('pointerout', unhover);

  let io = null;
  function watchCenter() {
    if (io) { io.disconnect(); io = null; }
    if (!state.active || !mobile() || !('IntersectionObserver' in window)) return;
    io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) hover(Number(en.target.dataset.i));
    }, { rootMargin: '-42% 0px -42% 0px' });
    state.items.forEach((li) => io.observe(li));
  }

  function onKey(e) {
    if (!state.active || mobile() || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    const cur = Math.round(pos());
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); scrollToIndex(cur + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); scrollToIndex(cur - 1); }
    else if (e.key === 'Home') { e.preventDefault(); scrollToIndex(0); }
    else if (e.key === 'End') { e.preventDefault(); scrollToIndex(state.list.length - 1); }
  }
  const snap = () => document.documentElement.classList.toggle('is-arc', state.active && !mobile());
  const onResize = () => { if (!state.active) return; snap(); measure(); layout(); watchCenter(); };
  window.addEventListener('scroll', () => { if (state.active) schedule(); }, { passive: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);

  function setCategory(cat, silent = false) {
    const next = cat === 'all' || (content.site.sections || []).some((s) => s.id === cat) ? cat : 'all';
    const changed = next !== state.cat;
    state.cat = next;
    render();
    if (state.active) { if (changed) window.scrollTo(0, 0); watchCenter(); }
    if (!silent && changed && onFilter) onFilter(state.cat, state.list.length);
  }

  // вызывается приложением при входе в каталог и выходе из него
  function activate(on, { restore = false } = {}) {
    if (!on && state.active) state.saved[state.cat] = window.scrollY;
    state.active = on;
    snap();
    if (on) {
      measure();
      window.scrollTo(0, restore ? (state.saved[state.cat] || 0) : 0);
      layout();
      watchCenter();
    } else { hover(null); clearTimeout(state.themeT); setTheme(null); if (io) { io.disconnect(); io = null; } }
  }

  // показать проект открытым и в фокусе (предпросмотр в админке)
  function focus(slug) {
    const i = state.list.findIndex((p) => p.slug === slug);
    if (i < 0 || !state.active) return;
    scrollToIndex(i, false);
    layout();
    state.items.forEach((li, k) => li.querySelector('.gf').classList.toggle('is-open', k === i));
    state.hovered = null;
    hover(i);
  }

  render();
  return { setCategory, activate, render, state, scrollToIndex, focus };
}
