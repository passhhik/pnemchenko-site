import { agents, readLog } from '../server/polaroids/ai-traffic.mjs';

const stateText = {
  unconfigured: 'Автоматическая загрузка журнала пока не подключена.',
  unavailable: 'Timeweb сейчас не отдал журнал. Показаны доступные записи.',
  'no-log': 'В ответе Timeweb нет строк журнала доступа.',
  ok: 'Журнал Timeweb обновлён.',
};
const agentInfo = new Map(agents.map(([agent, service, kind]) => [agent, { service, kind }]));
let imported = [], importedAt = 0, cloud = [], state = 'unconfigured', message = '';
const cacheKey = 'ph:ai-log-v1';
try {
  const saved = JSON.parse(localStorage.getItem(cacheKey) || 'null');
  if (Array.isArray(saved?.rows)) { imported = saved.rows; importedAt = Number(saved.at) || 0; }
} catch { /* Browser storage is optional. */ }

// Merge overlapping snapshots, retaining the highest observed total and verified count.
function merge(...sources) {
  const out = new Map();
  for (const source of sources) {
    const snapshot = new Map();
    for (const { at, page, agent, count, confirmed } of source) {
      if (!agentInfo.has(agent) || !Number.isFinite(at) || !Number.isSafeInteger(count) || count <= 0) continue;
      const key = [at, page, agent].join('|');
      const row = snapshot.get(key) || { at, page, agent, count: 0, checked: 0 };
      row.count += count;
      if (confirmed) row.checked += count;
      snapshot.set(key, row);
    }
    for (const [key, row] of snapshot) {
      const prev = out.get(key);
      if (prev) { row.count = Math.max(row.count, prev.count); row.checked = Math.max(row.checked, prev.checked); }
      out.set(key, row);
    }
  }
  return [...out.values()].sort((a,b) => b.at-a.at);
}
export async function importAiFile(file) {
  try {
    if (!file || file.size > 32 * 1024 * 1024) throw Error('Выберите текстовый журнал объёмом до 32 МБ.');
    const { parsed, rows } = readLog((await file.text()).split(/\r?\n/));
    if (!parsed) throw Error('Не нашёл строк журнала доступа Timeweb. Выберите выгрузку из «Логов доступа».');
    imported = merge(imported, rows).slice(0, 10000).map(({at,page,agent,count}) => ({at,page,agent,count}));
    importedAt = Date.now();
    message = 'Журнал загружен.';
    try { localStorage.setItem(cacheKey, JSON.stringify({ at: importedAt, rows: imported })); }
    catch { message += ' Записи доступны до закрытия вкладки.'; }
  } catch (err) { message = err.message; }
}
export async function loadAi(api, key, days) {
  try {
    const res = await fetch(api + '?ai=1&days=' + days, {
      headers: { 'x-mod-key': key }, cache: 'no-store', credentials: 'omit'
    });
    if (!res.ok) throw Error();
    const result = await res.json();
    if (!Array.isArray(result.rows)) { cloud = []; state = 'unconfigured'; return; }
    cloud = result.rows; state = result.state;
  } catch { state = 'unavailable'; }
}
export function aiReportHTML(days, esc, when, caseName) {
  const since = days ? Date.now() - days * 864e5 : 0;
  const list = merge(imported, cloud).filter(row => row.at >= since);
  const table = (kind, empty) => {
    const rows = list.filter(row => agentInfo.get(row.agent).kind === kind);
    if (!rows.length) return '<p class="hint">' + empty + '</p>';
    return '<ul class="db-visits">' + rows.slice(0,100).map(row => {
      const slug = row.page.match(/^\/work\/([a-z0-9-]+)\/$/)?.[1];
      const name = slug ? caseName(slug) : ({ '/': 'Главная', '/work/': 'Все работы', '/archive/': 'Полароиды' }[row.page] || row.page);
      const proof = row.checked === row.count ? 'Источник подтверждён' : row.checked ? 'Подтверждено ' + row.checked + ' из ' + row.count : 'По названию клиента';
      return '<li class="db-visit"><span class="db-v-when">' + esc(when(row.at)) + '</span><span class="db-v-main"><b>'
        + esc(agentInfo.get(row.agent).service) + '</b> · ' + esc(name) + (row.count > 1 ? ' × ' + row.count : '')
        + '<span class="hint">' + esc(row.agent) + ' · ' + proof + '</span></span></li>';
    }).join('') + '</ul>' + (rows.length > 100 ? '<p class="hint">Показаны последние 100 записей.</p>' : '');
  };
  return '<section class="db-card db-card--wide"><h3>Обращения ИИ</h3><p class="hint">' + esc(stateText[state] || stateText.unavailable)
    + (importedAt ? ' Последний импорт в этом браузере — ' + esc(when(importedAt)) + '.' : '') + '</p>'
    + table('request', 'В доступных записях за этот период нет запросов распознанных ассистентов.')
    + '<details class="db-details"><summary>Автоматические обходы</summary>' + table('crawler','Распознанных обходов за период нет.') + '</details>'
    + '<details class="db-details"><summary>Загрузить журнал Timeweb</summary><p class="hint">Скачайте журнал из App Platform → Портфолио → Логи доступа. Файл обрабатывается в браузере. В нём сохранятся только сведения об обращениях ИИ без IP и параметров ссылок.</p>'
    + '<input type="file" aria-label="Журнал доступа Timeweb" data-ai-file accept=".txt,.log,text/plain"></details>'
    + (message ? '<p role="status" class="hint">' + esc(message) + '</p>' : '') + '</section>';
}
