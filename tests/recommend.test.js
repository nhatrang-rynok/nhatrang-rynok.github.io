import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relatedForProduct } from '../site/js/recommend.js';

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
