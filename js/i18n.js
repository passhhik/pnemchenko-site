// Тексты интерфейса на двух языках. Сейчас включён только русский (content/site.json → languages);
// чтобы включить английский, добавьте туда "en" и заполните английские поля в проектах.
export const UI = {
  ru: {
    skip: 'Сразу к работам',
    home: 'на главную',
    menu: 'Основное меню',
    allWork: 'Все работы',
    download: 'Скачать',
    pause: 'Пауза',
    play: 'Воспроизвести',
    replay: 'Повторить',
    openProject: 'Смотреть', like: 'Нравится', toHead: 'К голове',
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
    project: ['проект', 'проекта', 'проектов'], cases: ['кейс', 'кейса', 'кейсов'],
    year: 'Год проекта', role: 'Роль', client: 'Заказчик', team: 'Команда', duration: 'Срок разработки',      // подписи фактов — как в макете кейса
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
    // полароид и архив
    polaroid: 'Полароид', archive: 'Архив полароидов', polShot: 'Сфотографироваться с головой',
    polCaption: 'Подпись на карточке', polCaptionPh: 'Тут можно написать пожелание или комент — в две строки',
    polRetake: 'Перефоткать', polSave: 'Сохранить', polClose: 'Закрыть',
    polStickers: 'Наклейки: перетащите на карточку или нажмите', polSticker: 'Наклейка «{name}»',
    polPlaced: 'Наклейка «{name}» на карточке: стрелки двигают, Delete отклеивает',
    polAdded: 'Наклейка «{name}» на карточке. Всего наклеек: {n}', polRemoved: 'Наклейка «{name}» отклеена',
    arcEmpty: 'Здесь будут полароиды гостей. Потяни голову на главной и замри на пару секунд — сделаем первый.',
    arcLoading: 'Загружаю…', arcError: 'Архив сейчас не открылся. Попробуйте обновить страницу.',
    arcErrorMine: 'Общий архив сейчас не открылся — здесь только ваши карточки.',
    arcLocal: 'ваша · видно только вам', arcMine: 'ваша карточка', arcNoCaption: 'без подписи', arcStickers: 'наклейки: {list}',
    arcPrev: 'Предыдущая карточка', arcNext: 'Следующая карточка',
  },
  en: {
    skip: 'Skip to work',
    home: 'home',
    menu: 'Main menu',
    allWork: 'All work',
    download: 'Download',
    pause: 'Pause',
    play: 'Play',
    replay: 'Replay',
    openProject: 'View', like: 'Like', toHead: 'Back to the head',
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
    project: ['project', 'projects', 'projects'], cases: ['case', 'cases', 'cases'],
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
    polaroid: 'Polaroid', archive: 'Polaroid archive', polShot: 'Take a polaroid with the head',
    polCaption: 'Caption on the card', polCaptionPh: 'Write a wish or a comment — two lines',
    polRetake: 'Retake', polSave: 'Save', polClose: 'Close',
    polStickers: 'Stickers: drag onto the card or press', polSticker: 'Sticker “{name}”',
    polPlaced: 'Sticker “{name}” on the card: arrows move it, Delete peels it off',
    polAdded: 'Sticker “{name}” on the card. Stickers: {n}', polRemoved: 'Sticker “{name}” peeled off',
    arcEmpty: 'Guests’ polaroids will live here. Pull the head on the main page and hold still — let’s make the first one.',
    arcLoading: 'Loading…', arcError: 'The archive didn’t open right now. Try reloading the page.',
    arcErrorMine: 'The shared archive didn’t open right now — only your cards are here.',
    arcLocal: 'yours · only you can see it', arcMine: 'your card', arcNoCaption: 'no caption', arcStickers: 'stickers: {list}',
    arcPrev: 'Previous card', arcNext: 'Next card',
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
