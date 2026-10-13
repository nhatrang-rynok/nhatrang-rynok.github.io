// Проверяет, что site/data/catalog.sample.json соответствует контракту GET ?action=catalog (docs/05-api.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../site/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('data/catalog.sample.json', root), 'utf8'));

const STOCK = ['in', 'preorder', 'out'];
const isStr = v => typeof v === 'string';
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const catIds = new Set(catalog.categories.map(c => c.id));
const byId = new Map(catalog.products.map(p => [p.id, p]));

test('верхний уровень', () => {
  assert.equal(catalog.ok, true);
  assert.ok(isStr(catalog.version) && catalog.version.length > 0, 'version');
  assert.ok(!Number.isNaN(Date.parse(catalog.generatedAt)), 'generatedAt — дата');
  for (const key of ['settings', 'categories', 'products', 'popular']) assert.ok(key in catalog, key);
  assert.ok(Array.isArray(catalog.categories) && Array.isArray(catalog.products) && Array.isArray(catalog.popular));
});

test('настройки: публичные ключи и заглушки контактов', () => {
  const s = catalog.settings;
  for (const key of ['site_title', 'phone', 'whatsapp', 'telegram', 'announcement', 'terms', 'done_text']) {
    assert.ok(isStr(s[key]), `${key} — строка`);
  }
  assert.equal(typeof s.orders_enabled, 'boolean');
  assert.equal(typeof s.log_events, 'boolean');
  assert.equal(s.phone, '+84 000 000 000');
  assert.match(s.whatsapp, /^\d+$/, 'whatsapp — только цифры');
  assert.equal(s.whatsapp, '84000000000');
  assert.equal(s.telegram, 'primer_operator');
  assert.ok(s.done_text.length > 0);
  // Секретные настройки наружу не отдаются
  for (const secret of ['rate_vnd_per_rub', 'rate_vnd_per_usd', 'rub_rounding', 'popular_days', 'popular_count']) {
    assert.ok(!(secret in s), `${secret} не должен попадать на сайт`);
  }
});

test('категории', () => {
  assert.ok(catalog.categories.length >= 2);
  assert.equal(catIds.size, catalog.categories.length, 'ID категорий уникальны');
  for (const c of catalog.categories) {
    assert.match(c.id, /^[a-z0-9-]+$/);
    assert.ok(isStr(c.name) && c.name.length > 0);
    assert.ok(isStr(c.icon) && isStr(c.note) && isNum(c.sort));
  }
  for (const id of ['fruits', 'alcohol']) assert.ok(catIds.has(id), `есть категория ${id}`);
  for (const id of catIds) {
    assert.ok(catalog.products.some(p => p.cat === id), `в категории ${id} есть товары`);
  }
});

test('товары: 10–15 штук, уникальные ID по шаблону', () => {
  assert.ok(catalog.products.length >= 10 && catalog.products.length <= 15, `товаров: ${catalog.products.length}`);
  assert.equal(byId.size, catalog.products.length, 'ID уникальны');
});

test('товары: донги, доллары и вес штуки согласованы с рублёвой ценой и курсами 300 и 25 000', () => {
  for (const p of catalog.products) {
    assert.ok(isNum(p.vnd) && p.vnd > 0, `${p.id}: цена в донгах`);
    assert.ok(Math.abs(p.usd - Math.round(p.vnd / 25000 * 100) / 100) < 1e-9, `${p.id}: доллары = донги / 25 000`);
    assert.ok(Number.isInteger(p.pw) && p.pw >= 0, `${p.id}: вес штуки в граммах`);
    if (p.cat === 'fruits') assert.ok(p.pw > 0, `${p.id}: у фрукта указан вес штуки`);
  }
});

for (const p of catalog.products) {
  test(`товар ${p.id}`, () => {
    assert.match(p.id, /^[a-z0-9-]{2,20}$/);
    assert.ok(catIds.has(p.cat), 'категория существует');
    assert.ok(isStr(p.name) && p.name.length > 0 && p.name.length <= 60, 'name ≤ 60');
    assert.ok(isStr(p.short) && p.short.length <= 80, 'short ≤ 80');
    assert.ok(isStr(p.desc) && p.desc.length <= 600, 'desc ≤ 600');
    assert.ok(isNum(p.price) && p.price > 0, 'price > 0');
    assert.ok(isStr(p.unit) && p.unit.length > 0, 'unit');
    assert.ok(isNum(p.step) && p.step > 0, 'step > 0');
    assert.ok(isNum(p.min) && p.min >= p.step, 'min ≥ step');
    assert.ok(Math.abs(p.min / p.step - Math.round(p.min / p.step)) < 1e-9, 'min кратен step');
    assert.ok(isStr(p.img) && (p.img === '' || p.img.startsWith('https://')), 'img пустой или https');
    assert.ok(isStr(p.warn) && isStr(p.src));
    assert.equal(typeof p.adult, 'boolean');
    assert.ok(STOCK.includes(p.stock), 'stock');
    assert.ok(isNum(p.sort));
    assert.ok(Array.isArray(p.rel));
    for (const r of p.rel) {
      assert.ok(byId.has(r), `rel ${r} существует`);
      assert.notEqual(r, p.id, 'rel не ссылается на себя');
    }
    if (p.cat === 'alcohol') assert.equal(p.adult, true, 'алкоголь помечен 18+');
  });
}

test('«Самое популярное»: существующие товары, без дублей и без «сезон закончился»', () => {
  assert.equal(new Set(catalog.popular).size, catalog.popular.length);
  for (const id of catalog.popular) {
    assert.ok(byId.has(id), `${id} существует`);
    assert.notEqual(byId.get(id).stock, 'out', `${id} не закончился`);
  }
});

test('в заглушке есть все особые случаи для проверки вёрстки', () => {
  assert.ok(catalog.products.some(p => p.adult), 'есть товар 18+');
  assert.ok(catalog.products.some(p => p.stock === 'out'), 'есть товар «сезон закончился»');
  assert.ok(catalog.products.some(p => p.stock === 'preorder'), 'есть товар «под заказ»');
  assert.ok(catalog.products.some(p => p.step === 0.5), 'есть товар с шагом 0.5');
  assert.ok(catalog.products.some(p => p.min > p.step), 'есть товар с минимумом больше шага');
  assert.ok(catalog.products.some(p => p.warn !== ''), 'есть товар с предупреждением');
  assert.ok(catalog.products.some(p => p.warn === ''), 'есть товар без предупреждения');
});

test('placeholder.svg на месте', () => {
  const file = new URL('img/placeholder.svg', root);
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, 'utf8'), /<svg[\s>]/);
});
