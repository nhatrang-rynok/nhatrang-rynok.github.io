// Lighthouse (мобильный режим) по всем экранам сайта, по 3 прогона на экран, берётся средний.
// Lighthouse в репозиторий не входит. Один раз поставить в любую временную папку:
//   mkdir /tmp/lh && cd /tmp/lh && npm init -y && npm i lighthouse chrome-launcher axe-core
// Запуск:  LH_DIR=/tmp/lh node tools/run-lighthouse.mjs [папка для json-отчётов]
// Страницы проверяются с пустой корзиной; страницы с заполненной корзиной проверяет tools/run-axe.mjs.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startServer } from '../tests/e2e/helpers.mjs';

const dir = process.env.LH_DIR || process.cwd();
const load = async name => import(pathToFileURL(join(dir, 'node_modules', name, name === 'lighthouse' ? 'core/index.js' : 'dist/index.js')).href).catch(() => import(name));
const lighthouse = (await load('lighthouse')).default;
const chromeLauncher = await load('chrome-launcher');

const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const { server, base } = await startServer();
const chrome = await chromeLauncher.launch({ chromePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });
const pages = [['home', '#/'], ['category', '#/c/fruits'], ['product', '#/p/fr-001'], ['cart', '#/cart'], ['checkout', '#/checkout'], ['done', '#/done/N-0042']];
const score = (lhr, id) => Math.round((lhr.categories[id]?.score ?? 0) * 100);
const rows = [];
for (const [name, hash] of pages) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const { lhr } = await lighthouse(base + hash, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'] });
    runs.push(lhr);
  }
  const perf = [...runs.map(r => score(r, 'performance'))].sort((a, b) => a - b)[1];
  const mid = runs.find(r => score(r, 'performance') === perf);
  if (out) writeFileSync(join(out, `${name}.json`), JSON.stringify(mid));
  const metric = id => Math.round(mid.audits[id]?.numericValue ?? 0);
  rows.push({ экран: name, perf, a11y: Math.min(...runs.map(r => score(r, 'accessibility'))), bp: Math.min(...runs.map(r => score(r, 'best-practices'))), seo: Math.min(...runs.map(r => score(r, 'seo'))), fcp_мс: metric('first-contentful-paint'), lcp_мс: metric('largest-contentful-paint'), tbt_мс: metric('total-blocking-time'), cls: Number((mid.audits['cumulative-layout-shift']?.numericValue ?? 0).toFixed(3)) });
}
console.table(rows);
console.log('SEO ниже 100 из-за <meta name="robots" content="noindex"> (так задумано: сайт не должен попадать в поисковики).');
await chrome.kill();
server.close();
