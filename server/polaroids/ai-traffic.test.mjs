import test from 'node:test';
import assert from 'node:assert/strict';
import { readLog } from './ai-traffic.mjs';
import { collect } from './ai-sync.js';
const line = (ua, url = '/work/svoi-dengi/?private=secret', method = 'GET', status = 200, host = 'pnemchenko.ru') =>
  `192.0.2.2 [2026-11-15 13:45:00] "${method} ${url} HTTP/2.0" ${status} 17432 "${host}" "${ua}"`;

test('a page fetch needs no JavaScript, an AI referrer is insufficient, no private data survives', () => {
  const log = [
    line('ChatGPT-User/1.0'), line('ChatGPT-User/1.0'), line('Claude-User/1.0'),
    line('Mozilla/5.0', '/?utm_source=chatgpt.com'), line('GPTBot/1.1', '/index.html'),
    line('Perplexity-User/1.0', '/assets/a.jpg'), line('ChatGPT-User/1.0', '/admin/'),
    line('XChatGPT-User/1.0'), line('PortfolioAnalyticsCheck/1.0 (ChatGPT-User/1.0)'),
    line('ChatGPT-User/1.0','/','HEAD'), line('ChatGPT-User/1.0','/','GET',404),
    line('ChatGPT-User/1.0','/','GET',200,'other.ru')
  ];
  const {parsed, rows} = readLog(log);
  assert.equal(parsed, log.length);
  assert.deepEqual(rows.map(r => [r.agent,r.page,r.count]), [
    ['ChatGPT-User','/work/svoi-dengi/',2],['Claude-User','/work/svoi-dengi/',1],['GPTBot','/',1]
  ]);
  assert.equal(rows[0].at, Date.parse('2026-11-15T10:45:00Z'));
  assert.doesNotMatch(JSON.stringify(rows), /192\.0\.2|secret|13:45|Mozilla/);
  assert.ok(rows.every(r => r.confirmed === false));
});
test('sync validates service networks and distinguishes missing logs from zero AI requests',async t => {
  process.env.TIMEWEB_LOG_TOKEN = 'test';
  process.env.TIMEWEB_APP_ID = '123';
  let logs = [line('ChatGPT-User/1.0'),line('Claude-User/1.0')];
  t.mock.method(globalThis,'fetch',async (url,options) => {
    if (url.startsWith('https://api.timeweb.cloud/')) {
      assert.equal(options.headers.Authorization,'Bearer test');
      return Response.json({ app_logs:logs });
    }
    assert.equal(options.headers,undefined);
    return Response.json({ prefixes:[{ipv4Prefix:url.includes('openai.com')?'192.0.2.0/24':'198.51.100.0/24'}] });
  });
  const result = await collect();
  assert.equal(result.state,'ok');
  assert.deepEqual(result.rows.map(r=>r.confirmed),[true,false]);
  logs = ['application started'];
  assert.equal((await collect()).state,'no-log');
  logs = [line('Safari/1.0')];
  assert.deepEqual(await collect(),{state:'ok',rows:[]});
});
