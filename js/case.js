// Страница кейса. Шапка на цвете проекта → белый лист: цифры, суть в трёх абзацах, блоки с подробностями,
// теги, контакт и следующий проект. Блоки и их порядок задаются в content/projects.json (их правит админка).
import { content, tx, t, esc, srcOf, sectionById, peekItems } from './content.js';
import { folderHTML } from './folders.js';
import { setTheme, themeOf, toneOf } from './theme.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BACK = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3 4.5 8l5 5"/></svg>';
const color = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '').trim()) ? String(c).trim() : '');
// адрес картинки для url('…') в стилях: без кавычек и скобок, которые оборвали бы запись
const cssUrl = (u) => encodeURI(String(u)).replace(/['()]/g, (ch) => `%${ch.charCodeAt(0).toString(16)}`);

const paras = (s) => String(tx(s) || '').split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)
  .map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
const h2 = (b) => (tx(b.title) ? `<h2>${esc(tx(b.title))}</h2>` : '');
const cap = (b) => (tx(b.caption) ? `<figcaption>${esc(tx(b.caption))}</figcaption>` : '');
const pic = (src, alt, extra = '') => `<img src="${esc(src)}" alt="${esc(tx(alt) || '')}" loading="lazy" decoding="async"${extra}>`;
// Размеры картинки (их запоминает админка при загрузке): браузер заранее оставляет под неё место, и страница не прыгает,
// когда картинка догружается при прокрутке. Нет размеров — всё работает как раньше.
const sized = (o) => !!(o && typeof o === 'object' && o.w > 0 && o.h > 0);
const dims = (o) => (sized(o) ? ` width="${Math.round(o.w)}" height="${Math.round(o.h)}"` : '');
const tile = (bg) => (color(bg) ? ` style="--tile:${color(bg)}"` : '');
const widthOf = (b, def = 'wide') => (['text', 'wide', 'full'].includes(b.width) ? b.width : def);
const figures = (list) => (list || []).filter((m) => m && (tx(m.v) || tx(m.l)))
  .map((m) => `<div><p class="result-v">${esc(tx(m.v))}</p><p class="result-l">${esc(tx(m.l))}</p></div>`);

// Виды блоков. Новый вид = новая функция здесь + форма в админке.
const BLOCKS = {
  text: (b) => (tx(b.title) || tx(b.text) ? `<section class="blk blk-text">${h2(b)}<div class="prose">${paras(b.text)}</div></section>` : ''),

  image(b) {
    const src = srcOf(b);
    if (!src) return '';
    const framed = !!(b.cut || color(b.bg));          // вырезанная картинка (без фона) кладётся на подложку
    // вырезанная картинка стоит в подложке в свой размер, поэтому место под неё считается в стилях (см. .blk-image.has-bg img.is-sized)
    const extra = dims(b) + (framed && sized(b) ? ` class="is-sized" style="--w:${Math.round(b.w)};--h:${Math.round(b.h)}"` : '');
    return `<figure class="blk blk-image blk--${widthOf(b)}${framed ? ' has-bg' : ''}"${tile(b.bg)}>${h2(b)}<div class="frame">${pic(src, b.alt, extra)}</div>${cap(b)}</figure>`;
  },

  gallery(b) {
    const items = (b.items || []).filter((it) => srcOf(it));
    if (!items.length) return '';
    const cols = clamp(Math.round(Number(b.columns)) || Math.min(3, items.length), 1, 4);
    const cover = (it) => (it.fit || b.fit) === 'cover';
    return `<section class="blk blk--${widthOf(b)}">${h2(b)}<div class="blk-gallery" style="--cols:${cols}">${items.map((it) =>
      `<figure class="tile"><div class="tile-box${cover(it) ? ' is-cover' : ''}"${tile(it.bg || b.bg)}>${pic(srcOf(it), it.alt, dims(it))}</div>${cap(it)}</figure>`).join('')}</div></section>`;
  },

  metrics(b) {
    const f = figures(b.items);
    return f.length ? `<section class="blk">${h2(b)}<div class="blk-metrics" style="--n:${Math.min(4, f.length)}">${f.join('')}</div></section>` : '';
  },

  quote(b) {
    if (!tx(b.text)) return '';
    const who = [tx(b.author), tx(b.role)].filter(Boolean).map(esc).join(', ');
    return `<figure class="blk blk-quote"><blockquote>${paras(b.text)}</blockquote>${who ? `<figcaption>${who}</figcaption>` : ''}</figure>`;
  },

  steps(b) {
    const items = (b.items || []).filter((s) => tx(s.title) || tx(s.text));
    if (!items.length) return '';
    return `<section class="blk blk-steps">${h2(b)}<ol>${items.map((s) =>
      `<li><h3>${esc(tx(s.title))}</h3>${tx(s.text) ? `<p>${esc(tx(s.text))}</p>` : ''}</li>`).join('')}</ol></section>`;
  },

  compare(b) {
    const a = srcOf(b.before), z = srcOf(b.after);
    if (!a || !z) return '';
    return `<figure class="blk blk-compare blk--${widthOf(b)}">${h2(b)}<div class="cmp" style="--at:50%">
      ${pic(a, (b.before && b.before.alt) || t('before'), dims(b.before))}
      <div class="cmp-after">${pic(z, (b.after && b.after.alt) || t('after'))}</div>
      <span class="cmp-tag cmp-tag--a" aria-hidden="true">${esc(t('before'))}</span><span class="cmp-tag cmp-tag--b" aria-hidden="true">${esc(t('after'))}</span>
      <input type="range" min="0" max="100" value="50" step="1" aria-label="${esc(t('compare'))}">
      <span class="cmp-bar" aria-hidden="true"></span>
    </div>${cap(b)}</figure>`;
  },

  video(b, { reduced }) {
    const src = srcOf(b);
    if (!src) return '';
    // короткая запись интерфейса по кругу: играет сама и без звука, но с кнопками — чтобы можно было остановить
    const loop = !!b.loop && !reduced;
    return `<figure class="blk blk-video blk--${widthOf(b)}">${h2(b)}<video src="${esc(src)}"${b.poster ? ` poster="${esc(b.poster)}"` : ''} preload="metadata" controls playsinline${loop ? ' muted loop data-loop' : ''}${tx(b.alt) ? ` aria-label="${esc(tx(b.alt))}"` : ''}></video>${cap(b)}</figure>`;
  },

  palette(b) {
    const cs = (b.colors || []).filter((c) => color(c.hex));
    if (!cs.length) return '';
    return `<section class="blk blk-palette">${h2(b)}<ul>${cs.map((c) => {
      const hex = color(c.hex);
      return `<li style="--sw:${hex};--sw-fg:${toneOf(hex) === 'dark' ? '#fff' : '#000'}"><span>${esc(tx(c.name) || '')}</span><span>${esc(hex.toUpperCase())}</span></li>`;
    }).join('')}</ul></section>`;
  },
};
export const BLOCK_TYPES = Object.keys(BLOCKS);

function blockHTML(b, ctx, i) {
  const fn = b && BLOCKS[b.type];
  if (!fn) return '';
  const html = fn(b, ctx);
  if (!html) return '';
  const say = tx(b.say);
  // на первом теге блока — его номер (для предпросмотра в админке) и реплика головы
  return html.replace(/^<(\w+) /, `<$1 data-b="${i}" ${say ? `data-say="${esc(say)}" ` : ''}`);
}

const telegramUrl = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://t.me/${s.replace(/^@/, '').replace(/^t\.me\//i, '')}`;
};

// say(text) — голова произносит реплику к блоку, когда он доехал до середины экрана
export function renderCase(root, p, { reduced = false, say = null } = {}) {
  const list = content.projects;
  const next = list.length > 1 ? list[(list.indexOf(p) + 1) % list.length] : null;
  const sec = sectionById(p.section);
  const title = tx(p.title);
  const theme = themeOf(p);
  const tone = theme ? (theme.tone || toneOf(theme.color)) : 'light';
  const site = content.site;
  const facts = [['year', p.year], ['role', tx(p.role)], ['client', tx(p.client)], ['team', tx(p.team)], ['duration', tx(p.duration)]].filter(([, v]) => v);
  const results = figures(p.metrics).slice(0, 4);
  const tl = p.tldr || {};
  const tldr = [['task', tx(tl.task)], ['did', tx(tl.did)], ['result', tx(tl.result)]].filter(([, v]) => v);
  const tags = (p.tags || []).map(tx).filter(Boolean);
  const blocks = (p.blocks || []).map((b, i) => blockHTML(b, { reduced }, i)).filter(Boolean).join('');
  const mail = String(site.email || '').trim(), tg = telegramUrl(site.telegram), cv = tx(site.cv);
  const back = sec ? `#/work?cat=${encodeURIComponent(sec.id)}` : '#/work';

  root.innerHTML = `
    <header class="case-hero">
      <a class="case-back" href="${back}">${BACK}<span>${esc(sec ? tx(sec.label) : t('allWork'))}</span></a>
      <h1 class="case-title" tabindex="-1">${esc(title)}</h1>
      ${tx(p.summary) ? `<p class="case-lead">${esc(tx(p.summary))}</p>` : ''}
      ${facts.length ? `<dl class="case-facts">${facts.map(([k, v]) => `<div><dt>${esc(t(k))}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${p.cover ? `<img class="case-cover" src="${esc(p.cover)}" alt="${esc(t('cover', { title }))}" decoding="async" fetchpriority="high"${p.thumb ? ` style="background-image:url('${esc(cssUrl(p.thumb))}')"` : ''}>` : ''}
    </header>
    <div class="case-sheet" data-sheet>
      <div class="case-in">
        ${results.length ? `<section class="case-results" style="--n:${results.length}" aria-label="${esc(t('results'))}">${results.join('')}</section>` : ''}
        ${tldr.length ? `<section class="case-tldr${results.length ? '' : ' is-first'}" style="--n:${tldr.length}">${tldr.map(([k, v]) => `<div><h2>${esc(t(k))}</h2><p>${esc(v)}</p></div>`).join('')}</section>` : ''}
        ${blocks ? `<div class="case-blocks">${blocks}</div>` : ''}
        ${tags.length ? `<ul class="case-tags" aria-label="${esc(t('tags'))}">${tags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <section class="case-end">
          <div class="case-contact">
            ${mail || tg ? `<p>${esc(t('talk'))}</p>` : ''}
            <div class="row">
              ${mail ? `<a class="btn" href="mailto:${esc(mail)}" data-contact="email">${esc(t('write'))}</a>` : ''}
              ${tg ? `<a class="btn${mail ? ' btn--line' : ''}" href="${esc(tg)}" target="_blank" rel="noopener" data-contact="telegram">${esc(t('telegram'))}</a>` : ''}
              ${cv ? `<a class="btn btn--line" data-cv href="${esc(cv)}" download>${esc(t('downloadCv'))}</a>` : ''}
              <a class="btn btn--line" href="#/work">${esc(t('allWork'))}</a>
            </div>
          </div>
          ${next ? `<div class="case-next">${folderHTML({
    href: `#/work/${encodeURIComponent(next.slug)}`, title: tx(next.title), pill: t('next'),
    items: peekItems(next), stickers: [next.sticker], tint: next.folder, cls: 'gf--project gf--auto' })}</div>` : ''}
        </section>
      </div>
    </div>`;

  setTheme(theme);

  // пока под шапкой сайта цветная шапка кейса — интерфейс в тоне проекта; когда наехал белый лист — чёрный на белом
  const sheet = root.querySelector('[data-sheet]');
  const bar = document.querySelector('[data-topbar]');
  let raf = 0;
  const rgb = theme && /^#?([0-9a-f]{6})$/i.exec(theme.color);
  const tint = rgb ? `rgba(${parseInt(rgb[1].slice(0, 2), 16)},${parseInt(rgb[1].slice(2, 4), 16)},${parseInt(rgb[1].slice(4, 6), 16)},.82)` : 'rgba(255,255,255,.9)';
  const sync = () => {
    raf = 0;
    const passed = sheet.getBoundingClientRect().top <= (bar ? bar.offsetHeight : 80) * 0.7;
    document.body.classList.toggle('is-scrolled', window.scrollY > 12);
    document.body.style.setProperty('--bar-bg', passed ? 'rgba(255,255,255,.9)' : tint);
    document.body.dataset.tone = passed ? 'light' : tone;
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(sync); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  sync();

  // «до/после»
  root.querySelectorAll('.cmp').forEach((c) => {
    const input = c.querySelector('input');
    input.addEventListener('input', () => c.style.setProperty('--at', `${input.value}%`));
  });

  const ios = [];
  if ('IntersectionObserver' in window) {
    if (say) {
      const io = new IntersectionObserver((entries) => {
        for (const en of entries) if (en.isIntersecting) { io.unobserve(en.target); say(en.target.dataset.say); }
      }, { rootMargin: '-38% 0px -38% 0px' });
      root.querySelectorAll('[data-say]').forEach((el) => io.observe(el));
      ios.push(io);
    }
    const vids = root.querySelectorAll('video[data-loop]');
    if (vids.length) {
      const vio = new IntersectionObserver((entries) => {
        for (const en of entries) { if (en.isIntersecting) en.target.play().catch(() => {}); else en.target.pause(); }
      }, { threshold: 0.35 });
      vids.forEach((v) => vio.observe(v));
      ios.push(vio);
    }
  }

  return {
    title,
    destroy() {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
      ios.forEach((o) => o.disconnect());
      root.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch (_) { /* noop */ } });
      document.body.classList.remove('is-scrolled');
      document.body.style.removeProperty('--bar-bg');
    },
  };
}
