// Наклейки полароида. Набор — в content/site.json (polaroid.stickers), правится в админке («Настройки сайта» →
// «Полароид»): у каждой наклейки название, эмодзи и необязательная своя картинка. Своя картинка заменяет эмодзи
// везде — в палитре и на уже сохранённых карточках архива: на карточке хранится только id наклейки и где она приклеена.
//
// Эмодзи рисует система посетителя: на iPhone и Mac это эмодзи Apple, на Android — Google, на Windows — Microsoft.
// Сами картинки Apple файлами на сайт класть нельзя (это их графика), поэтому эмодзи остаётся текстом, а «вырубку» —
// белый край и мягкую тень, как у настоящей наклейки, — один раз на наклейку дорисовываем на холсте.

export const DEFAULT_STICKERS = [
  { id: 'clown', name: 'Клоун', emoji: '🤡' },
  { id: 'skull', name: 'Череп', emoji: '💀' },
  { id: 'kheart', name: 'Корейское сердечко', emoji: '🫰', fallback: '🤞' },     // 🫰 есть с iOS 15.4 / Android 12L; где его нет — 🤞
  { id: 'peace', name: 'Писс', emoji: '✌️' },
  { id: 'pacific', name: 'Пацифик', emoji: '☮️' },
  { id: 'poo', name: 'Какашка', emoji: '💩' },
  { id: 'heart', name: 'Сердечко', emoji: '❤️' },
  { id: 'like', name: 'Класс', emoji: '👍' },
  { id: 'devil', name: 'Чорт', emoji: '😈' },
  { id: 'rock', name: 'Рок', emoji: '🤘' },
];
export const STICKER_ID = /^[a-z0-9][a-z0-9-]{0,23}$/;
const DEF = new Map(DEFAULT_STICKERS.map((s) => [s.id, s]));
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Набор наклеек сайта: свои из настроек (если заданы) или исходные. name — строка или { ru, en }: text(v) выбирает язык.
// Наклейка без эмодзи и без картинки в набор не попадает.
export function stickerSet(site, text = (v) => (typeof v === 'string' ? v : (v && (v.ru || Object.values(v)[0])) || '')) {
  const own = site && site.polaroid && Array.isArray(site.polaroid.stickers) ? site.polaroid.stickers : null;
  const list = own && own.length ? own : DEFAULT_STICKERS;
  const out = [];
  for (const s of list) {
    if (!s || !STICKER_ID.test(String(s.id || ''))) continue;
    const d = DEF.get(s.id) || {};
    const image = str(s.image), emoji = str(s.emoji).slice(0, 16);
    if (!image && !emoji) continue;
    out.push({ id: s.id, name: str(text(s.name)) || str(text(d.name)) || s.id, emoji, image, fallback: str(s.fallback) || d.fallback || '' });
  }
  return out;
}

// ---------- эмодзи на холсте ----------
const FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla","EmojiOne Color",sans-serif';
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ok = new Map();
// Есть ли у системы цветной рисунок для этого эмодзи. Цветной глиф не перекрашивается цветом заливки, а «квадратик»
// на месте неизвестного символа и чёрно-белый значок — перекрашиваются: рисуем дважды разными цветами и сравниваем.
export function emojiOk(ch) {
  if (!ch) return false;
  if (ok.has(ch)) return ok.get(ch);
  let res = false;
  try {
    const c = canvas(40, 40), g = c.getContext('2d', { willReadFrequently: true });
    g.font = `28px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#f00'; g.fillText(ch, 20, 21);
    const a = g.getImageData(0, 0, 40, 40).data;
    g.clearRect(0, 0, 40, 40);
    g.fillStyle = '#00f'; g.fillText(ch, 20, 21);
    const b = g.getImageData(0, 0, 40, 40).data;
    let any = false; res = true;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] > 20) any = true;
      if (a[i] !== b[i] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) { res = false; break; }
    }
    res = res && any;
  } catch (_) { res = false; }
  ok.set(ch, res);
  return res;
}

// Глиф целиком: рисуем крупно и ищем его рамку по непрозрачным пикселям — у разных систем эмодзи сидят в строке по-разному
function glyph(ch) {
  const S = 256, c = canvas(S, S), g = c.getContext('2d', { willReadFrequently: true });
  g.font = `${Math.round(S * 0.68)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#000';
  g.fillText(ch, S / 2, S / 2 + S * 0.03);
  const d = g.getImageData(0, 0, S, S).data;
  let x0 = S, y0 = S, x1 = -1, y1 = -1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (d[(y * S + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return null;
  return { c, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const cut = new Map();
// Наклейка из эмодзи: белая «вырубка» по контуру и мягкая тень. Возвращает адрес картинки (data:) или '' — эмодзи не нарисовался
export function dieCut(ch, size = 200) {
  const key = `${ch}|${size}`;
  if (cut.has(key)) return cut.get(key);
  let url = '';
  try {
    const gl = glyph(ch);
    if (gl) {
      const pad = Math.round(size * 0.1), inner = size - pad * 2, k = inner / Math.max(gl.w, gl.h);
      const dw = gl.w * k, dh = gl.h * k, dx = (size - dw) / 2, dy = (size - dh) / 2;
      // силуэт глифа белым
      const sil = canvas(size, size), s = sil.getContext('2d');
      s.drawImage(gl.c, gl.x, gl.y, gl.w, gl.h, dx, dy, dw, dh);
      s.globalCompositeOperation = 'source-in'; s.fillStyle = '#fff'; s.fillRect(0, 0, size, size);
      // белый край: силуэт, «обведённый» по кругу
      const ring = canvas(size, size), r = ring.getContext('2d'), w = size * 0.04;
      for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; r.drawImage(sil, Math.cos(a) * w, Math.sin(a) * w); }
      r.drawImage(sil, 0, 0);
      const out = canvas(size, size), o = out.getContext('2d');
      o.save();
      o.shadowColor = 'rgba(0,0,0,.26)'; o.shadowBlur = size * 0.045; o.shadowOffsetY = size * 0.018;
      o.drawImage(ring, 0, 0);
      o.restore();
      o.drawImage(gl.c, gl.x, gl.y, gl.w, gl.h, dx, dy, dw, dh);
      url = out.toDataURL('image/png');
    }
  } catch (_) { url = ''; }
  cut.set(key, url);
  return url;
}

// Что показать на месте наклейки: своя картинка → эмодзи (или запасное, если основного в системе нет) → ничего
export function stickerSrc(st) {
  if (!st) return '';
  if (st.image) return st.image;
  const ch = !emojiOk(st.emoji) && st.fallback && emojiOk(st.fallback) ? st.fallback : st.emoji;
  return ch ? dieCut(ch) : '';
}
// По id наклейки на сохранённой карточке. Наклейку убрали из набора — у исходных остаётся их эмодзи
export function stickerById(set, id) {
  return set.find((s) => s.id === id) || (DEF.has(id) ? { ...DEF.get(id), image: '' } : null);
}
