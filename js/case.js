// Страница кейса — как страница продукта Apple (Figma: блоки «Кейс / …» и макет «Кейс. Свои деньги»):
// обложка-карточка цвета проекта (логотип проекта, слоган, визуал выходит за край) → карточка фактов → итоги для того,
// кто читает 30 секунд → главы по одной мысли (блоки из админки) → теги, контакт и следующий проект.
// Блоки и их порядок задаются в content/projects.json (их правит админка). Каждая глава мягко всплывает при прокрутке.
import { content, tx, t, esc, srcOf, peekItems } from './content.js';
import { folderHTML } from './folders.js';
import { setTheme, themeOf, toneOf, softTextOk, inkOf } from './theme.js';
import { heroOf } from './catalog.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const color = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '').trim()) ? String(c).trim() : '');

const paras = (s) => String(tx(s) || '').split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)
  .map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
const h2 = (b) => (tx(b.title) ? `<h2 class="sec-title">${esc(tx(b.title))}</h2>` : '');
const cap = (b) => (tx(b.caption) ? `<figcaption>${esc(tx(b.caption))}</figcaption>` : '');
const pic = (src, alt, extra = '') => `<img src="${esc(src)}" alt="${esc(tx(alt) || '')}" loading="lazy" decoding="async"${extra}>`;
const isVideo = (src) => /\.(mp4|webm|mov)(\?|$)/i.test(String(src || ''));
// Плитка: картинка или короткое видео (играет само, без звука, по кругу — как анимации на страницах Apple)
const media = (src, alt, extra = '', { reduced } = {}) => (isVideo(src)
  ? `<video src="${esc(src)}" muted playsinline preload="metadata"${reduced ? '' : ' loop data-loop'}${tx(alt) ? ` aria-label="${esc(tx(alt))}"` : ' aria-hidden="true"'}></video>`
  : pic(src, alt, extra));
// Размеры картинки (их запоминает админка при загрузке): браузер заранее оставляет под неё место, и страница не прыгает
const sized = (o) => !!(o && typeof o === 'object' && o.w > 0 && o.h > 0);
const dims = (o) => (sized(o) ? ` width="${Math.round(o.w)}" height="${Math.round(o.h)}"` : '');
const tile = (bg) => (color(bg) ? ` style="--tile:${color(bg)}"` : '');
const widthOf = (b, def = 'wide') => (['text', 'wide', 'full'].includes(b.width) ? b.width : def);
const RING = '<svg class="metric-i" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28.5"/></svg>';
// Серая плашка — место под картинку, которой ещё нет (как в макете: «1 модель рынка с логотипами»). В содержимом у такой
// плитки есть поле ph — надпись внутри (может быть пустой). Появится картинка — плашка сама станет картинкой
const isPh = (it) => !!(it && typeof it === 'object' && !srcOf(it) && 'ph' in it);
const phLabel = (it) => (tx(it.ph) ? `<span class="tile-ph">${esc(tx(it.ph))}</span>` : '');

// Виды блоков. Новый вид = новая функция здесь + форма в админке (admin/admin.js, BLOCKS и BF).
const BLOCKS = {
  // Глава: заголовок + текст. По центру — короткий текст (Figma: «Заголовок раздела», по центру), слева — длинный
  text(b) {
    if (!tx(b.title) && !tx(b.text)) return '';
    const center = b.align === 'center' || (b.align !== 'left' && String(tx(b.text) || '').length <= 320 && !/\n\s*\n/.test(String(tx(b.text) || '')));
    return `<section class="blk blk-text${center ? ' is-center' : ''}">${h2(b)}${tx(b.text) ? `<div class="prose">${paras(b.text)}</div>` : ''}</section>`;
  },

  image(b, ctx) {
    const src = srcOf(b);
    if (!src && isPh(b)) return `<figure class="blk blk-image blk--${widthOf(b)} is-ph">${h2(b)}<div class="tile-box is-ph" aria-hidden="true">${phLabel(b)}</div>${cap(b)}</figure>`;
    if (!src) return '';
    const framed = !!(b.cut || color(b.bg));          // вырезанная картинка (без фона) кладётся на подложку
    const extra = dims(b) + (framed && sized(b) ? ` class="is-sized" style="--w:${Math.round(b.w)};--h:${Math.round(b.h)}"` : '');
    return `<figure class="blk blk-image blk--${widthOf(b)}${framed ? ' has-bg' : ''}"${tile(b.bg)}>${h2(b)}<div class="frame">${media(src, b.alt, extra, ctx)}</div>${cap(b)}</figure>`;
  },

  // Плитки: квадраты, телефоны (330×574) или карточки с подписью (287×363) — Figma: «Кейс / Плитка»
  gallery(b, ctx) {
    const items = (b.items || []).filter((it) => srcOf(it) || isPh(it));
    if (!items.length) return '';
    const shape = ['square', 'phone', 'card'].includes(b.shape) ? b.shape : '';
    const cols = clamp(Math.round(Number(b.columns)) || Math.min(shape === 'phone' ? 2 : 3, items.length), 1, 4);
    const cover = (it) => shape === 'phone' || shape === 'card' || (it.fit || b.fit) === 'cover';
    return `<section class="blk blk-tiles blk--${widthOf(b)}">${h2(b)}<div class="blk-gallery${shape ? ` shape-${shape}` : ''}" style="--cols:${cols}">${items.map((it) =>
      `<figure class="tile"><div class="tile-box${cover(it) ? ' is-cover' : ''}${isPh(it) ? ' is-ph' : ''}"${tile(it.bg || b.bg)}>${isPh(it) ? phLabel(it) : media(srcOf(it), it.alt, dims(it), ctx)}</div>${cap(it)}</figure>`).join('')}</div></section>`;
  },

  // Идея и лесенка (глава «Идея» в макете «Свои деньги»): текст сверху слева, три плитки растут вправо
  idea(b, ctx) {
    const items = (b.items || []).filter((it) => srcOf(it)).slice(0, 3);
    if (!tx(b.title) && !tx(b.text) && !items.length) return '';
    const steps = [0, 1, 2].map((i) => {
      const it = items[i];
      return `<figure class="idea-step"><div class="tile-box is-cover"${tile(b.bg)}>${it ? media(srcOf(it), it.alt, '', ctx) : ''}</div></figure>`;
    }).join('');
    return `<section class="blk blk-idea"><div class="idea-text">${h2(b)}${tx(b.text) ? `<div class="prose">${paras(b.text)}</div>` : ''}</div>${steps}</section>`;
  },

  // Картинка и текст: телефон (или квадрат) с одной стороны, глава — с другой
  split(b, ctx) {
    const src = srcOf(b);
    if (!src && !tx(b.title) && !tx(b.text)) return '';
    const shape = b.shape === 'square' ? 'square' : 'phone';
    return `<section class="blk blk-split side-${b.side === 'right' ? 'right' : 'left'}">
      <figure class="split-media shape-${shape}"><div class="tile-box is-cover"${tile(b.bg)}>${src ? media(src, b.alt, dims(b), ctx) : ''}</div></figure>
      <div class="split-text">${h2(b)}${tx(b.text) ? `<div class="prose">${paras(b.text)}</div>` : ''}</div>
    </section>`;
  },

  // Цифры: крупное число с подписью; нет числа (концепт, ещё не мерили) — кружок-иконка и что будем мерить
  metrics(b) {
    const items = (b.items || []).filter((m) => m && (tx(m.v) || tx(m.l)));
    if (!items.length) return '';
    const row = items.map((m) => `<div class="metric">${tx(m.v) ? `<p class="metric-v">${esc(tx(m.v))}</p>` : RING}<p class="metric-l">${esc(tx(m.l))}</p></div>`).join('');
    const n = Math.min(4, items.length);
    return tx(b.title)
      ? `<section class="blk blk-metrics has-title" style="--n:${n}">${h2(b)}<div class="metrics-row">${row}</div></section>`
      : `<section class="blk blk-metrics" style="--n:${n}">${row}</section>`;
  },

  // Финал главы со ссылками: Figma, прототип, живой продукт — маленькие кнопки контуром по центру
  links(b) {
    const links = (b.items || []).filter((l) => l && tx(l.label) && /^(https?:)?\/\//i.test(String(l.url || '').trim()));
    if (!tx(b.title) && !tx(b.text) && !links.length) return '';
    return `<section class="blk blk-links">${h2(b)}${tx(b.text) ? `<div class="prose">${paras(b.text)}</div>` : ''}${links.length ? `<div class="links-row">${links.map((l) =>
      `<a class="btn btn--line btn--sm" href="${esc(String(l.url).trim())}" target="_blank" rel="noopener">${esc(tx(l.label))}</a>`).join('')}</div>` : ''}</section>`;
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

  // Реплика головы — точка между блоками (админка → блок «Реплика головы»): на экране её не видно, доехали до неё —
  // голова в углу говорит текст. Сам текст — в поле say, как у реплики любого блока
  say(b) {
    return tx(b.say) ? '<div class="blk blk-say" aria-hidden="true"></div>' : '';
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
  // на первом теге блока — его номер (для предпросмотра в админке), реплика головы и метка «всплыть при прокрутке»
  return html.replace(/^<(\w+) class="/, `<$1 data-b="${i}" ${say ? `data-say="${esc(say)}" ` : ''}class="rv `);
}

const telegramUrl = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://t.me/${s.replace(/^@/, '').replace(/^t\.me\//i, '')}`;
};

// Визуал обложки: свой (админка → «Визуал обложки кейса»), иначе визуал из каталога, иначе обложка проекта
function coverVisual(p) {
  if (p.caseVisual === 'none') return null;                 // визуала нет — обложка только с логотипом и слоганом
  if (srcOf(p.caseVisual)) return { src: srcOf(p.caseVisual), video: isVideo(srcOf(p.caseVisual)) };
  const h = heroOf(p, 'desk');
  if (h.video) return { src: h.video, video: true, poster: h.poster };
  if (h.image) return { src: h.image, video: false };
  return p.cover ? { src: p.cover, video: false } : null;
}

// say(text) — голова произносит реплику к блоку, когда он доехал до середины экрана
export function renderCase(root, p, { reduced = false, say = null } = {}) {
  const list = content.projects;
  const next = list.length > 1 ? list[(list.indexOf(p) + 1) % list.length] : null;
  const title = tx(p.title);
  const theme = themeOf(p);
  const cc = (theme && theme.color) || '';
  const ctone = cc ? (theme.tone || toneOf(cc)) : 'light';
  const site = content.site;
  // факты — как в макете: роль, срок, заказчик (логотипом, если загружен), год; команда — если есть место
  const facts = [['role', tx(p.role)], ['duration', tx(p.duration)], ['client', tx(p.client), srcOf(p.clientLogo)], ['year', p.year], ['team', tx(p.team)]]
    .filter(([, v, img]) => v || img).slice(0, 4);
  const results = (p.metrics || []).filter((m) => m && (tx(m.v) || tx(m.l))).slice(0, 4);
  const tl = p.tldr || {};
  const tldr = [['task', tx(tl.task)], ['did', tx(tl.did)], ['result', tx(tl.result)]].filter(([, v]) => v);
  const tags = (p.tags || []).map(tx).filter(Boolean);
  const blocks = (p.blocks || []).map((b, i) => blockHTML(b, { reduced }, i)).filter(Boolean).join('');
  const mail = String(site.email || '').trim(), tg = telegramUrl(site.telegram), cv = tx(site.cv);
  const logo = srcOf(p.logo), vis = coverVisual(p);
  const lead = tx(p.tagline) || tx(p.summary);
  // подписи фактов — на 70%, но не бледнее 4,5:1 на цвете проекта (иначе целиком)
  const cardVars = cc ? `--cc:${esc(cc)};--cf:${ctone === 'dark' ? 'var(--ink-dark)' : 'var(--ink)'}${softTextOk(inkOf(ctone), cc) ? '' : ';--cfo:1'}` : '';
  const cardStyle = cardVars ? ` style="${cardVars}"` : '';

  root.innerHTML = `
    <header class="case-top">
      <div class="cover-card rv"${cardStyle}>
        <div class="cover-text">
          <h1 class="cover-title" tabindex="-1">${logo ? `<img class="cover-logo" src="${esc(logo)}" alt="${esc(title)}" decoding="async" fetchpriority="high">` : esc(title)}</h1>
          ${lead ? `<p class="cover-lead">${esc(lead)}</p>` : ''}
        </div>
        ${vis ? `<div class="cover-visual">${vis.video
    ? `<video src="${esc(vis.src)}" muted playsinline autoplay${vis.poster ? ` poster="${esc(vis.poster)}"` : ''} aria-hidden="true"></video>`
    : `<img src="${esc(vis.src)}" alt="" decoding="async" fetchpriority="high">`}</div>` : ''}
      </div>
      ${facts.length ? `<dl class="facts-card rv" style="--n:${facts.length}${cardVars ? `;${cardVars}` : ''}">${facts.map(([k, v, img]) =>
    `<div class="fact"><dt>${esc(t(k))}</dt><dd${!img && String(v).length > 14 ? ' class="is-long"' : ''}>${img ? `<img src="${esc(img)}" alt="${esc(v || t(k))}">` : esc(v)}</dd></div>`).join('')}</dl>` : ''}
    </header>
    <div class="case-in" data-sheet>
      ${results.length ? `<section class="case-results rv" style="--n:${results.length}" aria-label="${esc(t('results'))}">${results.map((m) => `<div><p class="result-v">${esc(tx(m.v))}</p><p class="result-l">${esc(tx(m.l))}</p></div>`).join('')}</section>` : ''}
      ${tldr.length ? `<section class="case-tldr rv" style="--n:${tldr.length}">${tldr.map(([k, v]) => `<div><h2>${esc(t(k))}</h2><p>${esc(v)}</p></div>`).join('')}</section>` : ''}
      ${blocks ? `<div class="case-blocks">${blocks}</div>` : ''}
      ${tags.length ? `<ul class="case-tags" aria-label="${esc(t('tags'))}">${tags.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <section class="case-end">
        <div class="vcard rv" data-vcard>
          <div class="vcard-head" data-vcard-slot><span class="vcard-ph" aria-hidden="true"></span></div>
          <div class="vcard-body">
            <div class="vcard-top">${mail || tg ? `<p class="vcard-kicker">${esc(t('talk'))}</p>` : ''}<div class="vcard-say" data-vcard-say aria-hidden="true"></div></div>
            <h2 class="vcard-name">${esc(tx(site.name))}</h2>
            ${tx(site.role) ? `<p class="vcard-role">${esc(tx(site.role))}</p>` : ''}
            <div class="vcard-acts">
              ${mail ? `<a class="btn" href="mailto:${esc(mail)}" data-contact="email">${esc(t('write'))}</a>` : ''}
              ${tg ? `<a class="btn${mail ? ' btn--line' : ''}" href="${esc(tg)}" target="_blank" rel="noopener" data-contact="telegram">${esc(t('telegram'))}</a>` : ''}
              ${cv ? `<a class="btn btn--line" data-cv href="${esc(cv)}" download>${esc(t('downloadCv'))}</a>` : ''}
            </div>
            ${mail || tg ? `<p class="vcard-links">${[mail ? `<a href="mailto:${esc(mail)}" data-contact="email">${esc(mail)}</a>` : '', tg ? `<a href="${esc(tg)}" target="_blank" rel="noopener" data-contact="telegram">${esc(String(site.telegram || '').trim().replace(/^https?:\/\/t\.me\//i, '@'))}</a>` : ''].filter(Boolean).join('<span aria-hidden="true"> · </span>')}</p>` : ''}
          </div>
        </div>
        ${next ? `<div class="case-next">${folderHTML({
    href: `#/work/${encodeURIComponent(next.slug)}`, title: tx(next.title), pill: t('next'),
    items: peekItems(next), stickers: [next.sticker], tint: next.folder, cls: 'gf--project gf--auto' })}</div>` : ''}
      </section>
    </div>`;

  // фон страницы — светлый лист; цвет проекта — только у обложки и фактов. Полоса браузера — тоже светлая
  setTheme(null);

  const bar = document.querySelector('[data-topbar]');
  let raf = 0;
  const sync = () => {
    raf = 0;
    document.body.classList.toggle('is-scrolled', window.scrollY > 12);
    document.body.style.setProperty('--bar-bg', 'color-mix(in srgb, var(--paper) 88%, transparent)');
    if (bar) document.body.dataset.tone = 'light';
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
    // главы всплывают, когда доезжают до экрана — один раз (при «меньше движения» стоят сразу)
    if (!reduced) {
      document.documentElement.classList.add('js-rv');
      const rio = new IntersectionObserver((entries) => {
        for (const en of entries) if (en.isIntersecting) { rio.unobserve(en.target); en.target.classList.add('is-in'); }
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.01 });
      root.querySelectorAll('.rv').forEach((el) => rio.observe(el));
      ios.push(rio);
    }
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
  } else root.querySelectorAll('.rv').forEach((el) => el.classList.add('is-in'));

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
