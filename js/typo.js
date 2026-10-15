// Типографика текста на сайте: короткие слова не висят в конце строки, тире не уезжает в начало следующей, число не
// отрывается от того, что оно считает. Делается неразрывными пробелами — сам текст в админке не меняется, правила
// применяются при выводе (js/content.js: tx и t; реплики головы — js/subtitles.js).
//
// Правила:
// — предлоги, союзы и частицы в одну-две буквы («в», «и», «на», «не») и короткие служебные слова из списка ниже
//   («для», «без», «под», «как», «что») приклеиваются к следующему слову;
// — «же», «ли», «бы» приклеиваются к предыдущему;
// — тире приклеивается к слову перед ним;
// — число приклеивается к следующему слову («3 кейса», «2 недели», «1 581 ₽»), № и § — к числу;
// — сокращения вроде «т. е.», «и т. д.» не разрываются;
// — по-английски: a, an, the, of, to, in, on, at, by, for, and, or, but и т. п. — к следующему слову.
// Ссылки и пути к файлам не трогаются.
const NB = ' ';
const RU_NEXT = new Set(['без', 'для', 'изо', 'над', 'обо', 'ото', 'под', 'при', 'про', 'как', 'что', 'или', 'ибо', 'чем', 'где', 'это', 'все', 'всё', 'его', 'её', 'их', 'мой', 'моя', 'мое', 'моё', 'мои', 'наш', 'ваш', 'кто', 'нет', 'уже', 'еще', 'ещё', 'так', 'тут', 'там']);
const EN_NEXT = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'and', 'or', 'but', 'as', 'if', 'so', 'no', 'nor', 'via', 'my', 'our', 'your', 'its', 'i', 'we', 'is', 'be', 'up']);
const AFTER = /^(же|ж|ли|ль|бы|б)(?=$|[.,!?…:;»"”)])/i;            // частицы — к предыдущему слову
const OPEN = /^[(«„"“'‘[]+/;                                        // открывающие кавычки и скобки перед словом
const LINKY = /^(https?:|mailto:|tel:|data:|blob:|\/|\.\.?\/|assets\/|#\/)/i;

const lastPart = (w) => w.slice(Math.max(w.lastIndexOf(NB), w.lastIndexOf('\n')) + 1);
const firstPart = (w) => w.split(/[ \n]/)[0];

function glue(prev, next) {
  const p = lastPart(prev).replace(OPEN, ''), n = firstPart(next);
  if (!p || !n) return false;
  if (/^[—–]/.test(n) || n === '-') return true;                    // тире (и дефис вместо него) — к слову перед ним
  if (AFTER.test(n) && /[\p{L}\d]$/u.test(p)) return true;           // «он же», «если бы»
  if (/^[№§]$/.test(p)) return true;                                 // «№ 5»
  if (/^\d[\d.,]*%?$/.test(p) && /^[\p{L}\p{Sc}%°‰×\d]/u.test(n)) return true;      // «3 кейса», «1 581 ₽», «2 × 3»
  const low = p.toLowerCase();
  if (/^(же|ж|ли|ль|бы|б)$/.test(low)) return false;                 // частица уже держится за слово перед ней
  if (/^[а-яё]{1,2}$/i.test(p)) return true;                         // «в», «и», «на», «не», «по»
  if (/^[а-яё]{1,2}\.$/i.test(p) && /^[а-яё\d]/.test(n)) return true;      // «т. е.», «г. Москва»
  if (RU_NEXT.has(low)) return true;
  if (/^[a-z]+$/i.test(p) && EN_NEXT.has(low)) return true;
  return false;
}

export function typo(s) {
  if (typeof s !== 'string' || s.indexOf(' ') < 0) return s;
  const trimmed = s.trim();
  if (LINKY.test(trimmed) || /^[^\s]+@[^\s]+$/.test(trimmed)) return s;
  const parts = s.split(/( +)/);                                     // слова и обычные пробелы; переносы строк остаются в словах
  for (let i = 1; i < parts.length - 1; i += 2) {
    if (parts[i].length === 1 && glue(parts[i - 1], parts[i + 1])) parts[i] = NB;
  }
  return parts.join('');
}
