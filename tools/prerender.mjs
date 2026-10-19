// Страницы для поисковиков: главная, каталог, каждый кейс, архив, «нет такой страницы» (404.html) и карта сайта (sitemap.xml).
// Собираются из index.html и содержимого (content/*.json) — так же, как это делает админка при каждой публикации.
// Нужен после правок index.html (стили, скрипты, разметка): иначе страницы кейсов останутся со старой разметкой
// до ближайшей публикации из админки.
//
// Запуск из папки сайта:  node tools/prerender.mjs          собрать и записать
//                         node tools/prerender.mjs --check  только проверить, что всё собрано (ничего не пишет)
import { readFile, writeFile, mkdir, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPages, sitemapFor, readSitemap, originOf, isPageFile } from '../js/seo.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const read = (p) => readFile(join(root, p), 'utf8').catch(() => null);

const template = await read('index.html');
const site = JSON.parse(await read('content/site.json'));
const { projects } = JSON.parse(await read('content/projects.json'));
const origin = originOf(await read('CNAME'));

const pages = buildPages({ template, site, projects, origin });
const before = new Map();
for (const p of pages) before.set(p.path, await read(p.path));
const changed = (path) => before.get(path) !== pages.find((p) => p.path === path).text;
const prevMap = readSitemap(await read('sitemap.xml'));
const sitemap = sitemapFor(pages, prevMap, changed);

// прежние страницы кейсов, которых больше нет (кейс удалили или сняли с сайта)
const stale = [];
const want = new Set(pages.map((p) => p.path));
for (const name of await readdir(join(root, 'work')).catch(() => [])) {
  const path = `work/${name}/index.html`;
  if (isPageFile(path) && !want.has(path) && await stat(join(root, path)).then(() => true, () => false)) stale.push(path);
}
if (!want.has('archive/index.html') && await read('archive/index.html') !== null) stale.push('archive/index.html');

const todo = pages.filter((p) => changed(p.path));
const mapChanged = (await read('sitemap.xml')) !== sitemap;
if (check) {
  const bad = [...todo.map((p) => p.path), ...(mapChanged ? ['sitemap.xml'] : []), ...stale.map((p) => `${p} (лишняя)`)];
  if (bad.length) { console.log(`Не собраны: ${bad.join(', ')}\nЗапустите: node tools/prerender.mjs`); process.exit(1); }
  console.log(`Страницы собраны: ${pages.length}, карта сайта на месте.`);
  process.exit(0);
}
for (const p of todo) {
  await mkdir(dirname(join(root, p.path)), { recursive: true });
  await writeFile(join(root, p.path), p.text);
}
if (mapChanged) await writeFile(join(root, 'sitemap.xml'), sitemap);
for (const path of stale) { await rm(join(root, path), { force: true }); await rmdir(join(root, dirname(path))).catch(() => {}); }
console.log(`Страниц: ${pages.length}, обновлено: ${todo.length}${mapChanged ? ', карта сайта обновлена' : ''}${stale.length ? `, убрано: ${stale.join(', ')}` : ''}.`);
for (const p of pages) console.log(`  ${p.index ? '✓' : '·'} ${p.url || '(404)'}  →  ${p.path}`);
