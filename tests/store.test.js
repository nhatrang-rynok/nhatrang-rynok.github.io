import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextQty, minOf, getCart, getQty, setQty, changeQty, removeItem, clearCart, subscribe,
  cartSummary, readCatalogCache, writeCatalogCache, _resetForTests,
} from '../site/js/store.js';

beforeEach(() => _resetForTests());

const kg = { id: 'fr-001', price: 280, unit: 'кг', step: 0.5, min: 1, stock: 'in' };
const piece = { id: 'fr-008', price: 220, unit: 'шт', step: 1, min: 1, stock: 'in' };
const light = { id: 'fr-003', price: 380, unit: 'кг', step: 0.5, min: 0.5, stock: 'in' };

test('шаг и минимум', () => {
  assert.equal(minOf(kg), 1);
  assert.equal(minOf({ step: 0.5, min: 0 }), 0.5);
  assert.equal(minOf({}), 1);
});

test('«+»: первое нажатие даёт минимум, дальше шаг', () => {
  assert.equal(nextQty(kg, 0, 1), 1);
  assert.equal(nextQty(kg, 1, 1), 1.5);
  assert.equal(nextQty(piece, 3, 1), 4);
  assert.equal(nextQty(light, 0, 1), 0.5);
});

test('«−»: ниже минимума товар убирается', () => {
  assert.equal(nextQty(kg, 1.5, -1), 1);
  assert.equal(nextQty(kg, 1, -1), 0);
  assert.equal(nextQty(light, 1, -1), 0.5);
  assert.equal(nextQty(light, 0.5, -1), 0);
  assert.equal(nextQty(piece, 1, -1), 0);
});

test('предел количества и дробные ошибки', () => {
  assert.equal(nextQty(piece, 100, 1), 100);
  let q = 0;
  for (let i = 0; i < 10; i++) q = nextQty({ step: 0.1, min: 0.1 }, q, 1);
  assert.equal(q, 1);
});

test('корзина: добавление, изменение, удаление', () => {
  assert.deepEqual(getCart(), {});
  assert.equal(changeQty(kg, 1), 1);
  assert.equal(changeQty(kg, 1), 1.5);
  assert.equal(getQty('fr-001'), 1.5);
  changeQty(piece, 1);
  assert.deepEqual(getCart(), { 'fr-001': 1.5, 'fr-008': 1 });
  changeQty(kg, -1);
  changeQty(kg, -1);
  assert.equal(getQty('fr-001'), 0);
  assert.deepEqual(getCart(), { 'fr-008': 1 });
  removeItem('fr-008');
  assert.deepEqual(getCart(), {});
});

test('подписчики вызываются при изменении и отписка работает', () => {
  let calls = 0;
  const off = subscribe(() => { calls++; });
  setQty('a', 2);
  clearCart();
  assert.equal(calls, 2);
  off();
  setQty('a', 1);
  assert.equal(calls, 2);
});

test('getCart возвращает копию', () => {
  setQty('a', 1);
  getCart().a = 99;
  assert.equal(getQty('a'), 1);
});

test('сводка корзины: сумма, недоступные товары, каталог ещё не загружен', () => {
  const products = new Map([[kg.id, kg], [piece.id, piece], ['fr-010', { id: 'fr-010', price: 700, step: 0.5, min: 1, stock: 'out' }]]);
  const cart = { 'fr-001': 1.5, 'fr-008': 2, 'fr-010': 1, 'zz-999': 1 };
  const s = cartSummary(cart, products);
  assert.equal(s.lines, 4);
  assert.equal(s.total, 1.5 * 280 + 2 * 220);
  assert.deepEqual(s.unavailable, ['fr-010', 'zz-999']);
  assert.equal(s.priced, true);
  const empty = cartSummary(cart, null);
  assert.equal(empty.priced, false);
  assert.equal(empty.total, 0);
});

test('кэш каталога: свежий, старый, битый', () => {
  assert.equal(readCatalogCache(), null);
  const data = { ok: true, products: [], categories: [], settings: {} };
  writeCatalogCache(data, 1000);
  const fresh = readCatalogCache(1000 + 60_000);
  assert.deepEqual(fresh.data, data);
  assert.equal(fresh.stale, false);
  assert.equal(readCatalogCache(1000 + 8 * 24 * 3600 * 1000).stale, true);
});
