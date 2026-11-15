// Timeweb frontend access logs. Only classification results leave this parser.
export const agents = [
  ['ChatGPT-User', 'ChatGPT', 'request', 'https://openai.com/chatgpt-user.json'],
  ['Claude-User', 'Claude', 'request', 'https://claude.com/crawling/bots.json'],
  ['Claude-Agent', 'Claude', 'request'],
  ['Perplexity-User', 'Perplexity', 'request', 'https://www.perplexity.ai/perplexity-user.json'],
  ['OAI-SearchBot', 'OpenAI', 'crawler', 'https://openai.com/searchbot.json'],
  ['GPTBot', 'OpenAI', 'crawler', 'https://openai.com/gptbot.json'],
  ['Claude-SearchBot', 'Claude', 'crawler', 'https://claude.com/crawling/bots.json'],
  ['ClaudeBot', 'Claude', 'crawler', 'https://claude.com/crawling/bots.json'],
  ['PerplexityBot', 'Perplexity', 'crawler', 'https://www.perplexity.ai/perplexitybot.json'],
];
const rules = agents.map(([name, service, kind, list]) => ({
  name, service, kind, list, match: new RegExp('(?:^|[\\s;(])' + name + '(?=/|[\\s;)]|$)', 'i'),
}));
export function identify(ua) {
  return rules.find(rule => rule.match.test(ua));
}
const logLine = /^(\S+)\s+\[([^\]]+)\]\s+"(\S+) (\S+) HTTP\/[\d.]+"\s+(\d{3})\s+(?:\d+|-)\s+"([^"]*)"\s+"([^"]*)"\s*$/;
const publicPage = /^\/(?:index\.html|(?:work(?:\/[a-z0-9-]+)?|archive)(?:\/(?:index\.html)?)?)?$/;
export function readLog(lines, verified = () => false) {
  let parsed = 0;
  const grouped = new Map();
  for (const line of lines) {
    if (typeof line !== 'string') continue;
    const match = line.trim().match(logLine);
    if (!match) continue;
    parsed++;
    const [, ip, time, method, target, status, host, ua] = match;
    if (!/^(?:www\.)?pnemchenko\.ru$/i.test(host) || method !== 'GET' || !['200','304'].includes(status)) continue;
    if (/PortfolioAnalyticsCheck\//.test(ua)) continue;
    const path = target.split(/[?#]/, 1)[0];
    if (!publicPage.test(path)) continue;
    const agent = identify(ua);
    if (!agent) continue;
    // Панель Timeweb выводит дату в МСК; явный часовой пояс имеет приоритет.
    const iso = time.replace(' ', 'T');
    const at = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + '+03:00');
    if (!Number.isFinite(at)) continue;
    const page = path.replace(/(?:\/index\.html|\/)$/, '') + '/';
    const confirmed = verified(agent, ip);
    const key = [at, page, agent.name, confirmed].join('|');
    const item = grouped.get(key) || { at, page, agent: agent.name, confirmed, count: 0 };
    item.count++;
    grouped.set(key, item);
  }
  return { parsed, rows: [...grouped.values()].sort((a,b) => b.at-a.at) };
}
