// Архив полароидов (#/archive; Figma: «Архив»). Карточки гостей сеткой — четыре в ряд на компьютере, две на телефоне,
// каждая чуть повёрнута. Свои карточки, которые ещё не ушли в общий архив (или все свои, пока архив не подключён),
// стоят первыми, с пометкой «видно только вам». Нажали карточку — она открывается крупно: стрелки листают, Esc закрывает.
import { content, tx, t, esc } from './content.js';
import { stickerSet, stickerSrc, stickerById } from './stickers.js';
import { polaroidsApi, fetchList, imgUrl, localPolaroids, myIds, flush } from './polaroids.js';

const PAGE = 24;
// поворот и сдвиг карточки — по её id: у каждой свой, и от раза к разу он не меняется
function jitter(key) {
  let h = 2166136261;
  for (const ch of String(key)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  h >>>= 0;
  return { rot: ((h % 1100) / 100 - 5.5).toFixed(1), dy: ((h >>> 11) % 21) - 10 };
}
const ARROW = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

// Внутренность карточки: фото, подпись, наклейки. Та же разметка, что у карточки в редакторе (js/polaroid.js)
export function cardInner(it, set) {
  const stk = (it.s || []).map((p) => {
    const st = stickerById(set, p.e), src = st && stickerSrc(st);
    return src ? `<img class="pc-stk" src="${esc(src)}" alt="" draggable="false" style="left:${(p.x * 100).toFixed(1)}%;top:${(p.y * 100).toFixed(1)}%;--r:${Number(p.r) || 0}deg">` : '';
  }).join('');
  return `<span class="pc-photo"><img class="pc-shot" src="${esc(it.src)}" alt="" loading="lazy" decoding="async" draggable="false"></span><span class="pc-cap">${esc(it.c)}</span><span class="pc-stks">${stk}</span>`;
}

export function createArchive(root, { reduced = false, onLoad = () => {}, onScroll = () => {} } = {}) {
  root.innerHTML = `<h1 id="archive-title" class="visually-hidden" tabindex="-1">${esc(t('archive'))}</h1>
    <ul class="arc-grid" data-grid></ul>
    <div class="arc-empty" data-empty hidden><p>${esc(t('arcEmpty'))}</p><a class="btn" href="#/">${esc(t('toHead'))}</a></div>
    <p class="arc-note" data-note aria-live="polite"></p>
    <div class="arc-more" data-more aria-hidden="true"></div>`;
  const grid = root.querySelector('[data-grid]'), empty = root.querySelector('[data-empty]'), note = root.querySelector('[data-note]'), sentinel = root.querySelector('[data-more]');
  let items = [], next = '', loading = false, done = false, failed = false, token = 0, set = [], told = false;
  let io = null, lb = null, lbAt = -1, lbFrom = null, raf = 0;

  const names = (it) => [...new Set((it.s || []).map((p) => { const st = stickerById(set, p.e); return st ? st.name.toLowerCase() : ''; }).filter(Boolean))];
  const dateOf = (ms) => { try { return ms ? new Date(ms).toLocaleDateString(content.lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; } catch (_) { return ''; } };
  const tagOf = (it) => (it.local ? t('arcLocal') : it.mine ? t('arcMine') : '');
  function label(it) {
    const n = names(it);
    return [it.c ? `«${it.c}»` : t('arcNoCaption'), n.length ? t('arcStickers', { list: n.join(', ') }) : '', tagOf(it)].filter(Boolean).join('. ');
  }
  function add(list) {
    let html = '';
    for (const it of list) {
      if (items.some((x) => x.key === it.key)) continue;
      items.push(it);
      const j = jitter(it.key), tag = tagOf(it);
      html += `<li class="arc-li" style="--rot:${j.rot}deg;--dy:${j.dy}px"><button class="pc arc-card${it.local ? ' is-local' : ''}${it.local || it.mine ? ' is-mine' : ''}" type="button" data-k="${items.length - 1}" aria-label="${esc(label(it))}">${cardInner(it, set)}${tag ? `<span class="arc-tag">${esc(tag)}</span>` : ''}</button></li>`;
    }
    if (html) grid.insertAdjacentHTML('beforeend', html);
  }
  function settle() {
    empty.hidden = !(done && !items.length && !failed);
    if (failed) note.textContent = items.length ? t('arcErrorMine') : t('arcError');
    else note.textContent = loading ? t('arcLoading') : '';
    if (done && !told) { told = true; onLoad(items.length); }
  }

  async function more() {
    const api = polaroidsApi();
    if (loading || done || !api) return;
    loading = true;
    settle();
    const tk = token;
    try {
      const page = await fetchList(api, { before: next, n: PAGE });
      if (tk !== token) return;
      const mine = myIds();
      add(page.items.map((it) => ({ key: it.id, id: it.id, src: imgUrl(api, it.id), c: it.c, s: it.s, t: it.t, mine: mine.has(it.id) })));
      next = page.next;
      done = !page.next || !page.items.length;
    } catch (e) {
      if (tk !== token) return;
      console.warn('Архив полароидов не ответил', e);
      done = true; failed = true;
    } finally {
      if (tk === token) { loading = false; settle(); }
    }
    // страница короткая, а архив ещё не кончился — догружаем, не дожидаясь прокрутки
    if (tk === token && !done && sentinel.getBoundingClientRect().top < window.innerHeight + 600) more();
  }

  async function open() {
    const tk = ++token;
    set = stickerSet(content.site, tx);
    items = []; next = ''; done = false; failed = false; loading = false; told = false;
    grid.innerHTML = '';
    empty.hidden = true;
    note.textContent = '';
    const api = polaroidsApi();
    if (api) { note.textContent = t('arcLoading'); try { await flush(); } catch (_) { /* уйдёт в другой раз */ } }
    if (tk !== token) return;
    add(localPolaroids().map((it) => ({ key: `l-${it.lid}`, src: it.img, c: it.c, s: it.s, t: it.t, local: true })));
    if (!api) { done = true; settle(); return; }
    if ('IntersectionObserver' in window && !io) {
      io = new IntersectionObserver((en) => { if (en.some((e) => e.isIntersecting)) more(); }, { rootMargin: '0px 0px 700px 0px' });
      io.observe(sentinel);
    }
    await more();
  }

  // ---------- карточка крупно ----------
  function lbRender() {
    const it = items[lbAt];
    if (!it || !lb) return;
    const card = lb.querySelector('.arc-lb-card');
    card.innerHTML = cardInner(it, set);
    card.setAttribute('aria-label', label(it));
    lb.querySelector('.arc-lb-meta').textContent = [dateOf(it.t), tagOf(it)].filter(Boolean).join(' · ');
    lb.querySelector('[data-lb="prev"]').disabled = lbAt <= 0;
    lb.querySelector('[data-lb="next"]').disabled = lbAt >= items.length - 1 && done;
    if (!reduced) card.animate([{ opacity: 0.4, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
  }
  function lbGo(d) {
    const k = lbAt + d;
    if (k < 0) return;
    if (k >= items.length) { if (!done) more().then(() => { if (items[k]) { lbAt = k; lbRender(); } }); return; }
    lbAt = k; lbRender();
  }
  function lbOpen(k, from) {
    lbAt = k; lbFrom = from || null;
    if (!lb) {
      lb = document.createElement('div');
      lb.className = 'arc-lb';
      lb.setAttribute('role', 'dialog');
      lb.setAttribute('aria-modal', 'true');
      lb.setAttribute('aria-label', t('polaroid'));
      lb.innerHTML = `<div class="arc-lb-scrim" data-lb="close"></div>
        <figure class="arc-lb-fig"><div class="pc arc-lb-card" role="img"></div><figcaption class="arc-lb-meta"></figcaption></figure>
        <button class="arc-lb-btn arc-lb-prev" type="button" data-lb="prev" aria-label="${esc(t('arcPrev'))}">${ARROW('M15 5l-7 7 7 7')}</button>
        <button class="arc-lb-btn arc-lb-next" type="button" data-lb="next" aria-label="${esc(t('arcNext'))}">${ARROW('M9 5l7 7-7 7')}</button>
        <button class="arc-lb-x" type="button" data-lb="close" aria-label="${esc(t('polClose'))}">${ARROW('M6 6l12 12M18 6 6 18')}</button>`;
      lb.addEventListener('click', (e) => {
        const b = e.target.closest('[data-lb]');
        if (!b) return;
        if (b.dataset.lb === 'close') lbClose(); else lbGo(b.dataset.lb === 'next' ? 1 : -1);
      });
      lb.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); lbClose(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); lbGo(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); lbGo(-1); }
        else if (e.key === 'Tab') {
          const f = [...lb.querySelectorAll('button:not([disabled])')];
          const i = f.indexOf(document.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      });
      // свайп по карточке на телефоне
      let sx = null;
      lb.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' && e.target.closest('.arc-lb-card')) sx = { x: e.clientX, y: e.clientY }; });
      lb.addEventListener('pointerup', (e) => {
        if (!sx) return;
        const dx = e.clientX - sx.x, dy = e.clientY - sx.y;
        sx = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) lbGo(dx < 0 ? 1 : -1);
      });
    }
    document.body.appendChild(lb);
    document.body.classList.add('is-lb');
    lbRender();
    lb.querySelector('.arc-lb-x').focus({ preventScroll: true });
  }
  function lbClose() {
    if (!lb || !lb.isConnected) return;
    lb.remove();
    document.body.classList.remove('is-lb');
    const back = lbFrom && lbFrom.isConnected ? lbFrom : grid.querySelector(`[data-k="${lbAt}"]`);
    if (back) back.focus({ preventScroll: true });
  }
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('.arc-card');
    if (b) lbOpen(Number(b.dataset.k), b);
  });

  // шапка: при прокрутке под ней появляется подложка, логотип уменьшается (это считает js/app.js)
  const sync = () => {
    raf = 0;
    document.body.classList.toggle('is-scrolled', window.scrollY > 12);
    onScroll();
  };
  const scrolled = () => { if (!raf) raf = requestAnimationFrame(sync); };

  return {
    open() {
      document.body.style.setProperty('--bar-bg', 'color-mix(in srgb, var(--paper) 88%, transparent)');
      window.addEventListener('scroll', scrolled, { passive: true });
      sync();
      return open();
    },
    close() {
      ++token;
      lbClose();
      window.removeEventListener('scroll', scrolled);
      cancelAnimationFrame(raf); raf = 0;
      if (io) { io.disconnect(); io = null; }
      document.body.classList.remove('is-scrolled');
      document.body.style.removeProperty('--bar-bg');
    },
    get count() { return items.length; },
  };
}
