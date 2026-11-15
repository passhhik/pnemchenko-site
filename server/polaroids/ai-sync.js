// Loaded only by the moderator report or a Yandex timer. Never return raw logs.
const { BlockList, isIP } = require('node:net');
const ranges = new Map();
async function networkList(url) {
  const cached = ranges.get(url);
  if (cached && cached.until > Date.now()) return cached.list;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const { prefixes } = await res.json();
    const list = new BlockList();
    for (const entry of prefixes) {
      const cidr = entry.ipv4Prefix || entry.ipv6Prefix;
      if (!cidr) continue;
      const [ip, size] = cidr.split('/');
      list.addSubnet(ip, Number(size), isIP(ip) === 6 ? 'ipv6' : 'ipv4');
    }
    ranges.set(url, { list, until: Date.now() + 3600000 });
    return list;
  } catch { return undefined; }
}

exports.collect = async function collect() {
  const id = process.env.TIMEWEB_APP_ID, token = process.env.TIMEWEB_LOG_TOKEN;
  if (!token || !/^\d+$/.test(id || '')) return { state: 'unconfigured', rows: [] };
  const { readLog, agents } = await import('./ai-traffic.mjs');
  const res = await fetch('https://api.timeweb.cloud/api/v1/apps/' + id + '/logs', {
    headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000), redirect: 'error',
  });
  if (!res.ok) throw Error('Timeweb HTTP ' + res.status);
  const { app_logs: lines } = await res.json();
  if (!Array.isArray(lines)) throw Error('Timeweb: неизвестный формат ответа');
  const preliminary = readLog(lines);
  if (!preliminary.parsed) return { state: 'no-log', rows: [] };
  const names = new Set(preliminary.rows.map(row => row.agent));
  const urls = [...new Set(agents.filter(([name]) => names.has(name)).map(a => a[3]).filter(Boolean))];
  const lists = new Map(await Promise.all(urls.map(async url => [url, await networkList(url)])));
  const result = readLog(lines, (agent, ip) => {
    const version = isIP(ip);
    return !!(version && lists.get(agent.list)?.check(ip, version === 6 ? 'ipv6' : 'ipv4'));
  });
  return { state: 'ok', rows: result.rows };
};
