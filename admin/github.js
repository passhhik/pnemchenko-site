// Публикация на сайт. Сайт лежит в репозитории на GitHub; хостинг (сейчас Timeweb Cloud, раньше — GitHub Pages) сам забирает
// оттуда каждый коммит в основную ветку и через минуту-две выкладывает его. Админка делает такой коммит сама —
// через GitHub API, прямо из браузера.
// Для этого нужен токен доступа (fine-grained, право Contents: Read and write на один этот репозиторий).
// Токен хранится только в этом браузере (localStorage) и уходит только на api.github.com.

export const DEFAULT_REPO = 'passhhik/pnemchenko-site';
const API = 'https://api.github.com';
const KEY = 'ph:github';
const MAX_FILE = 50e6;          // GitHub не принимает файлы тяжелее 100 МБ, а сайту и 50 — уже слишком

export class GhError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.name = 'GhError'; this.status = status; this.code = code; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; } },
  set(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (_) { /* хранилище недоступно — подключение проживёт до закрытия вкладки */ } },
};

// «Отпечаток» файла, каким его считает git: по нему видно, изменился ли файл, не скачивая его с сайта
export async function gitSha(bytes) {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  const d = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const toBase64 = (bytes) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(new Blob([bytes]));
});

function explain(status, text, method, cfg) {
  const repo = cfg ? `${cfg.owner}/${cfg.repo}` : '';
  if (status === 401) return new GhError('GitHub не принял токен: он просрочен, отозван или вставлен не полностью. Создайте новый токен и подключите сайт заново.', status, 'auth');
  if ((status === 403 || status === 429) && /rate limit|abuse|secondary/i.test(text)) return new GhError('GitHub временно ограничил запросы. Подождите несколько минут и попробуйте ещё раз.', status, 'rate');
  if (status === 403 || (status === 404 && method !== 'GET')) return new GhError(`У токена нет права записи в «${repo}». В настройках токена нужно: Repository access — этот репозиторий, Permissions → Contents — Read and write.`, status, 'perm');
  if (status === 404) return new GhError(`GitHub не нашёл «${repo}» или токену он не виден. Проверьте название и то, что токену открыт именно этот репозиторий.`, status, 'notfound');
  if (status === 409 || status === 422) return new GhError(`GitHub не принял изменения (${status}${text ? `: ${text}` : ''}).`, status, 'conflict');
  if (status >= 500) return new GhError(`GitHub сейчас не отвечает (ошибка ${status}). Попробуйте через минуту.`, status, 'server');
  return new GhError(`GitHub ответил ошибкой ${status}${text ? `: ${text}` : ''}.`, status, 'other');
}

export const gh = {
  cfg: null,                     // { token, owner, repo, branch } — подключённый сайт
  get on() { return !!this.cfg; },
  get name() { return this.cfg ? `${this.cfg.owner}/${this.cfg.repo}` : ''; },
  get secure() { return window.isSecureContext && !!(window.crypto && crypto.subtle); },   // https или localhost

  restore() {
    const v = store.get();
    this.cfg = v && v.token && v.owner && v.repo && v.branch && this.secure ? v : null;
    return this.on;
  },
  forget() { this.cfg = null; store.set(null); try { localStorage.removeItem(`${KEY}:base`); } catch (_) { /* noop */ } },

  // версия содержимого на сайте, которую этот браузер видел последней (открыл или опубликовал сам)
  get base() { try { const b = JSON.parse(localStorage.getItem(`${KEY}:base`) || 'null'); return b && b.repo === this.name ? b : null; } catch (_) { return null; } },
  set base(v) { try { localStorage.setItem(`${KEY}:base`, JSON.stringify({ ...v, repo: this.name })); } catch (_) { /* noop */ } },

  async req(method, path, body, { raw = false, cfg = this.cfg } = {}) {
    let res;
    try {
      res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}${path}`, {
        method,
        // no-store: ответы GitHub живут в кэше браузера минуту, а нам нужна ветка «как есть прямо сейчас»
        cache: 'no-store',
        headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', Authorization: `Bearer ${cfg.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_) { throw new GhError('Нет связи с GitHub. Проверьте интернет и попробуйте ещё раз.', 0, 'network'); }
    if (res.ok) return raw ? res : (res.status === 204 ? null : res.json());
    let text = '';
    try { text = (await res.json()).message || ''; } catch (_) { /* не JSON */ }
    throw explain(res.status, text, method, cfg);
  },

  // Проверяет токен и право записи, запоминает подключение. repo — «владелец/репозиторий» или ссылка на него.
  async connect(token, repo) {
    if (!this.secure) throw new GhError('Подключать сайт можно только по защищённому адресу (https) или с этого компьютера.', 0, 'insecure');
    const m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(repo || '').trim());
    if (!m) throw new GhError('Репозиторий записывается как «владелец/название», например passhhik/pnemchenko-site.', 0, 'input');
    const tk = String(token || '').trim();
    if (!tk) throw new GhError('Вставьте токен.', 0, 'input');
    const cfg = { token: tk, owner: m[1], repo: m[2], branch: '' };
    const info = await this.req('GET', '', null, { cfg });
    cfg.branch = info.default_branch || 'main';
    // право записи проверяем делом: кладём в репозиторий крошечный «ничей» файл — он нигде не виден и сам исчезнет
    await this.req('POST', '/git/blobs', { content: 'ok', encoding: 'utf-8' }, { cfg });
    this.cfg = cfg;
    store.set(cfg);
    return cfg;
  },

  // Снимок ветки: последний коммит и все файлы в нём (путь → отпечаток)
  async snapshot() {
    const { branch } = this.cfg;
    const ref = await this.req('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
    const commit = await this.req('GET', `/git/commits/${ref.object.sha}`);
    const tree = await this.req('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
    const files = new Map();
    for (const e of tree.tree || []) if (e.type === 'blob') files.set(e.path, e.sha);
    // адрес сайта: свой домен записан в файле CNAME, иначе это стандартный адрес GitHub Pages
    const cname = files.get('CNAME');
    if (this.cfg.cname !== (cname || '')) {
      let host = '';
      if (cname) { try { host = (await (await this.req('GET', `/git/blobs/${cname}`, null, { raw: true })).text()).trim().split(/\s+/)[0] || ''; } catch (_) { /* адрес не узнали — не страшно */ } }
      this.cfg.cname = cname || ''; this.cfg.host = /^[a-z0-9.-]+$/i.test(host) ? host : '';
      store.set(this.cfg);
    }
    this.files = files;                    // путь → отпечаток: по нему админка достаёт картинку прямо из репозитория (см. blobUrl)
    return { sha: ref.object.sha, treeSha: commit.tree.sha, files };
  },
  // Где смотреть опубликованный сайт: свой домен (он записан в файле CNAME) или стандартный адрес GitHub Pages
  get siteUrl() {
    const c = this.cfg;
    if (!c) return '';
    return c.host ? `https://${c.host}/` : `https://${c.owner}.github.io/${c.repo}/`;
  },
  async readJSON(sha) { return (await this.req('GET', `/git/blobs/${sha}`, null, { raw: true })).json(); },
  async readBlob(sha) { return (await this.req('GET', `/git/blobs/${sha}`, null, { raw: true })).blob(); },
  // Картинка из репозитория — адресом для показа в админке. Годится и для закрытого репозитория (в отличие от rawUrl).
  async blobUrl(path) {
    const sha = this.files && this.files.get(path);
    if (!sha) return '';
    try { return URL.createObjectURL(await this.readBlob(sha)); } catch (_) { return ''; }
  },
  rawUrl(path) { const c = this.cfg; return `https://raw.githubusercontent.com/${c.owner}/${c.repo}/${encodeURIComponent(c.branch)}/${path.split('/').map(encodeURIComponent).join('/')}`; },

  // Один коммит с файлами [{ path, bytes }]. Отправляются только те, что отличаются от лежащих на сайте.
  // check(snapshot) — последняя проверка перед записью: вернёт false — публикация отменяется.
  // Возвращает { sha, changed: [пути] }; changed пуст — на сайте уже всё то же самое, коммита не было.
  async commit(files, { message, onProgress = () => {}, check = null } = {}) {
    for (const f of files) if (f.bytes.length > MAX_FILE) throw new GhError(`Файл «${f.path.split('/').pop()}» весит ${(f.bytes.length / 1e6).toFixed(0)} МБ — для сайта это слишком много. Сожмите его до 15–20 МБ и добавьте заново.`, 0, 'size');
    let snap = await this.snapshot();
    if (check && !(await check(snap))) return { sha: snap.sha, changed: [], cancelled: true };
    const todo = [];
    for (const f of files) { f.sha = f.sha || await gitSha(f.bytes); if (snap.files.get(f.path) !== f.sha) todo.push(f); }
    if (!todo.length) return { sha: snap.sha, changed: [] };
    let n = 0;
    onProgress(n, todo.length);
    for (const f of todo) {
      const made = await this.req('POST', '/git/blobs', { content: await toBase64(f.bytes), encoding: 'base64' });
      f.sha = made.sha;
      onProgress(++n, todo.length);
    }
    for (let attempt = 0; ; attempt++) {
      const tree = await this.req('POST', '/git/trees', { base_tree: snap.treeSha, tree: todo.map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: f.sha })) });
      const commit = await this.req('POST', '/git/commits', { message, tree: tree.sha, parents: [snap.sha] });
      try {
        await this.req('PATCH', `/git/refs/heads/${encodeURIComponent(this.cfg.branch)}`, { sha: commit.sha, force: false });
        return { sha: commit.sha, changed: todo.map((f) => f.path) };
      } catch (e) {
        // пока мы отправляли файлы, в ветке появился чужой коммит (например, правки кода) — строим свой поверх него
        if (e.code !== 'conflict' || attempt >= 2) throw e.code === 'conflict' ? new GhError('Не получилось: на сайте в эту минуту появились другие изменения. Нажмите «Опубликовать» ещё раз.', e.status, 'conflict') : e;
        snap = await this.snapshot();
      }
    }
  },

  // Ждёт, пока GitHub Pages выложит коммит. 'done' — правки на сайте, 'failed' — сборка упала,
  // 'unknown' — узнать не удалось (тогда сайт, скорее всего, обновится сам через пару минут).
  // Нужна только когда админка открыта с компьютера (localhost): на самом сайте она спрашивает сайт — см. liveHas в admin.js.
  async deployed(sha, { timeout = 240000, every = 5000 } = {}) {
    const t0 = Date.now();
    let id = null, errors = 0;
    while (Date.now() - t0 < timeout) {
      await sleep(every);
      try {
        if (!id) { const list = await this.req('GET', `/deployments?sha=${sha}&per_page=5`); id = list.length ? list[0].id : null; }
        if (id) {
          const st = await this.req('GET', `/deployments/${id}/statuses?per_page=1`);
          const state = st[0] && st[0].state;
          if (state === 'success') return 'done';
          if (state === 'failure' || state === 'error') return 'failed';
        } else if (Date.now() - t0 > 90000) return 'unknown';
      } catch (e) { if (e.code !== 'network' && ++errors > 2) return 'unknown'; }
    }
    return 'unknown';
  },
};
