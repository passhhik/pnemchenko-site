// Контент сайта лежит в content/site.json и content/projects.json — их редактирует админка (admin/).
// Любое текстовое поле может быть строкой или объектом { ru: '…', en: '…' }.
import { UI, plural, detectLang } from './i18n.js';

export const content = { site: null, projects: [], lang: 'ru', preview: false };

// «Столбик» — раскладка для телефона и планшета в портретной ориентации. То же условие — в css/style.css.
const STACK = window.matchMedia('(max-width:760px), (max-width:1024px) and (max-aspect-ratio:17/20)');
export const isStack = () => STACK.matches;

const params = new URLSearchParams(location.search);
content.preview = params.has('preview');

// пустой перевод — то же, что его отсутствие: показываем текст на основном языке
const pick = (v, lang, def) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v[lang] || v[def] || Object.values(v).find(Boolean) || '';
  return v ?? '';
};
// текст контента на текущем языке
export const tx = (v) => pick(v, content.lang, (content.site && content.site.defaultLang) || 'ru');
// строка интерфейса
export function t(key, vars) {
  const s = (UI[content.lang] && UI[content.lang][key]) ?? UI.ru[key] ?? key;
  return vars && typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;
}
export const count = (n, key) => `${n} ${plural(n, t(key), content.lang)}`;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// работа проекта: путь к картинке или { src, alt, cut }
export const srcOf = (a) => (typeof a === 'string' ? a : (a && a.src)) || '';

function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem('ph:draft') || 'null');
    return d && d.site && Array.isArray(d.projects) ? d : null;
  } catch (_) { return null; }
}

function apply(site, projects) {
  content.site = site;
  content.projects = (projects || []).filter((p) => p && p.slug && (content.preview || p.published !== false));
  content.lang = detectLang(site);
  document.documentElement.lang = content.lang;
}

export async function loadContent() {
  const draft = content.preview ? readDraft() : null;
  if (draft) { apply(draft.site, draft.projects); return content; }
  const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
  const [site, data] = await Promise.all([get('content/site.json'), get('content/projects.json')]);
  apply(site, data.projects);
  return content;
}

// админка прислала новый черновик — перечитываем без перезагрузки страницы
export function reloadDraft() {
  const draft = readDraft();
  if (draft) apply(draft.site, draft.projects);
  return !!draft;
}

// Обложка для мелкого показа (папки, «разлёт» работ, размытый фон): малая копия, которую делает админка; нет её — сама обложка
export const thumbOf = (p) => (p && (p.thumb || p.cover)) || '';

// Что выглядывает из папки проекта: то, что задано в поле peek, иначе — цельные картинки, обложка и вырезанные (в таком порядке)
export function peekItems(p) {
  if (Array.isArray(p.peek) && p.peek.some((a) => srcOf(a))) return p.peek.filter((a) => srcOf(a)).slice(0, 3);
  const arts = (p.artifacts || []).filter((a) => srcOf(a));
  const cut = (a) => !!(a && typeof a === 'object' && a.cut);
  return [...arts.filter((a) => !cut(a)), ...(thumbOf(p) ? [thumbOf(p)] : []), ...arts.filter(cut)].slice(0, 3);
}

// Папки разделов на главной: на компьютере они стоят вокруг головы, на телефоне главный экран чистый — логотип,
// голова, реплика и кнопки. Меняется в админке («Настройки сайта» → «Папки разделов на главной»);
// в содержимом это site.heroFolders: нет значения — «только на компьютере», 'all' — везде, 'none' — нигде.
export function heroFolders() {
  const v = content.site && content.site.heroFolders;
  if (v === 'all') return true;
  if (v === 'none') return false;
  return !isStack();
}

export const sectionById = (id) => (content.site.sections || []).find((s) => s.id === id) || null;
export const projectsOf = (id) => content.projects.filter((p) => id === 'all' || p.section === id);
