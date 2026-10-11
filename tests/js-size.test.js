// Бюджет JS сайта (CLAUDE.md, правило 3, D72): не больше ~30 КБ в сжатом виде.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('../site/', import.meta.url).pathname;
function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* jsFiles(path);
    else if (name.endsWith('.js')) yield path;
  }
}

test('весь JS сайта в сжатом виде не больше 30 КБ', () => {
  const all = [...jsFiles(root)].map(p => readFileSync(p)).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0));
  const gz = gzipSync(all, { level: 9 }).length;
  assert.ok(gz <= 30 * 1024, `JS сайта: ${gz} байт со сжатием (${all.length} без сжатия)`);
});
