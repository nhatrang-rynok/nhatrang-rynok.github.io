import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relatedForProduct, suggestForCart } from '../site/js/recommend.js';

const catalog = JSON.parse(readFileSync(new URL('../site/data/catalog.sample.json', import.meta.url), 'utf8'));
const get = id => catalog.products.find(p => p.id === id);

test('сначала rel, без самого товара и без дублей', () => {
  const list = relatedForProduct(get('fr-001'), catalog);
  assert.deepEqual(list.slice(0, 2).map(p => p.id), ['fr-002', 'fr-008']);
  assert.ok(!list.some(p => p.id === 'fr-001'));
  assert.equal(new Set(list.map(p => p.id)).size, list.length);
});

test('«сезон закончился» не рекомендуем', () => {
  const list = relatedForProduct(get('fr-006'), catalog, 20);
  assert.ok(!list.some(p => p.stock === 'out'));
});

test('добирает популярным и категорией до лимита', () => {
  const list = relatedForProduct(get('fr-010'), catalog, 6);
  assert.equal(list.length, 6);
  assert.equal(list[0].id, 'fr-006');
});

test('лимит соблюдается', () => {
  assert.equal(relatedForProduct(get('fr-001'), catalog, 3).length, 3);
});

test('корзина: сначала сопутствующие, потом популярное, потом другие категории', () => {
  const list = suggestForCart({ 'fr-001': 1 }, catalog, 6).map(p => p.id);
  assert.deepEqual(list.slice(0, 2), ['fr-002', 'fr-008']);
  assert.ok(!list.includes('fr-001'));
  assert.equal(new Set(list).size, list.length);
  assert.equal(list.length, 6);
});

test('корзина: то, что уже выбрано, и «сезон закончился» не предлагаем', () => {
  const cart = { 'fr-001': 1, 'fr-002': 2, 'fr-008': 1 };
  const list = suggestForCart(cart, catalog, 20);
  for (const id of Object.keys(cart)) assert.ok(!list.some(p => p.id === id), `${id} уже в корзине`);
  assert.ok(!list.some(p => p.stock === 'out'));
});

test('корзина: если в корзине только фрукты, алкоголь попадает в предложения', () => {
  const list = suggestForCart({ 'fr-001': 1 }, catalog, 20);
  assert.ok(list.some(p => p.cat === 'alcohol'));
});

test('корзина: пустая корзина и неизвестные товары не ломают подбор', () => {
  assert.ok(suggestForCart({}, catalog, 3).length === 3);
  assert.ok(suggestForCart({ 'zz-999': 1 }, catalog, 3).length === 3);
  assert.equal(suggestForCart({ 'fr-001': 1 }, catalog, 2).length, 2);
});
