// Помощники для сквозных проверок в браузере: статический сервер и запуск Chromium.
// Запуск: node tests/e2e/<имя>.e2e.mjs [папка для скриншотов]
// Не входит в `node --test` (имена *.e2e.mjs), потому что нужен Playwright.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = fileURLToPath(new URL('../../site/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function startServer() {
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = normalize(join(SITE, path === '/' ? 'index.html' : path));
    if (!file.startsWith(SITE)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/` })));
}

export async function launch() {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    playwright = createRequire('/opt/node-tools/node_modules/')('playwright');
  }
  const { chromium } = playwright.chromium ? playwright : playwright.default;
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
}

let failed = 0;
export function check(cond, message) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${message}`);
  if (!cond) failed++;
}
export const failures = () => failed;
