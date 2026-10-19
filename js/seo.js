// Поиск: адреса страниц, заголовки и описания, разметка для поисковиков (JSON-LD), текст страниц обычным HTML и карта сайта.
//
// Сайт рисуется скриптом, а Яндекс исполняет скрипты не всегда. Поэтому у главной, каталога, каждого кейса, архива и
// страницы «нет такой страницы» есть свой файл — копия index.html (work/index.html, work/<адрес>/index.html, 404.html…):
//   • между <!--seo:head--> и <!--/seo:head--> — заголовок, описание, canonical, карточка для соцсетей и разметка;
//   • между <!--seo:body--> и <!--/seo:body--> — текст страницы обычным HTML. Его читают поисковики и посетители без
//     JavaScript; сайт этот блок сразу убирает и рисует страницу как обычно (стили — .seo-static в css/style.css).
// Файлы собирает админка при каждой публикации, а с компьютера — node tools/prerender.mjs (после правок index.html).
// Этот же модуль сайт берёт при переходах между экранами: заголовок вкладки, описание и canonical — те же, что в файле.
//
// Модуль без DOM: работает и в браузере, и в Node.
import { UI } from './i18n.js';

export const ORIGIN = 'https://pnemchenko.ru';      // адрес сайта по умолчанию; при сборке — из файла CNAME

// Адреса экранов
export const paths = {
  home: '/',
  work: '/work/',
  archive: '/archive/',
  case: (slug) => `/work/${encodeURIComponent(slug)}/`,
  cat: (id) => (id && id !== 'all' ? `/work/?cat=${encodeURIComponent(id)}` : '/work/'),
};
// адрес проекта годится в имя папки на сайте: латиница, цифры и дефисы (админка такие и делает)
export const okSlug = (s) => /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/i.test(String(s || ''));
// адрес сайта из строки файла CNAME (там — домен без https://)
export const originOf = (cname) => {
  const host = String(cname || '').trim().split(/\s+/)[0].replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host.toLowerCase()}` : ORIGIN;
};

// Фразы, которых нет в интерфейсе сайта (js/i18n.js)
const WORDS = {
  ru: {
    portfolio: 'портфолио', works: 'Кейсы и проекты', other: 'Другие работы', contacts: 'Контакты', email: 'Почта',
    cv: 'Резюме (PDF)', crumbs: 'Вы здесь', more: 'Смотреть кейс', notFound: 'Страница не найдена',
    notFoundText: 'Такой страницы на сайте нет — возможно, у неё поменялся адрес.', archiveText: 'Снимки гостей сайта с 3D-головой: подписи и наклейки оставляют сами гости.',
    misc: 'Другое',
  },
  en: {
    portfolio: 'portfolio', works: 'Case studies and projects', other: 'Other work', contacts: 'Contacts', email: 'Email',
    cv: 'CV (PDF)', crumbs: 'You are here', more: 'View case study', notFound: 'Page not found',
    notFoundText: 'There is no such page — perhaps its address has changed.', archiveText: 'Polaroids of the site’s guests with the 3D head: captions and stickers are theirs.',
    misc: 'Other',
  },
};

// ---------- мелочи ----------
const pick = (v, lang) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return String(v[lang] || v.ru || Object.values(v).find(Boolean) || '');
  return v == null ? '' : String(v);
};
const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();       // в одну строку
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const srcOf = (a) => String((typeof a === 'string' ? a : (a && a.src)) || '').trim();
const isVideo = (src) => /\.(mp4|webm|mov)(\?|$)/i.test(src);
const up = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const dot = (s) => (!s || /[.!?…]$/.test(s) ? s : `${s}.`);
// обрезать по слову, не длиннее n знаков
function clip(s, n) {
  s = one(s);
  if (s.length <= n) return s;
  const t = s.slice(0, n - 1), i = t.lastIndexOf(' ');
  return `${(i > n * 0.6 ? t.slice(0, i) : t).replace(/[\s,.;:—–-]+$/, '')}…`;
}
const uniq = (list) => [...new Set(list.map(one).filter(Boolean))];
// путь к файлу сайта → от корня (/assets/…); полный адрес — как есть; blob: и data: из предпросмотра — не годятся
function rel(src) {
  const s = srcOf(src);
  if (!s || /^(blob:|data:|javascript:)/i.test(s)) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) return s;
  return `/${s.replace(/^\.\//, '')}`;
}
const abs = (origin, src) => { const r = rel(src); return !r || /^https?:/i.test(r) ? r : origin + r; };
const telegramUrl = (v) => {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://t.me/${s.replace(/^@/, '').replace(/^t\.me\//i, '')}`;
};
const ui = (lang, k) => (UI[lang] && UI[lang][k]) || UI.ru[k] || k;
const W = (lang) => WORDS[lang] || WORDS.ru;

// Профили на других сайтах (site.profiles — ссылки): подпись по адресу
const KNOWN = [[/(^|\.)behance\.net$/, 'Behance'], [/(^|\.)dribbble\.com$/, 'Dribbble'], [/(^|\.)hh\.ru$/, 'hh.ru'], [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/^career\.habr\.com$/, 'Хабр Карьера'], [/(^|\.)habr\.com$/, 'Хабр'], [/(^|\.)vc\.ru$/, 'vc.ru'], [/(^|\.)dprofile\.ru$/, 'Dprofile'],
  [/(^|\.)github\.com$/, 'GitHub'], [/^t\.me$/, 'Telegram'], [/(^|\.)vk\.(com|ru)$/, 'ВКонтакте'], [/(^|\.)tenchat\.ru$/, 'TenChat'],
  [/(^|\.)figma\.com$/, 'Figma'], [/(^|\.)youtube\.com$/, 'YouTube'], [/(^|\.)pinterest\./, 'Pinterest'], [/(^|\.)artstation\.com$/, 'ArtStation']];
export function profilesOf(site) {
  const list = Array.isArray(site.profiles) ? site.profiles : String(site.profiles || '').split(/[\s,]+/);
  const out = [];
  for (const raw of list) {
    const url = String((raw && raw.url) || raw || '').trim();
    let u;
    try { u = new URL(url); } catch (_) { continue; }
    if (u.protocol !== 'https:') continue;
    const host = u.hostname.replace(/^www\./, '');
    const k = KNOWN.find(([re]) => re.test(host));
    if (!out.some((x) => x.url === u.href)) out.push({ url: u.href, label: (raw && raw.label) || (k ? k[1] : host) });
  }
  return out;
}

// Как зовут: подпись сайта («Паша Немченко»), полное имя для поиска («Павел Немченко») и роль
export function who(site, lang = 'ru') {
  const short = one(pick(site.name, lang));
  const full = one(pick(site.fullName, lang)) || short;
  return { short, full, role: one(pick(site.role, lang)) };
}
// Текст «о себе» для главной: свой (админка → «Профиль» → «Поиск») или из имени, роли и описания
export function aboutText(site, lang = 'ru') {
  const own = String(pick(site.about, lang) || '').trim();
  if (own) return own;
  const { full, role } = who(site, lang);
  return [dot(role ? `${full} — ${role}` : full), dot(one(pick(site.description, lang)))].filter(Boolean).join(' ');
}
// Опубликованные проекты, у которых адрес годится для страницы
export const listed = (projects) => (projects || []).filter((p) => p && okSlug(p.slug) && p.published !== false);

// ---------- заголовки и описания ----------
// page: { kind: 'home' | 'work' | 'case' | 'archive' | '404', project }
export function pageMeta(site, projects, page, { origin = ORIGIN, lang = 'ru' } = {}) {
  const { full, short, role } = who(site, lang);
  const w = W(lang), sign = role ? `${full}, ${role}` : full;
  const desc = one(pick(site.description, lang));
  const og = { image: abs(origin, pick(site.ogImage, lang)) || `${origin}/assets/og.jpg`, imageW: site.ogImage ? 0 : 1200, imageH: site.ogImage ? 0 : 630 };
  const list = listed(projects);
  let m;
  if (page.kind === 'case' && page.project) {
    const p = page.project, title = one(pick(p.title, lang));
    const facts = [[ui(lang, 'role'), one(pick(p.role, lang))], [ui(lang, 'client'), one(pick(p.client, lang))]]
      .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).concat(p.year ? [String(p.year)] : []).join('. ');
    const lead = one(pick(p.summary, lang)) || one(pick(p.tagline, lang));
    const img = abs(origin, p.ogImage) || abs(origin, p.cover) || abs(origin, p.thumb);
    m = {
      title: one(pick(p.seoTitle, lang)) || `${title} — ${full}`,
      description: one(pick(p.seoDescription, lang)) || clip([dot(lead), dot(facts)].filter(Boolean).join(' '), 170),
      path: paths.case(p.slug), type: 'article', index: p.published !== false,
      ...(img ? { image: img, imageW: 0, imageH: 0 } : og),
    };
  } else if (page.kind === 'work') {
    const names = list.map((p) => one(pick(p.title, lang))).filter(Boolean);
    m = {
      title: `${w.works} — ${sign}`,
      description: clip(`${w.works}: ${names.join(', ')}.`, 170),
      path: paths.work, type: 'website', index: true, ...og,
    };
  } else if (page.kind === 'archive') {
    m = { title: `${ui(lang, 'archive')} — ${full}`, description: w.archiveText, path: paths.archive, type: 'website', index: false, ...og };
  } else if (page.kind === '404') {
    m = { title: `${w.notFound} — ${full}`, description: w.notFoundText, path: '', type: 'website', index: false, ...og };
  } else {
    m = {
      title: one(pick(site.seoTitle, lang)) || (role ? `${full} — ${role}, ${w.portfolio}` : `${full} — ${w.portfolio}`),
      description: desc || clip(aboutText(site, lang), 170),
      path: paths.home, type: 'website', index: true, ...og,
    };
  }
  m.url = m.path ? origin + m.path : '';
  m.robots = m.index ? 'index, follow, max-image-preview:large' : 'noindex, follow';
  m.siteName = full;
  m.alt = short;
  m.locale = lang === 'en' ? 'en_US' : 'ru_RU';
  return m;
}

// ---------- разметка для поисковиков (schema.org, JSON-LD) ----------
export function ldGraph(site, projects, page, m, { origin = ORIGIN, lang = 'ru' } = {}) {
  const { full, short, role } = who(site, lang);
  const list = listed(projects), home = `${origin}/`;
  const ids = { person: `${origin}/#person`, site: `${origin}/#website` };
  const person = {
    '@type': 'Person', '@id': ids.person, name: full,
    alternateName: uniq([short, pick(site.fullName, 'en'), pick(site.name, 'en')]).filter((x) => x !== full),
    url: home,
  };
  if (role) person.jobTitle = up(role);
  const mail = one(site.email), tg = telegramUrl(site.telegram);
  if (mail) person.email = `mailto:${mail}`;
  const photo = abs(origin, site.photo);
  if (photo) person.image = photo;
  const same = uniq([tg, ...profilesOf(site).map((x) => x.url)]);
  if (same.length) person.sameAs = same;
  const topics = (site.sections || []).map((s) => one(pick(s.label, lang))).filter(Boolean);
  if (topics.length) person.knowsAbout = topics;
  const website = { '@type': 'WebSite', '@id': ids.site, url: home, name: full, alternateName: uniq([short, home.replace(/^https:\/\/|\/$/g, '')]).filter((x) => x !== full), inLanguage: lang, publisher: { '@id': ids.person } };
  const crumbs = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })) });
  const graph = [website, person];
  if (page.kind === 'home') {
    graph.push({ '@type': 'ProfilePage', '@id': `${home}#profile`, url: home, name: m.title, description: m.description, inLanguage: lang, isPartOf: { '@id': ids.site }, mainEntity: { '@id': ids.person } });
  } else if (page.kind === 'work') {
    graph.push({
      '@type': 'CollectionPage', '@id': `${m.url}#page`, url: m.url, name: m.title, description: m.description, inLanguage: lang, isPartOf: { '@id': ids.site }, about: { '@id': ids.person },
      mainEntity: { '@type': 'ItemList', itemListElement: list.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: origin + paths.case(p.slug), name: one(pick(p.title, lang)) })) },
    }, crumbs([[full, home], [ui(lang, 'work'), m.url]]));
  } else if (page.kind === 'case' && page.project) {
    const p = page.project, title = one(pick(p.title, lang));
    const work = {
      '@type': 'CreativeWork', '@id': `${m.url}#work`, url: m.url, name: title, headline: title, description: m.description, inLanguage: lang,
      creator: { '@id': ids.person }, author: { '@id': ids.person }, isPartOf: { '@id': ids.site }, mainEntityOfPage: m.url,
    };
    if (m.image) work.image = m.image;
    if (/^\d{4}$/.test(String(p.year || ''))) work.dateCreated = String(p.year);
    const tags = (p.tags || []).map((x) => one(pick(x, lang))).filter(Boolean);
    if (tags.length) work.keywords = tags.join(', ');
    const client = one(pick(p.client, lang));
    if (client) work.sourceOrganization = { '@type': 'Organization', name: client };
    graph.push(work, crumbs([[full, home], [ui(lang, 'work'), origin + paths.work], [title, m.url]]));
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}
// JSON внутри <script>: «</script>» и «<!--» в тексте не должны закрыть блок
const ldJSON = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

// ---------- <head> ----------
const okCode = (s) => /^[\w-]{6,120}$/.test(String(s || '').trim());
export function headHTML(m, site, ld, { home = false } = {}) {
  const v = (site && site.verify) || {};
  const L = [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}">`,
    m.url ? `<link rel="canonical" href="${esc(m.url)}">` : '',
    `<meta name="robots" content="${m.robots}">`,
    `<meta property="og:type" content="${m.type === 'article' ? 'article' : 'website'}">`,
    `<meta property="og:site_name" content="${esc(m.siteName)}">`,
    `<meta property="og:locale" content="${m.locale}">`,
    m.url ? `<meta property="og:url" content="${esc(m.url)}">` : '',
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`,
    m.image ? `<meta property="og:image" content="${esc(m.image)}">` : '',
    m.image && m.imageW ? `<meta property="og:image:width" content="${m.imageW}">` : '',
    m.image && m.imageH ? `<meta property="og:image:height" content="${m.imageH}">` : '',
    '<meta name="twitter:card" content="summary_large_image">',
    // коды подтверждения Яндекс Вебмастера и Google Search Console — только на главной: там их и проверяют
    home && okCode(v.yandex) ? `<meta name="yandex-verification" content="${esc(String(v.yandex).trim())}">` : '',
    home && okCode(v.google) ? `<meta name="google-site-verification" content="${esc(String(v.google).trim())}">` : '',
    ld ? `<script type="application/ld+json">${ldJSON(ld)}</script>` : '',
  ].filter(Boolean);
  return L.join('\n');
}

// ---------- текст страницы обычным HTML ----------
const paras = (s) => String(s || '').split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
const dims = (o) => (o && typeof o === 'object' && o.w > 0 && o.h > 0 ? ` width="${Math.round(o.w)}" height="${Math.round(o.h)}"` : '');
function imgHTML(it, alt = '') {
  const src = rel(it);
  if (!src || isVideo(src)) return '';
  return `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async"${dims(it)}>`;
}
function figHTML(it, lang, fallbackAlt = '') {
  const cap = one(pick(it && it.caption, lang)), img = imgHTML(it, one(pick(it && it.alt, lang)) || fallbackAlt);
  if (!img) return cap ? `<p>${esc(cap)}</p>` : '';          // картинки ещё нет (серая плашка), а подпись есть — подпись текстом
  return `<figure>${img}${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}</figure>`;
}
// Блок кейса (виды — как в js/case.js) → простой HTML: заголовки, абзацы, картинки с описаниями, ссылки
function blockText(b, lang) {
  if (!b || typeof b !== 'object') return '';
  const T = (v) => one(pick(v, lang)), P = (v) => paras(pick(v, lang));
  const h = T(b.title) ? `<h2>${esc(T(b.title))}</h2>` : '';
  const wrap = (inner) => (inner ? `<section>${h}${inner}</section>` : (h ? `<section>${h}</section>` : ''));
  switch (b.type) {
    case 'text': return wrap(P(b.text));
    case 'image': return wrap(figHTML(b, lang));
    case 'gallery': return wrap((b.items || []).map((it) => figHTML(it, lang)).join(''));
    case 'idea': return wrap(P(b.text) + (b.items || []).slice(0, 3).map((it) => figHTML(it, lang)).join(''));
    case 'split': return wrap(P(b.text) + figHTML(b, lang));
    case 'metrics': {
      const items = (b.items || []).filter((x) => x && (T(x.v) || T(x.l)));
      return items.length ? wrap(`<ul>${items.map((x) => `<li>${T(x.v) ? `<strong>${esc(T(x.v))}</strong> ` : ''}${esc(T(x.l))}</li>`).join('')}</ul>`) : '';
    }
    case 'links': {
      const links = (b.items || []).filter((l) => l && T(l.label) && /^https?:\/\//i.test(String(l.url || '').trim()));
      return wrap(P(b.text) + (links.length ? `<ul>${links.map((l) => `<li><a href="${esc(String(l.url).trim())}" rel="noopener">${esc(T(l.label))}</a></li>`).join('')}</ul>` : ''));
    }
    case 'quote': {
      if (!T(b.text)) return '';
      const by = [T(b.author), T(b.role)].filter(Boolean).join(', ');
      return `<figure><blockquote>${P(b.text)}</blockquote>${by ? `<figcaption>${esc(by)}</figcaption>` : ''}</figure>`;
    }
    case 'steps': {
      const items = (b.items || []).filter((s) => s && (T(s.title) || T(s.text)));
      return items.length ? wrap(`<ol>${items.map((s) => `<li>${T(s.title) ? `<h3>${esc(T(s.title))}</h3>` : ''}${T(s.text) ? `<p>${esc(T(s.text))}</p>` : ''}</li>`).join('')}</ol>`) : '';
    }
    case 'compare': return wrap([b.before, b.after].map((it) => figHTML(it, lang)).join(''));
    case 'video': return T(b.caption) ? wrap(`<p>${esc(T(b.caption))}</p>`) : '';
    case 'palette': {
      const cs = (b.colors || []).filter((c) => c && /^#[0-9a-f]{3,8}$/i.test(String(c.hex || '').trim()));
      return cs.length ? wrap(`<ul>${cs.map((c) => `<li>${esc(T(c.name) || '')} ${esc(String(c.hex).trim().toUpperCase())}</li>`).join('')}</ul>`) : '';
    }
    default: return '';
  }
}
// сколько слов в тексте кейса (для подсказки в админке: поиску нужно от 300)
export function caseWords(p, lang = 'ru') {
  const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[#\w]+;/g, ' ');
  const text = [pick(p.title, lang), pick(p.summary, lang), pick(p.tagline, lang), ...Object.values(p.tldr || {}).map((v) => pick(v, lang)),
    ...(p.blocks || []).map((b) => strip(blockText(b, lang)))].join(' ');
  return (text.match(/[\p{L}\d][\p{L}\d’'-]*/gu) || []).length;
}

const li = (s) => `<li>${s}</li>`;
function contactsHTML(site, lang) {
  const w = W(lang), mail = one(site.email), tg = telegramUrl(site.telegram), cv = rel(pick(site.cv, lang));
  const items = [];
  if (mail) items.push(`${w.email}: <a href="mailto:${esc(mail)}">${esc(mail)}</a>`);
  if (tg) items.push(`Telegram: <a href="${esc(tg)}" rel="me">${esc(String(site.telegram || '').trim().replace(/^https?:\/\/t\.me\//i, '@'))}</a>`);
  if (cv) items.push(`<a href="${esc(cv)}">${esc(w.cv)}</a>`);
  for (const pr of profilesOf(site)) items.push(`<a href="${esc(pr.url)}" rel="me">${esc(pr.label)}</a>`);
  return items.length ? `<h2>${esc(w.contacts)}</h2><ul>${items.map(li).join('')}</ul>` : '';
}
// проекты по разделам каталога (как папки на главной); проекты без раздела — в конце
function bySection(site, list, lang) {
  const out = [];
  for (const s of site.sections || []) {
    const ps = list.filter((p) => p.section === s.id);
    if (ps.length) out.push([one(pick(s.label, lang)), ps]);
  }
  const rest = list.filter((p) => !(site.sections || []).some((s) => s.id === p.section));
  if (rest.length) out.push([W(lang).misc, rest]);
  return out;
}
function projectFacts(p, lang) {
  return [one(pick(p.client, lang)), p.year ? String(p.year) : '', ...(p.tags || []).map((x) => one(pick(x, lang)))].filter(Boolean).join(' · ');
}
// ссылка с названием проекта и короткое описание
const projectLink = (p, lang) => `<a href="${esc(paths.case(p.slug))}">${esc(one(pick(p.title, lang)))}</a>`;

export function bodyHTML(site, projects, page, m, { lang = 'ru' } = {}) {
  const { full } = who(site, lang), w = W(lang), list = listed(projects);
  const T = (v) => one(pick(v, lang));
  let html = '';
  if (page.kind === 'case' && page.project) {
    const p = page.project, title = T(p.title);
    const facts = [['role', T(p.role)], ['client', T(p.client)], ['year', p.year ? String(p.year) : ''], ['duration', T(p.duration)], ['team', T(p.team)]].filter(([, v]) => v);
    const tl = p.tldr || {}, tldr = [['task', T(tl.task)], ['did', T(tl.did)], ['result', T(tl.result)]].filter(([, v]) => v);
    const metrics = (p.metrics || []).filter((x) => x && (T(x.v) || T(x.l)));
    const tags = (p.tags || []).map(T).filter(Boolean);
    const cover = srcOf(p.cover) ? imgHTML(p.cover, title) : '';
    const others = list.filter((x) => x !== p && x.slug !== p.slug);
    html = `<nav aria-label="${esc(w.crumbs)}"><a href="/">${esc(full)}</a> / <a href="${paths.work}">${esc(ui(lang, 'work'))}</a> / ${esc(title)}</nav>
<article>
<h1>${esc(title)}</h1>
${T(p.tagline) ? `<p>${esc(T(p.tagline))}</p>` : ''}${T(p.summary) && T(p.summary) !== T(p.tagline) ? `<p>${esc(T(p.summary))}</p>` : ''}
${cover ? `<figure>${cover}</figure>` : ''}
${facts.length ? `<dl>${facts.map(([k, v]) => `<dt>${esc(ui(lang, k))}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
${tldr.map(([k, v]) => `<section><h2>${esc(ui(lang, k))}</h2><p>${esc(v)}</p></section>`).join('')}
${metrics.length ? `<section><h2>${esc(ui(lang, 'results'))}</h2><ul>${metrics.map((x) => `<li>${T(x.v) ? `<strong>${esc(T(x.v))}</strong> ` : ''}${esc(T(x.l))}</li>`).join('')}</ul></section>` : ''}
${(p.blocks || []).map((b) => blockText(b, lang)).filter(Boolean).join('\n')}
${tags.length ? `<p>${esc(ui(lang, 'tags'))}: ${esc(tags.join(', '))}</p>` : ''}
</article>
${others.length ? `<h2>${esc(w.other)}</h2><ul>${others.map((x) => li(`${projectLink(x, lang)}${T(x.summary) ? ` — ${esc(T(x.summary))}` : ''}`)).join('')}</ul>` : ''}
${contactsHTML(site, lang)}`;
  } else if (page.kind === 'work') {
    html = `<nav aria-label="${esc(w.crumbs)}"><a href="/">${esc(full)}</a> / ${esc(ui(lang, 'work'))}</nav>
<h1>${esc(w.works)}</h1>
${paras(aboutText(site, lang))}
${bySection(site, list, lang).map(([label, ps]) => `<section><h2>${esc(label)}</h2>${ps.map((p) => `<article><h3>${projectLink(p, lang)}</h3>${T(p.summary) ? `<p>${esc(T(p.summary))}</p>` : ''}${projectFacts(p, lang) ? `<p>${esc(projectFacts(p, lang))}</p>` : ''}</article>`).join('')}</section>`).join('\n')}
${contactsHTML(site, lang)}`;
  } else if (page.kind === 'archive') {
    html = `<nav aria-label="${esc(w.crumbs)}"><a href="/">${esc(full)}</a> / ${esc(ui(lang, 'archive'))}</nav>
<h1>${esc(ui(lang, 'archive'))}</h1>
<p>${esc(w.archiveText)}</p>
<p><a href="/">${esc(full)}</a> · <a href="${paths.work}">${esc(ui(lang, 'allWork'))}</a></p>`;
  } else if (page.kind === '404') {
    html = `<h1>${esc(w.notFound)}</h1>
<p>${esc(w.notFoundText)}</p>
<p><a href="/">${esc(full)}</a> · <a href="${paths.work}">${esc(ui(lang, 'allWork'))}</a></p>
${list.length ? `<ul>${list.map((p) => li(projectLink(p, lang))).join('')}</ul>` : ''}`;
  } else {
    // главная: заголовок h1 уже есть в самой странице (index.html, раздел hero)
    html = `${paras(aboutText(site, lang))}
${bySection(site, list, lang).map(([label, ps]) => `<h2>${esc(label)}</h2><ul>${ps.map((p) => li(`${projectLink(p, lang)}${T(p.summary) ? ` — ${esc(T(p.summary))}` : ''}`)).join('')}</ul>`).join('\n')}
<p><a href="${paths.work}">${esc(ui(lang, 'allWork'))}</a></p>
${contactsHTML(site, lang)}`;
  }
  return `<div class="seo-static" data-seo-static>\n${html}\n</div>`;
}

// ---------- сборка страниц ----------
const MARK = { head: ['<!--seo:head-->', '<!--/seo:head-->'], body: ['<!--seo:body-->', '<!--/seo:body-->'] };
export const hasMarks = (html) => Object.values(MARK).every(([a, b]) => { const i = html.indexOf(a); return i >= 0 && html.indexOf(b, i) > i; });
// заменить то, что между метками; отступ — как у самой метки
function between(html, [a, b], inner) {
  const i = html.indexOf(a), j = html.indexOf(b, i);
  const pad = (/^[ \t]*$/.exec(html.slice(html.lastIndexOf('\n', i) + 1, i)) || [''])[0];
  const body = String(inner).split('\n').map((s) => s.trim()).filter(Boolean).map((s) => pad + s).join('\n');
  return `${html.slice(0, i + a.length)}\n${body}\n${pad}${html.slice(j)}`;
}
// главный экран (голова и папки) в файлах других страниц скрыт: его заголовок h1 не спорит с заголовком страницы
function heroHidden(html, hidden) {
  return html.replace(/<section\b[^>]*\bdata-screen="hero"[^>]*>/, (tag) => {
    const bare = tag.replace(/\shidden(?=[\s>])/, '');
    return hidden ? bare.replace(/>$/, ' hidden>') : bare;
  });
}
export function renderPage(template, site, projects, page, { origin = ORIGIN, lang = 'ru' } = {}) {
  const m = pageMeta(site, projects, page, { origin, lang });
  const ld = page.kind === '404' || page.kind === 'archive' ? null : ldGraph(site, projects, page, m, { origin, lang });
  let html = between(template, MARK.head, headHTML(m, site, ld, { home: page.kind === 'home' }));
  html = between(html, MARK.body, bodyHTML(site, projects, page, m, { lang }));
  return { html: heroHidden(html, page.kind !== 'home'), meta: m };
}
// Все страницы: [{ path: 'work/svoi-dengi/index.html', url, index, text }]. Шаблон — index.html с метками seo.
export function buildPages({ template, site, projects, origin = ORIGIN, lang } = {}) {
  if (!hasMarks(template)) throw new Error('В index.html нет меток <!--seo:head--> и <!--seo:body--> — страницы для поиска не собрать');
  lang = lang || site.defaultLang || 'ru';
  const list = listed(projects);
  const pages = [
    { path: 'index.html', page: { kind: 'home' } },
    { path: 'work/index.html', page: { kind: 'work' } },
    ...list.map((p) => ({ path: `work/${p.slug}/index.html`, page: { kind: 'case', project: p } })),
    { path: '404.html', page: { kind: '404' } },
  ];
  if (site.polaroidOn === true) pages.push({ path: 'archive/index.html', page: { kind: 'archive' } });
  return pages.map(({ path, page }) => {
    const { html, meta } = renderPage(template, site, list, page, { origin, lang });
    return { path, url: meta.url, index: meta.index, text: html };
  });
}
// Файлы прежних сборок, которых в новой нет (кейс удалили или сняли с сайта, архив выключили): их убираем
export const isPageFile = (path) => /^work\/[^/]+\/index\.html$/.test(path) || path === 'archive/index.html';

// ---------- карта сайта ----------
export function sitemapXML(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(({ loc, lastmod }) =>
    `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${esc(lastmod)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}
// прежняя карта сайта: адрес → дата изменения
export function readSitemap(xml) {
  const out = new Map();
  for (const m of String(xml || '').matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)) out.set(m[1].replace(/&amp;/g, '&'), m[2] || '');
  return out;
}
// Карта сайта из собранных страниц: дата у страницы меняется, только когда изменился её файл (changed(path) → true)
export function sitemapFor(pages, prev, changed, today = new Date().toISOString().slice(0, 10)) {
  return sitemapXML(pages.filter((p) => p.index && p.url).map((p) => ({ loc: p.url, lastmod: !changed(p.path) && prev.get(p.url) ? prev.get(p.url) : today })));
}
