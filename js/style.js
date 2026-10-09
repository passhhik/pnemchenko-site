// Дизайн-токены сайта: цвета, насыщенность и размеры шрифтов, скругления.
// Значения по умолчанию записаны прямо в css/style.css (в :root) — сайт выглядит так, даже если токены не заданы.
// Свои значения Павел выставляет в админке («Настройки сайта» → «Стиль»); в содержимом они лежат в site.style
// и только поверх умолчаний: совпало с умолчанием — не хранится.
// Здесь — список токенов (по нему админка строит поля) и то, как значение превращается в CSS-переменную.

const W = [[300, 'Light 300'], [400, 'Regular 400'], [500, 'Medium 500']];
const pct = (v) => String(Number(v) / 100);

export const STYLE_GROUPS = [
  { title: 'Цвета', hint: 'Текст и кнопки на светлом фоне, текст на тёмном фоне проекта. Белый или чёрный текст на фоне проекта выбирается по контрасту.', items: [
    { key: 'paper', label: 'Фон сайта', type: 'color', def: '#FFFFFF', css: '--paper' },
    { key: 'ink', label: 'Текст и кнопки', type: 'color', def: '#000000', css: '--ink' },
    { key: 'mute', label: 'Второстепенный текст', type: 'color', def: '#666666', css: '--mute-l' },
    { key: 'inkDark', label: 'Текст на тёмном фоне проекта', type: 'color', def: '#FFFFFF', css: '--ink-dark' },
    { key: 'heart', label: 'Лайк', type: 'color', def: '#FF4D6A', css: '--heart' },
    { key: 'projectBg', label: 'Фон проекта, если цвет не задан', type: 'color', def: '#E9E9EC' },
  ] },
  { title: 'Шрифты', hint: 'Заголовки, метки разделов, теги и реплики головы — узкий шрифт; кнопки и тексты — Roboto. Размеры — в процентах от исходных: макет резиновый, от экрана зависит и сам размер.', items: [
    { key: 'titleSize', label: 'Размер заголовков', type: 'range', def: 100, min: 70, max: 140, step: 1, unit: '%', css: '--k-title', map: pct },
    { key: 'titleTracking', label: 'Трекинг заголовков', type: 'range', def: -1.2, min: -6, max: 6, step: 0.2, unit: '%', css: '--tr-title', map: (v) => `${Number(v) / 100}em` },
    { key: 'textSize', label: 'Размер текста', type: 'range', def: 100, min: 80, max: 130, step: 1, unit: '%', css: '--k-text', map: pct },
    { key: 'textWeight', label: 'Насыщенность текста', type: 'select', def: 400, options: W, css: '--w-text' },
    { key: 'leadWeight', label: 'Описание проекта (каталог, шапка кейса)', type: 'select', def: 400, options: W, css: '--w-lead' },
    { key: 'btnSize', label: 'Размер кнопок', type: 'range', def: 100, min: 80, max: 130, step: 1, unit: '%', css: '--k-btn', map: pct },
    { key: 'btnWeight', label: 'Насыщенность кнопок', type: 'select', def: 400, options: W, css: '--w-btn' },
  ] },
  { title: 'Скругления', hint: 'В процентах от высоты: у кнопки 50% — капсула, 0 — прямоугольник.', items: [
    { key: 'btnRadius', label: 'Кнопки', type: 'range', def: 50, min: 0, max: 50, step: 1, unit: '%', css: '--r-btn', map: pct },
    { key: 'cardRadius', label: 'Карточки каталога', type: 'range', def: 12, min: 0, max: 30, step: 1, unit: '%', css: '--r-card', map: pct },
  ] },
];
export const STYLE_TOKENS = STYLE_GROUPS.flatMap((g) => g.items);
const BY_KEY = Object.fromEntries(STYLE_TOKENS.map((x) => [x.key, x]));

const HEX = /^#[0-9a-f]{6}$/i;
// значение токена с проверкой: кривое или пустое — берётся умолчание
export function styleValue(style, key) {
  const tok = BY_KEY[key];
  const v = style && style[key];
  if (v === undefined || v === null || v === '') return tok.def;
  if (tok.type === 'color') return HEX.test(String(v)) ? String(v).toUpperCase() : tok.def;
  const n = Number(v);
  if (!Number.isFinite(n)) return tok.def;
  if (tok.type === 'select') return tok.options.some(([k]) => Number(k) === n) ? n : tok.def;
  return Math.min(tok.max, Math.max(tok.min, n));
}

// Токены → CSS-переменные на <html>. Умолчания не пишем: они уже в css/style.css
export function applyStyle(style, root = document.documentElement) {
  for (const tok of STYLE_TOKENS) {
    if (!tok.css) continue;
    const v = styleValue(style, tok.key);
    if (v === tok.def || String(v) === String(tok.def)) root.style.removeProperty(tok.css);
    else root.style.setProperty(tok.css, tok.map ? tok.map(v) : String(v));
  }
}
