// Тексты интерфейса на двух языках. Сейчас включён только русский (content/site.json → languages);
// чтобы включить английский, добавьте туда "en" и заполните английские поля в проектах.
export const UI = {
  ru: {
    skip: 'Сразу к работам',
    home: 'на главную',
    menu: 'Основное меню',
    allWork: 'Все работы',
    openProject: 'Смотреть проект', like: 'Нравится',
    sound: 'Звук',
    soundOn: 'Выключить звук',
    soundOff: 'Включить звук',
    loader: 'Собираю лицо',
    downloadCv: 'Скачать резюме',
    stage: 'Интерактивная 3D-голова. Её можно потянуть мышью или пальцем — она резиновая. Очки снимаются.',
    sections: 'Разделы портфолио',
    work: 'Работы',
    filter: 'Раздел',
    all: 'Все',
    index: 'Список проектов',
    empty: 'Здесь пока нет проектов.',
    project: ['проект', 'проекта', 'проектов'],
    year: 'Год', role: 'Роль', client: 'Клиент', team: 'Команда', duration: 'Срок',
    results: 'Результаты в цифрах',
    task: 'Задача', did: 'Что сделал', result: 'Результат',
    tags: 'Теги',
    next: 'Следующий проект',
    talk: 'Есть похожая задача? Давайте обсудим.',
    write: 'Написать',
    telegram: 'Telegram',
    pieceOf: '{title} — работа {n} из {m}',
    cover: 'Обложка проекта «{title}»',
    before: 'До', after: 'После', compare: 'Сравнение до и после',
    tiltText: 'Буду следить за наклоном', tiltOn: 'Включить', tiltNo: 'Не надо', tiltLabel: 'Наклон телефона',
  },
  en: {
    skip: 'Skip to work',
    home: 'home',
    menu: 'Main menu',
    allWork: 'All work',
    openProject: 'View project', like: 'Like',
    sound: 'Sound',
    soundOn: 'Turn sound off',
    soundOff: 'Turn sound on',
    loader: 'Assembling my face',
    downloadCv: 'Download CV',
    stage: 'Interactive 3D head. Pull it with your mouse or finger — it is rubbery. The glasses come off.',
    sections: 'Portfolio sections',
    work: 'Work',
    filter: 'Section',
    all: 'All',
    index: 'Project list',
    empty: 'No projects here yet.',
    project: ['project', 'projects', 'projects'],
    year: 'Year', role: 'Role', client: 'Client', team: 'Team', duration: 'Timeline',
    results: 'Results in numbers',
    task: 'Challenge', did: 'What I did', result: 'Result',
    tags: 'Tags',
    next: 'Next project',
    talk: 'Have a similar challenge? Let’s talk.',
    write: 'Email me',
    telegram: 'Telegram',
    pieceOf: '{title} — piece {n} of {m}',
    cover: 'Cover of “{title}”',
    before: 'Before', after: 'After', compare: 'Before and after comparison',
    tiltText: 'I can follow your phone tilt', tiltOn: 'Enable', tiltNo: 'No thanks', tiltLabel: 'Phone tilt',
  },
};

export function plural(n, forms, lang = 'ru') {
  if (lang !== 'ru') return n === 1 ? forms[0] : forms[1];
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return forms[0];
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return forms[1];
  return forms[2];
}

// Язык: ?lang=… → выбор посетителя → домен (.ru — русский) → язык браузера. Только среди включённых на сайте.
export function detectLang(site) {
  const on = (site.languages && site.languages.length ? site.languages : ['ru']).filter((l) => UI[l]);
  const ok = (l) => (l && on.includes(l) ? l : null);
  const fromUrl = ok(new URLSearchParams(location.search).get('lang'));
  if (fromUrl) {
    // выбор из адреса запоминается (кроме предпросмотра админки — там язык только на время просмотра)
    if (!new URLSearchParams(location.search).has('preview')) { try { localStorage.setItem('ph:lang', JSON.stringify(fromUrl)); } catch (_) { /* noop */ } }
    return fromUrl;
  }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('ph:lang')); } catch (_) { /* noop */ }
  if (ok(saved)) return saved;
  if (/\.(ru|рф|by|kz)$/i.test(location.hostname) && ok('ru')) return 'ru';
  for (const l of navigator.languages || [navigator.language || '']) {
    const short = String(l).slice(0, 2).toLowerCase();
    if (ok(short)) return short;
    if (['uk', 'be', 'kk'].includes(short) && ok('ru')) return 'ru';
  }
  return ok(site.defaultLang) || on[0] || 'ru';
}
