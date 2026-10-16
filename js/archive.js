// Архив полароидов (#/archive; Figma: «Архив»). Карточки гостей сеткой — четыре в ряд на компьютере, две на телефоне,
// каждая чуть повёрнута. Их только смотрят: крупно не открываются, даты нет. Своя карточка (и та, что ещё не ушла
// в общий архив) отличается лишь чуть другим цветом бумаги — без надписей; незрячему это говорит подпись карточки.
import { content, tx, t, esc } from './content.js';
import { stickerSet, stickerSrc, stickerById } from './stickers.js';
import { polaroidsApi, fetchList, imgUrl, localPolaroids, myIds, flush, capSize } from './polaroids.js';

const PAGE = 24;
// поворот и сдвиг карточки — по её id: у каждой свой, и от раза к разу он не меняется
function jitter(key) {
  let h = 2166136261;
  for (const ch of String(key)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  h >>>= 0;
  return { rot: ((h % 500) / 100 - 2.5).toFixed(1), dy: ((h >>> 11) % 13) - 6 };
}

// Внутренность карточки: фото, подпись, наклейки. Та же разметка, что у карточки в редакторе (js/polaroid.js)
export function cardInner(it, set) {
  const stk = (it.s || []).map((p) => {
    const st = stickerById(set, p.e), src = st && stickerSrc(st);
    return src ? `<img class="pc-stk" src="${esc(src)}" alt="" draggable="false" style="left:${(p.x * 100).toFixed(1)}%;top:${(p.y * 100).toFixed(1)}%;--r:${Number(p.r) || 0}deg">` : '';
  }).join('');
  return `<span class="pc-photo"><img class="pc-shot" src="${esc(it.src)}" alt="" loading="lazy" decoding="async" draggable="false"></span><span class="pc-capbox"><span class="pc-cap${capSize(it.c)}">${esc(it.c)}</span></span><span class="pc-stks">${stk}</span>`;
}

export function createArchive(root, { onLoad = () => {}, onScroll = () => {} } = {}) {
  root.innerHTML = `<h1 id="archive-title" class="visually-hidden" tabindex="-1">${esc(t('archive'))}</h1>
    <ul class="arc-grid" data-grid></ul>
    <div class="arc-empty" data-empty hidden><p>${esc(t('arcEmpty'))}</p><a class="btn" href="#/">${esc(t('toHead'))}</a></div>
    <p class="arc-note" data-note aria-live="polite"></p>
    <div class="arc-more" data-more aria-hidden="true"></div>`;
  const grid = root.querySelector('[data-grid]'), empty = root.querySelector('[data-empty]'), note = root.querySelector('[data-note]'), sentinel = root.querySelector('[data-more]');
  let items = [], next = '', loading = false, done = false, failed = false, token = 0, set = [], told = false;
  let io = null, raf = 0;

  const names = (it) => [...new Set((it.s || []).map((p) => { const st = stickerById(set, p.e); return st ? st.name.toLowerCase() : ''; }).filter(Boolean))];
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
      const j = jitter(it.key);
      html += `<li class="arc-li" style="--rot:${j.rot}deg;--dy:${j.dy}px"><div class="pc arc-card${it.local || it.mine ? ' is-mine' : ''}" role="img" aria-label="${esc(label(it))}">${cardInner(it, set)}</div></li>`;
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
      window.removeEventListener('scroll', scrolled);
      cancelAnimationFrame(raf); raf = 0;
      if (io) { io.disconnect(); io = null; }
      document.body.classList.remove('is-scrolled');
      document.body.style.removeProperty('--bar-bg');
    },
    get count() { return items.length; },
  };
}
