// Счётчик лайков для портфолио — облачная функция Yandex Cloud Functions (Node.js 18 и новее).
// Хранит одно число на проект в документной таблице YDB (совместима с Amazon DynamoDB, поэтому клиент — AWS SDK).
//   GET  → { "likes": { "адрес-проекта": число, … } }        — числа для админки
//   POST → тело {"slug":"адрес-проекта","d":1} или d:-1      — посетитель поставил или снял лайк
// Ни IP-адресов, ни меток посетителей функция не читает и не хранит — только адрес проекта и ±1.
// Как развернуть — README.md рядом.
const { DynamoDBClient, UpdateItemCommand, ScanCommand, CreateTableCommand } = require('@aws-sdk/client-dynamodb');

const TABLE = process.env.TABLE || 'likes';
const db = new DynamoDBClient({
  region: 'ru-central1',
  endpoint: process.env.DOCAPI_ENDPOINT,          // «Document API эндпоинт» базы YDB
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
});
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOW_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) });

async function ensureTable() {
  try {
    await db.send(new CreateTableCommand({
      TableName: TABLE,
      KeySchema: [{ AttributeName: 'slug', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'slug', AttributeType: 'S' }],
    }));
  } catch (e) { if (e.name !== 'ResourceInUseException') throw e; }
}
async function withTable(fn) {
  try { return await fn(); } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
    await ensureTable();                         // первый запуск: таблицы ещё нет — создаём и пробуем снова
    for (let k = 0; ; k++) {                     // таблица готова не мгновенно — подождём до двух секунд
      try { return await fn(); } catch (e2) {
        if (e2.name !== 'ResourceNotFoundException' || k >= 4) throw e2;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
}

async function counts() {
  const out = {};
  let start;
  do {
    const r = await db.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: start }));
    for (const it of r.Items || []) out[it.slug.S] = Math.max(0, Number(it.n && it.n.N) || 0);
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

async function bump(slug, d) {
  const cmd = {
    TableName: TABLE,
    Key: { slug: { S: slug } },
    UpdateExpression: 'ADD n :d',
    ExpressionAttributeValues: { ':d': { N: String(d) } },
  };
  if (d < 0) { cmd.ConditionExpression = 'n > :z'; cmd.ExpressionAttributeValues[':z'] = { N: '0' }; }   // ниже нуля не уходим
  try { await db.send(new UpdateItemCommand(cmd)); } catch (e) { if (e.name !== 'ConditionalCheckFailedException') throw e; }
}

module.exports.handler = async (event) => {
  const method = (event.httpMethod || 'GET').toUpperCase();
  try {
    if (method === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
    if (method === 'GET') return reply(200, { likes: await withTable(counts) });
    if (method === 'POST') {
      let raw = event.body || '';
      if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
      let msg;
      try { msg = JSON.parse(raw); } catch (_) { return reply(400, { error: 'bad json' }); }
      const slug = String(msg.slug || ''), d = Number(msg.d);
      if (!SLUG.test(slug) || (d !== 1 && d !== -1)) return reply(400, { error: 'bad request' });
      await withTable(() => bump(slug, d));
      return reply(200, { ok: true });
    }
    return reply(405, { error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return reply(500, { error: 'server error' });
  }
};
