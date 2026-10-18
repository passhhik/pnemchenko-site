// Цвет полос браузера под строкой состояния и под панелью Safari.
// Safari 26 на iPhone не читает <meta name="theme-color">. Полосы он красит так (WebKit, LocalFrameView::fixedContainerEdges):
// в точке в 8 px от верхнего и от нижнего края экрана ищет самый верхний fixed/sticky-слой — «край» — и берёт первый
// сплошной цвет фона на пути от точки к этому слою. Если цвета нет — снимает пиксели один раз и больше не обновляет,
// пока край тот же; если край размером во весь экран — держится за прежний цвет. У нас во весь экран лежат сцена
// головы, каталог и фон «в стиле проекта», поэтому под часами застревал цвет первого проекта, а в кейсе — каталога.
// Поэтому у краёв лежат две полоски по 12 px (тоньше 10 px Safari считает рамкой и пропускает): они выше всех слоёв,
// цвет у них сплошной и меняется на месте — Safari перечитывает его сам, кадр за кадром. Полоски не пересоздаются:
// край должен оставаться тем же элементом. Видны полоски только на iPhone и iPad (css/style.css, .tint), где
// и сверху, и снизу их закрывают строка состояния и панель браузера.
// theme-color тоже ставим — его читают Chrome на Android и Safari прежних версий; фон body — запасной источник цвета.
const meta = document.querySelector('meta[name="theme-color"]');
let strips = null;

function ensure() {
  if (strips && strips.every((el) => el.isConnected)) return strips;
  for (const old of document.querySelectorAll('.tint')) old.remove();
  strips = ['top', 'bottom'].map((side) => {
    const el = document.createElement('div');
    el.className = `tint tint--${side}`;
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
  });
  return strips;
}

// color — CSS-цвет (#RRGGBB или rgb(…)). Второй аргумент оставлен для совместимости: меняется всё сразу
export function setTint(color) {
  if (!color) return;
  if (meta && meta.content !== color) meta.content = color;
  for (const el of ensure()) el.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
}

// с первой секунды — цвет листа: до первой смены цвета край тоже должен быть нашим
const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
setTint(/^#[0-9a-f]{6}$/i.test(paper) ? paper : (meta && meta.content) || '#F4F6F6');
