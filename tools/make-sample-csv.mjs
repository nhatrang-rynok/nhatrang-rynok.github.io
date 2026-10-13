// Делает content/descriptions/sample-products.csv из site/data/catalog.sample.json:
// те же товары в колонках листа «Товары», чтобы импортировать их в таблицу (docs/08-deploy-apps-script.md).
// Фрукты записываются в донгах (рубли считает сервер по курсу 300), ром — сразу в рублях.
// Запуск: node tools/make-sample-csv.mjs   (после изменения заглушки каталога; тест проверит согласованность)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('apps-script/Logic.gs', root), 'utf8'), ctx);
const headers = vm.runInContext('HEADERS_.products', ctx);
const catalog = JSON.parse(readFileSync(new URL('site/data/catalog.sample.json', root), 'utf8'));

const STOCK = { in: 'В наличии', preorder: 'Под заказ', out: 'Сезон закончился' };
const RATE = 300;
const csvCell = v => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = catalog.products.map(p => {
  const inVnd = p.cat === 'fruits';
  const values = {
    'ID': p.id, 'Показывать': 'TRUE', 'Категория': p.cat, 'Название': p.name, 'Коротко': p.short, 'Описание': p.desc,
    'Цена ₫': inVnd ? p.price * RATE : '', 'Цена ₽': inVnd ? '' : p.price,
    'Единица': p.unit, 'Шаг': p.step, 'Минимум': p.min, 'Вес 1 шт., г': p.pw || '', 'Фото': '', 'Предупреждения': p.warn, 'Где куплено': p.src,
    '18+': p.adult ? 'TRUE' : 'FALSE', 'Хит': catalog.popular.includes(p.id) ? 'TRUE' : 'FALSE',
    'Похожие': p.rel.join(', '), 'Наличие': STOCK[p.stock], 'Порядок': p.sort, 'Обновлено': '',
  };
  return headers.map(h => csvCell(values[h] ?? '')).join(',');
});

mkdirSync(new URL('content/descriptions/', root), { recursive: true });
writeFileSync(new URL('content/descriptions/sample-products.csv', root), `${headers.map(csvCell).join(",")}\n${rows.join('\n')}\n`, 'utf8');
console.log(`готово: content/descriptions/sample-products.csv (${rows.length} товаров)`);
