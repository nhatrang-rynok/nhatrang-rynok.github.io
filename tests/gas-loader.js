// Загрузка файлов Apps Script (.gs) в изолированный контекст Node, как в редакторе Google:
// все файлы делят одну глобальную область (повторное объявление имени — ошибка, как и там).
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export function loadGas(files = ['Logic.gs'], globals = {}) {
  const ctx = vm.createContext({ console, ...globals });
  for (const file of files) {
    vm.runInContext(readFileSync(new URL(`../apps-script/${file}`, import.meta.url), 'utf8'), ctx, { filename: file });
  }
  ctx.run = code => vm.runInContext(code, ctx);
  return ctx;
}

// Объекты из другого контекста отличаются прототипами, поэтому для сравнения приводим их к обычным
export const plain = value => JSON.parse(JSON.stringify(value ?? null));

// Разбор CSV (RFC 4180): кавычки, запятые и переводы строк внутри ячеек
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
