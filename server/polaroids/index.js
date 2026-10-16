// Архив полароидов для портфолио — облачная функция Yandex Cloud Functions (Node.js 18 и новее, без зависимостей).
// Карточка посетителя: фото головы, подпись до 56 знаков и наклейки. Хранится в документных таблицах YDB
// (совместимы с Amazon DynamoDB); таблицы создаются сами при первом обращении.
//
// Ключей доступа нет: в базу функция ходит от имени своего сервисного аккаунта (роль ydb.editor). Cloud Functions
// на каждый вызов кладёт IAM-токен этого аккаунта в context.token — он и идёт в Document API (Authorization: Bearer).
//
//   GET  ?list=1[&before=<id>][&n=24]  → { items: [{ id, c, s, t }], next }   видимые карточки, новые первыми
//   GET  ?img=<id>                     → фото карточки (webp или jpeg); браузер кэширует его навсегда
//   POST {"img":"<base64>","c":"подпись","s":[{"e":"clown","x":0.5,"y":0.4,"r":-8}]}   → { ok, id, key, hidden }
//        key — секрет автора карточки (в базе лежит только его хеш). Карточка одна на человека: сайт присылает новую
//        вместе с "replace":{"id":"<прошлая>","key":"<её секрет>"} — прошлая удаляется.
//
// Модерация — с заголовком X-Mod-Key: <MOD_KEY> (ключ — в переменных функции, его же вводят в админке). Не Authorization:
// этим заголовком Cloud Functions проверяет IAM-токен вызова и чужое значение отбивает ответом 403 ещё до функции.
//   GET  ?all=1[&before][&n]           → то же, что list, вместе со скрытыми (у них h: 1)
//   GET  ?img=<id>                     → фото, даже у скрытой карточки
//   POST ?hide=<id>&v=1                → скрыть (v=0 — вернуть)
//   POST ?del=<id>                     → удалить совсем
//   GET  ?stats=1&days=30              → статистика посещений (см. «статистика посещений» ниже)
//
// Статистика: POST ?hit=1 — пачка событий визита со страницы сайта (без ключа).
//
// Защита от мусора: формат и размер фото, длина подписи, проверка наклеек; не больше IP_HOUR карточек в час с одного
// адреса и DAY_MAX в сутки на весь архив. Адрес посетителя не хранится — только хеш с секретной солью и номером часа
// (счётчик на час); соль функция придумывает сама и хранит в базе. Мат в подписи — карточка сразу скрыта, её можно
// вернуть в админке. PREMOD=1 — все новые карточки скрыты, пока их не покажут в админке. ALLOW_ORIGIN — адреса сайта
// через запятую: браузер принимает ответы только для них, и карточки из браузера принимаются только с них.
// Как развернуть — README.md рядом.
const crypto = require('crypto');

const BASE = process.env.TABLE || 'polaroids';
const T = { cards: BASE, img: `${BASE}_img`, rate: `${BASE}_rate`, stats: `${BASE}_stats` };
const KEYS = { [T.cards]: [['p', 'HASH'], ['id', 'RANGE']], [T.img]: [['id', 'HASH']], [T.rate]: [['k', 'HASH']], [T.stats]: [['d', 'HASH'], ['k', 'RANGE']] };
const IP_HOUR = Number(process.env.IP_HOUR) || 6;          // карточек в час с одного адреса
const DAY_MAX = Number(process.env.DAY_MAX) || 300;        // карточек в сутки на весь архив
const MAX_IMG = 200 * 1024;                                // фото не больше 200 КБ (сайт присылает 30–90 КБ)
const CAPTION_MAX = 56, STICKERS_MAX = 12;
const ID = /^[a-z0-9]{6,32}$/, STICKER = /^[a-z0-9][a-z0-9-]{0,23}$/;
const P = { S: 'a' };                                      // все карточки — в одном разделе таблицы, по порядку id (он растёт со временем)

// Document API — тот же протокол, что у DynamoDB: POST с операцией в заголовке X-Amz-Target и телом в JSON.
// Ошибка приходит JSON-ом с __type вида «…#ResourceNotFoundException» — её имя и становится именем исключения.
let TOKEN = '';                                            // IAM-токен сервисного аккаунта функции (из context.token)
async function ddb(op, input) {
  const endpoint = process.env.DOCAPI_ENDPOINT;            // «Document API эндпоинт» базы YDB
  if (!endpoint) throw Object.assign(new Error('DOCAPI_ENDPOINT не задан'), { name: 'Config' });
  if (!TOKEN) throw Object.assign(new Error('нет IAM-токена: у функции не указан сервисный аккаунт'), { name: 'Config' });
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.0', 'X-Amz-Target': `DynamoDB_20120810.${op}`, Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(input),
  });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch (_) { j = {}; }
  if (!r.ok) {
    const type = String(j.__type || j.code || j.name || '').split('#').pop() || `HTTP${r.status}`;
    throw Object.assign(new Error(`${op}: ${type}: ${j.message || j.Message || text.slice(0, 300)}`), { name: type, status: r.status });
  }
  return j;
}
// Адрес сайта для браузера (Access-Control-Allow-Origin) дописывает handler: см. origins() ниже
const CORS = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-mod-key, authorization',
  'Access-Control-Max-Age': '86400',
};
const reply = (statusCode, body) => ({ statusCode, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

// ---------- таблицы ----------
async function ensure(table) {
  try {
    await ddb('CreateTable', ({
      TableName: table,
      KeySchema: KEYS[table].map(([AttributeName, KeyType]) => ({ AttributeName, KeyType })),
      AttributeDefinitions: KEYS[table].map(([AttributeName]) => ({ AttributeName, AttributeType: 'S' })),
    }));
  } catch (e) { if (e.name !== 'ResourceInUseException') throw e; }
}
async function withTable(table, fn) {
  try { return await fn(); } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
    await ensure(table);                         // первый запуск: таблицы ещё нет — создаём и пробуем снова
    for (let k = 0; ; k++) {                     // таблица готова не мгновенно — подождём до двух секунд
      try { return await fn(); } catch (e2) {
        if (e2.name !== 'ResourceNotFoundException' || k >= 4) throw e2;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
}

// ---------- проверки ----------
const num = (v, a, b) => { const n = Number(v); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : null; };
const cleanCaption = (s) => [...String(s || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, CAPTION_MAX).join('');
function cleanStickers(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || !STICKER.test(String(p.e || ''))) continue;
    const x = num(p.x, 0, 1), y = num(p.y, 0, 1), r = num(p.r, -45, 45);
    if (x === null || y === null) continue;
    out.push({ e: String(p.e), x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, r: Math.round(r || 0) });
    if (out.length >= STICKERS_MAX) break;
  }
  return out;
}
// формат фото — по первым байтам, а не по словам браузера
function sniff(b) {
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return '';
}
// Мат в подписи. Корни — в начале слова или после приставки; список короткий намеренно: лучше пропустить что-то
// (скроете в админке), чем спрятать невинное. Латинские буквы-двойники («xуй») приводятся к русским.
const PREFIX = '(?:за|на|по|от|отъ|вы|у|о|до|пере|под|подъ|про|раз|разъ|рас|съ|при|об|объ|недо|въ|вз|из|ис)?';
const RU = ['ху[йяеёию]', 'пизд', 'бля(?:д|т|[^а-яё]|$)', 'еб[аёилноуы]', 'ёб', 'муд[аеоия]', 'залуп', 'пид[оа]р', 'пидр', 'гандон', 'шлюх', 'сук(?:[аиуе]|ой)(?:[^а-яё]|$)', 'дроч'];
const BAD_RU = new RegExp(`(?:^|[^а-яё])${PREFIX}(?:${RU.join('|')})`, 'u');
const BAD_EN = /(?:^|[^a-z])(?:fuck|shit|cunt|nigg(?:er|a)|faggot|bitch|whore|slut)/;
const TWIN = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н', '3': 'з', '0': 'о', '6': 'б', '@': 'а' };
function bad(text) {
  const low = text.toLowerCase();
  if (BAD_EN.test(low)) return true;
  const ru = low.replace(/[aeopcxykmtbh306@]/g, (ch) => TWIN[ch]);
  return BAD_RU.test(ru);
}

// ---------- кто прислал и сколько ----------
const header = (event, name) => { const h = event.headers || {}; const k = Object.keys(h).find((x) => x.toLowerCase() === name); return k ? String(h[k]) : ''; };
function ipOf(event) {
  const id = event.requestContext && event.requestContext.identity;
  return (id && id.sourceIp) || header(event, 'x-forwarded-for').split(',')[0].trim() || 'unknown';
}
async function bump(k) {
  const r = await withTable(T.rate, () => ddb('UpdateItem', ({
    TableName: T.rate, Key: { k: { S: k } }, UpdateExpression: 'ADD n :one',
    ExpressionAttributeValues: { ':one': { N: '1' } }, ReturnValues: 'UPDATED_NEW',
  })));
  return Number(r && r.Attributes && r.Attributes.n && r.Attributes.n.N) || 1;
}
// Соль для хеша адреса: своя у этого архива — функция придумывает её при первом запуске и хранит в базе
// (переменная SALT, если задана, важнее). Таблицу счётчиков можно чистить: появится новая соль, вреда нет
let SALT = '';
async function salt() {
  if (process.env.SALT) return process.env.SALT;
  if (SALT) return SALT;
  const Key = { k: { S: 'salt' } };
  const r = await withTable(T.rate, () => ddb('GetItem', { TableName: T.rate, Key }));
  if (r.Item && r.Item.v && r.Item.v.S) return (SALT = r.Item.v.S);
  const v = crypto.randomBytes(24).toString('hex');
  try {
    await ddb('PutItem', { TableName: T.rate, Item: { ...Key, v: { S: v } }, ConditionExpression: 'attribute_not_exists(k)' });
    SALT = v;
  } catch (e) {
    if (e.name !== 'ConditionalCheckFailedException') throw e;
    const again = await ddb('GetItem', { TableName: T.rate, Key });     // соль успел записать соседний вызов
    SALT = (again.Item && again.Item.v && again.Item.v.S) || v;
  }
  return SALT;
}
async function rateOk(ip) {
  const hour = Math.floor(Date.now() / 3600e3), day = new Date().toISOString().slice(0, 10);
  const who = crypto.createHash('sha256').update(`${await salt()}|${ip}|${hour}`).digest('hex').slice(0, 24);
  if ((await bump(`ip:${who}:${hour}`)) > IP_HOUR) return false;
  return (await bump(`day:${day}`)) <= DAY_MAX;
}
// модератор — тот, кто прислал ключ из переменной MOD_KEY (сравниваем хеши: время ответа не подсказывает ключ).
// Ключ — в X-Mod-Key; Authorization: Bearer — запасной путь, если функция стоит за API Gateway
function isMod(event) {
  const key = process.env.MOD_KEY || '';
  const given = header(event, 'x-mod-key').trim() || ((/^Bearer\s+(.+)$/i.exec(header(event, 'authorization')) || [])[1] || '').trim();
  if (key.length < 12 || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(key).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- действия ----------
const outItem = (it, mod) => {
  let s = [];
  try { s = JSON.parse((it.s && it.s.S) || '[]'); } catch (_) { s = []; }
  const o = { id: it.id.S, c: (it.c && it.c.S) || '', s, t: Number(it.t && it.t.N) || 0 };
  if (mod) { o.h = Number(it.h && it.h.N) ? 1 : 0; o.f = Number(it.f && it.f.N) ? 1 : 0; }
  return o;
};
async function list({ before, n, all }) {
  const want = Math.min(48, Math.max(1, Number(n) || 24));
  const items = [];
  let start = before && ID.test(before) ? { p: P, id: { S: before } } : undefined, next = '';
  for (let guard = 0; guard < 12; guard++) {
    const r = await withTable(T.cards, () => ddb('Query', ({
      TableName: T.cards, KeyConditionExpression: 'p = :p', ExpressionAttributeValues: { ':p': P },
      ScanIndexForward: false, Limit: Math.min(100, want * 2), ExclusiveStartKey: start,
    })));
    for (const it of r.Items || []) {
      if (!all && Number(it.h && it.h.N)) continue;
      items.push(outItem(it, all));
      if (items.length >= want) { next = it.id.S; break; }
    }
    start = r.LastEvaluatedKey;
    if (items.length >= want || !start) break;
  }
  return { items, next };
}
// Фото карточек не меняются: тёплый экземпляр функции держит недавние в памяти и не читает их из базы заново
// (фото — самая дорогая часть чтения). Карточка всё равно проверяется каждый раз: скрытую или удалённую не отдаём
const IMG_CACHE = new Map(), IMG_CACHE_MAX = 24 * 1024 * 1024;
let imgBytes = 0;
function cachePut(id, v) {
  if (IMG_CACHE.has(id)) return;
  IMG_CACHE.set(id, v); imgBytes += v.b.length;
  while (imgBytes > IMG_CACHE_MAX && IMG_CACHE.size) { const [k, o] = IMG_CACHE.entries().next().value; IMG_CACHE.delete(k); imgBytes -= o.b.length; }
}
async function image(id, mod) {
  const nf = { statusCode: 404, headers: { ...CORS, 'Cache-Control': 'no-store' }, body: '' };
  if (!ID.test(id)) return nf;
  const card = await withTable(T.cards, () => ddb('GetItem', ({ TableName: T.cards, Key: { p: P, id: { S: id } } })));
  if (!card.Item || (Number(card.Item.h && card.Item.h.N) && !mod)) return nf;
  let v = IMG_CACHE.get(id);
  if (!v) {
    const im = await withTable(T.img, () => ddb('GetItem', ({ TableName: T.img, Key: { id: { S: id } } })));
    if (!im.Item || !im.Item.b) return nf;
    v = { b: im.Item.b.S, m: (im.Item.m && im.Item.m.S) || 'image/webp' };
    cachePut(id, v);
  }
  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': v.m, 'Cache-Control': mod ? 'private, no-store' : 'public, max-age=31536000, immutable' },
    body: v.b, isBase64Encoded: true,
  };
}
async function create(event) {
  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (raw.length > MAX_IMG * 1.4 + 4000) return reply(413, { error: 'too large' });
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return reply(400, { error: 'bad json' }); }
  const buf = Buffer.from(String((msg && msg.img) || ''), 'base64');
  const mime = sniff(buf);
  if (!mime || buf.length < 1500 || buf.length > MAX_IMG) return reply(400, { error: 'bad image' });
  const c = cleanCaption(msg.c), s = cleanStickers(msg.s);
  if (!(await rateOk(ipOf(event)))) return reply(429, { error: 'too many' });
  const id = Date.now().toString(36).padStart(9, '0') + crypto.randomBytes(3).toString('hex');
  const key = crypto.randomBytes(16).toString('hex');
  const flagged = bad(c), hidden = flagged || process.env.PREMOD === '1';
  await withTable(T.img, () => ddb('PutItem', ({ TableName: T.img, Item: { id: { S: id }, b: { S: buf.toString('base64') }, m: { S: mime } } })));
  const item = { p: P, id: { S: id }, s: { S: JSON.stringify(s) }, t: { N: String(Date.now()) }, h: { N: hidden ? '1' : '0' }, f: { N: flagged ? '1' : '0' }, k: { S: sha(key) } };
  if (c) item.c = { S: c };
  await withTable(T.cards, () => ddb('PutItem', ({ TableName: T.cards, Item: item })));
  // карточка одна на человека: прошлая уходит, если прислан её секрет
  let replaced = 0;
  const old = msg.replace && typeof msg.replace === 'object' ? msg.replace : null;
  if (old && ID.test(String(old.id || '')) && typeof old.key === 'string' && /^[0-9a-f]{32}$/.test(old.key) && old.id !== id) {
    const prev = await ddb('GetItem', ({ TableName: T.cards, Key: { p: P, id: { S: old.id } } }));
    if (prev.Item && prev.Item.k && safeEq(prev.Item.k.S, sha(old.key))) { await drop(old.id); replaced = 1; }
  }
  return reply(200, { ok: true, id, key, hidden: hidden ? 1 : 0, replaced });
}
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
async function drop(id) {
  const c = IMG_CACHE.get(id);
  if (c) { IMG_CACHE.delete(id); imgBytes -= c.b.length; }
  await withTable(T.cards, () => ddb('DeleteItem', ({ TableName: T.cards, Key: { p: P, id: { S: id } } })));
  await withTable(T.img, () => ddb('DeleteItem', ({ TableName: T.img, Key: { id: { S: id } } })));
}
async function moderate(q) {
  const id = String(q.hide || q.del || '');
  if (!ID.test(id)) return reply(400, { error: 'bad id' });
  if (q.del) { await drop(id); return reply(200, { ok: true }); }
  const h = String(q.v) === '0' ? '0' : '1';
  try {
    await withTable(T.cards, () => ddb('UpdateItem', ({
      TableName: T.cards, Key: { p: P, id: { S: id } }, UpdateExpression: 'SET h = :h',
      ConditionExpression: 'attribute_exists(id)', ExpressionAttributeValues: { ':h': { N: h } },
    })));
  } catch (e) { if (e.name === 'ConditionalCheckFailedException') return reply(404, { error: 'not found' }); throw e; }
  return reply(200, { ok: true, h: Number(h) });
}

// ---------- статистика посещений ----------
// Свой счётчик без cookie (js/stats.js на сайте). Сайт присылает пачки событий визита: POST ?hit=1, тело text/plain
// {"v":"<id визита>","x":{откуда, устройство…},"ev":[{"e":"case","s":"slug","a":<сколько мс назад>}…]}.
// Хранится только то, что ниже в cleanCtx/cleanEvents: ни IP, ни строки браузера. «Посетитель за день» — хеш соли, дня,
// адреса и браузера: по нему считаются уникальные за день, а на следующий день тот же человек — уже другой хеш.
// Отчёт — GET ?stats=1&days=30 с ключом модератора: визиты со сводкой, считает их админка.
const HITS_DAY = Number(process.env.HITS_DAY) || 20000;           // пачек событий в сутки — дальше молча не пишем
const BOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pingdom|uptime/i;      // счётчик шлёт сам сайт из браузера — роботов без JS тут и так нет
const EV = new Set(['home', 'catalog', 'case', 'archive', 'cv', 'contact', 'like', 'polaroid', 'folder', 'glasses', 'spit', 'tilt', 'dock', 'end']);
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
const word = (v, n, re = /^[\p{L}\p{N} ._:/+×-]+$/u) => { const s = String(v ?? '').trim().slice(0, n); return s && re.test(s) ? s : ''; };
function cleanCtx(x) {
  if (!x || typeof x !== 'object') return null;
  const o = {
    from: word(x.from, 40, /^[a-z0-9][a-z0-9_-]*$/i).toLowerCase(),
    ref: word(x.ref, 80, /^[a-z0-9.-]+$/i).toLowerCase(),
    dev: ['phone', 'tablet', 'desktop'].includes(x.dev) ? x.dev : '',
    os: word(x.os, 20), br: word(x.br, 24), scr: word(x.scr, 11, /^\d{2,5}×\d{2,5}$/),
    tz: word(x.tz, 40, /^[A-Za-z0-9_/+-]+$/), lang: word(x.lang, 10, /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i), ui: word(x.ui, 4, /^[a-z]{2}$/),
  };
  for (const k of Object.keys(o)) if (!o[k]) delete o[k];
  return Object.keys(o).length ? o : null;
}
function cleanEvents(list, now) {
  const out = [];
  for (const e of Array.isArray(list) ? list.slice(0, 60) : []) {
    if (!e || !EV.has(e.e)) continue;
    const o = { e: e.e, t: now - Math.round(num(e.a, 0, 36e5) || 0) };
    if (e.s && SLUG.test(String(e.s))) o.s = String(e.s);
    if (e.e === 'contact') o.via = word(e.via, 16, /^[a-z]+$/);
    if (e.e === 'folder' || e.e === 'catalog') o.sec = word(e.sec, 24, /^[a-z0-9-]+$/);
    if (e.e === 'like') o.on = e.on ? 1 : 0;
    if (e.e === 'end') {
      o.act = Math.round(num(e.act, 0, 86400) || 0);
      const c = {};
      for (const [k, sec] of Object.entries(e.c && typeof e.c === 'object' ? e.c : {}).slice(0, 40)) if (SLUG.test(k)) c[k] = Math.round(num(sec, 0, 86400) || 0);
      o.c = c;
    }
    out.push(o);
  }
  return out;
}
async function hit(event) {
  const none = { statusCode: 204, headers: { ...CORS }, body: '' };
  const ua = header(event, 'user-agent');
  if (!ua || BOT.test(ua)) return none;
  let raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (raw.length > 12000) return reply(413, { error: 'too large' });
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return reply(400, { error: 'bad json' }); }
  const v = String((msg && msg.v) || '');
  if (!/^[a-z0-9]{8,24}$/.test(v)) return reply(400, { error: 'bad visit' });
  const now = Date.now(), ev = cleanEvents(msg.ev, now);
  if (!ev.length) return none;
  const day = new Date(now).toISOString().slice(0, 10);
  if ((await bump(`hits:${day}`)) > HITS_DAY) return none;
  const u = sha(`${await salt()}|${day}|${ipOf(event)}|${ua}`).slice(0, 16);
  const item = { d: { S: day }, k: { S: now.toString(36).padStart(9, '0') + crypto.randomBytes(3).toString('hex') }, v: { S: v }, u: { S: u }, t: { N: String(now) }, e: { S: JSON.stringify(ev) } };
  const x = cleanCtx(msg.x);
  if (x) item.x = { S: JSON.stringify(x) };
  await withTable(T.stats, () => ddb('PutItem', { TableName: T.stats, Item: item }));
  return none;
}
async function dayItems(day) {
  const items = [];
  let start;
  for (let guard = 0; guard < 50; guard++) {
    const r = await withTable(T.stats, () => ddb('Query', { TableName: T.stats, KeyConditionExpression: 'd = :d', ExpressionAttributeValues: { ':d': { S: day } }, ExclusiveStartKey: start }));
    items.push(...(r.Items || []));
    start = r.LastEvaluatedKey;
    if (!start) break;
  }
  return items;
}
// Визиты за последние days суток: по визиту — когда, откуда, устройство и что делал. Сводки и графики строит админка
async function stats(q) {
  const days = Math.min(92, Math.max(1, Number(q.days) || 30)), now = Date.now(), from = now - days * 864e5;
  const list = [];
  for (let i = 0; i <= days; i++) list.push(new Date(now - i * 864e5).toISOString().slice(0, 10));
  const all = [];
  for (let i = 0; i < list.length; i += 8) (await Promise.all(list.slice(i, i + 8).map(dayItems))).forEach((a) => all.push(...a));
  const V = new Map();
  for (const it of all) {
    const t = Number(it.t && it.t.N) || 0;
    if (t < from) continue;
    const id = it.v.S;
    let o = V.get(id);
    if (!o) V.set(id, (o = { v: id, t0: t, t1: t, u: [], x: {}, ev: [] }));
    o.t0 = Math.min(o.t0, t); o.t1 = Math.max(o.t1, t);
    const u = it.u && it.u.S; if (u && !o.u.includes(u)) o.u.push(u);
    try { Object.assign(o.x, JSON.parse((it.x && it.x.S) || '{}')); } catch (_) { /* без контекста */ }
    try { o.ev.push(...JSON.parse((it.e && it.e.S) || '[]')); } catch (_) { /* битая пачка */ }
  }
  const visits = [...V.values()].map((o) => {
    o.ev.sort((a, b) => a.t - b.t);
    const r = { v: o.v, t0: Math.min(o.t0, ...o.ev.map((e) => e.t)), t1: o.t1, u: o.u, x: o.x, open: [], c: {}, act: 0, cv: 0, ct: [], lk: [], pol: 0, fun: [] };
    for (const e of o.ev) {
      if (e.e === 'case' && e.s && !r.open.includes(e.s)) r.open.push(e.s);
      else if (e.e === 'cv') r.cv++;
      else if (e.e === 'contact' && e.via && !r.ct.includes(e.via)) r.ct.push(e.via);
      else if (e.e === 'like' && e.on && e.s && !r.lk.includes(e.s)) r.lk.push(e.s);
      else if (e.e === 'polaroid') r.pol++;
      else if (e.e === 'end') { r.act = Math.max(r.act, e.act || 0); for (const [k, s] of Object.entries(e.c || {})) r.c[k] = Math.max(r.c[k] || 0, s); }
      else if (['glasses', 'spit', 'tilt', 'dock', 'archive'].includes(e.e) && !r.fun.includes(e.e)) r.fun.push(e.e);
    }
    return r;
  }).sort((a, b) => b.t0 - a.t0).slice(0, 3000);
  return { days, now, visits };
}

// ---------- с какого сайта ----------
// ALLOW_ORIGIN — адреса сайта через запятую: он открывается и с www, и без («https://pnemchenko.ru, https://www.pnemchenko.ru»).
// Браузеру отвечаем тем адресом из списка, с которого пришёл запрос. Пусто — любой адрес (*).
const origins = () => String(process.env.ALLOW_ORIGIN || '').split(/[\s,]+/).map((s) => s.replace(/\/+$/, '').toLowerCase()).filter(Boolean);
const originOf = (event) => header(event, 'origin').replace(/\/+$/, '').toLowerCase();
// Карточки шлёт только сам сайт: чужая страница не отправит их руками своих посетителей (CORS этого не запрещает —
// он только прячет ответ). Запрос без Origin (не из браузера) пропускаем: заголовок и так подделывается, от этого — лимит на адрес
const originOk = (event) => { const allow = origins(), from = originOf(event); return !allow.length || !from || allow.includes(from); };

async function route(event) {
  const method = String(event.httpMethod || 'GET').toUpperCase();
  const q = event.queryStringParameters || {};
  try {
    if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
    const mod = isMod(event);
    if (method === 'GET') {
      if (q.img) return await image(String(q.img), mod);
      if (q.stats) return mod ? reply(200, await stats(q)) : reply(401, { error: 'moderator key required' });
      if (q.all) return mod ? reply(200, await list({ before: q.before, n: q.n, all: true })) : reply(401, { error: 'moderator key required' });
      if (q.list) return reply(200, await list({ before: q.before, n: q.n, all: false }));
      return reply(200, { ok: true, service: 'polaroids' });
    }
    if (method === 'POST') {
      if (q.hide || q.del) return mod ? await moderate(q) : reply(401, { error: 'moderator key required' });
      if (!originOk(event)) return reply(403, { error: 'origin not allowed' });
      if (q.hit) return await hit(event);
      return await create(event);
    }
    return reply(405, { error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return reply(500, { error: e.name === 'Config' ? `not configured: ${e.message}` : 'server error' });
  }
}

module.exports.handler = async (event, context) => {
  TOKEN = (context && context.token && context.token.access_token) || process.env.YDB_TOKEN || '';
  const res = await route(event);
  const allow = origins(), from = originOf(event);
  res.headers = { ...res.headers, 'Access-Control-Allow-Origin': !allow.length ? '*' : (from && allow.includes(from) ? from : allow[0]) };
  if (allow.length > 1) res.headers.Vary = 'Origin';
  return res;
};
// для проверки фильтра мата (node -e "console.log(require('./index.js')._bad('…'))")
module.exports._bad = bad;
