// Репозиторий публичный: токенов бота в нём быть не должно (CLAUDE.md, правило 5). Для тестов есть явно фиктивный токен 123456789:…
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const SKIP = new Set(['.git', 'node_modules']);
const TOKEN_RE = /\b\d{8,10}:[A-Za-z0-9_-]{30,}/g;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|mjs|gs|json|md|html|css|csv|yml|yaml|txt)$/.test(name)) yield path;
  }
}

test('в файлах репозитория нет настоящих токенов Telegram-бота', () => {
  const found = [];
  for (const path of files(root)) {
    for (const m of readFileSync(path, 'utf8').matchAll(TOKEN_RE)) {
      if (!m[0].startsWith('123456789:')) found.push(`${path.slice(root.length)}: ${m[0].slice(0, 12)}…`);
    }
  }
  assert.deepEqual(found, []);
});
