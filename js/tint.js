// Цвет полос браузера под строкой состояния и под панелью Safari.
// Safari 26 на iPhone не читает <meta name="theme-color">: полосы он красит цветом фиксированных элементов у краёв
// экрана (а без них — фоном страницы) и пересматривает этот цвет, когда такие элементы появляются, — смену цвета у
// элемента, который уже стоит, он не замечает. Поэтому у верхнего и нижнего края лежат две тонкие полоски цвета
// страницы: цвет поменялся — полоски заменяются новыми (не чаще раза в 120 мс, пока цвет плывёт при листании каталога).
// theme-color тоже ставим — его читают Chrome на Android и Safari прежних версий.
const meta = document.querySelector('meta[name="theme-color"]');
let shown = '', want = '', timer = 0, seq = 0;

// Полоски убираются и возвращаются не сразу, а через пару кадров: если заменить их в одном шаге, на экране ничего не
// меняется (те же места, те же размеры), и Safari не перечитывает цвет — на iPhone под часами оставался цвет первого
// проекта каталога. Кадр без полосок Safari видит как «фиксированные элементы ушли», новые — как «пришли».
function put(color) {
  const my = ++seq;
  for (const old of document.querySelectorAll('.tint')) old.remove();
  shown = color;
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
    if (my !== seq) return;
    for (const side of ['top', 'bottom']) {
      const el = document.createElement('div');
      el.className = `tint tint--${side}`;
      el.setAttribute('aria-hidden', 'true');
      el.style.backgroundColor = want || color;
      document.body.appendChild(el);
    }
  }, 50)));
}

// color — CSS-цвет (#RRGGBB или rgb(…)); now — заменить полоски сразу, без ожидания
export function setTint(color, now = false) {
  if (!color) return;
  if (meta && meta.content !== color) meta.content = color;
  want = color;
  for (const el of document.querySelectorAll('.tint')) el.style.backgroundColor = color;     // видимый цвет — сразу
  if (color === shown) return;
  if (now) { clearTimeout(timer); timer = 0; put(color); return; }
  if (!timer) timer = setTimeout(() => { timer = 0; if (want !== shown) put(want); }, 120);
}
