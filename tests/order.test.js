import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePhone, checkPhone, validateOrderForm, splitCart, buildOrderPayload, buildOrderText, LIMITS } from '../site/js/order.js';

const catalog = JSON.parse(readFileSync(new URL('../site/data/catalog.sample.json', import.meta.url), 'utf8'));
const products = new Map(catalog.products.map(p => [p.id, p]));

test('телефон: разные способы записи', () => {
  assert.equal(normalizePhone('+7 (000) 000-00-00'), '+70000000000');
  assert.equal(normalizePhone('8 000 000 00 00'), '+70000000000');
  assert.equal(normalizePhone('70000000000'), '+70000000000');
  assert.equal(normalizePhone('+84 000 000 000'), '+84000000000');
  assert.equal(normalizePhone('0084 000 000 000'), '+84000000000');
  assert.equal(normalizePhone('  '), '');
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone('тел: +7-000-000-00-00 вечером'), '+70000000000');
});

test('телефон: проверка', () => {
  assert.equal(checkPhone('+7 000 000-00-00').ok, true);
  assert.equal(checkPhone('+84 000 000 000').ok, true);
  assert.equal(checkPhone('').error, 'Введите номер телефона');
  assert.equal(checkPhone('abc').ok, false);
  assert.equal(checkPhone('+7 000').ok, false, 'слишком короткий');
  assert.equal(checkPhone('+7000000000000000').ok, false, 'слишком длинный');
  const noCode = checkPhone('999 000 00 00');
  assert.equal(noCode.ok, false);
  assert.match(noCode.error, /код страны/);
  assert.equal(checkPhone('+999 000 00 00').ok, true, 'с плюсом правило про 10 цифр не действует');
});

test('форма: ошибки и очистка значений', () => {
  const bad = validateOrderForm({ phone: '12', messenger: 'whatsapp' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.phone);

  const ok = validateOrderForm({
    phone: '8 000 000 00 00', messenger: 'viber', name: `  ${'я'.repeat(80)} `, room: ' 512 ', comment: 'Манго\nпоспелее\u0000!', adultConfirmed: false,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.values.phone, '+70000000000');
  assert.equal(ok.values.messenger, 'whatsapp', 'неизвестный способ связи заменяется');
  assert.equal(ok.values.name.length, LIMITS.name);
  assert.equal(ok.values.room, '512');
  assert.equal(ok.values.comment, 'Манго\nпоспелее !', 'переносы строк в комментарии сохраняются');
});

test('форма: 18+ обязательна, только если в корзине алкоголь', () => {
  const fields = { phone: '+84 000 000 000', messenger: 'call' };
  assert.equal(validateOrderForm(fields, { needAdult: false }).ok, true);
  const need = validateOrderForm(fields, { needAdult: true });
  assert.equal(need.ok, false);
  assert.ok(need.errors.adult);
  assert.equal(validateOrderForm({ ...fields, adultConfirmed: true }, { needAdult: true }).ok, true);
});

test('корзина: доступные, недоступные, итог, 18+', () => {
  const cart = { 'fr-001': 1.5, 'fr-008': 2, 'fr-010': 1, 'zz-999': 1 };
  const s = splitCart(cart, products);
  assert.deepEqual(s.available.map(l => l.product.id), ['fr-001', 'fr-008']);
  assert.deepEqual(s.unavailable.map(u => u.id), ['fr-010', 'zz-999']);
  assert.equal(s.unavailable[0].product.name, 'Дуриан');
  assert.equal(s.unavailable[1].product, null);
  assert.equal(s.total, 1.5 * 280 + 2 * 220);
  assert.equal(s.hasAdult, false);
  assert.equal(splitCart({ 'al-001': 1 }, products).hasAdult, true);
  assert.equal(splitCart({ 'fr-001': 1 }, null).available.length, 0);
});

test('тело запроса соответствует контракту', () => {
  const { available, total } = splitCart({ 'fr-001': 1.5, 'al-001': 1 }, products);
  const values = validateOrderForm({ phone: '+84 000 000 000', messenger: 'telegram', name: 'Ольга', room: '512', comment: 'Тест', adultConfirmed: true }, { needAdult: true }).values;
  const payload = buildOrderPayload({ values, lines: available, total, clientOrderId: 'id-1', catalogVersion: 'v1' });
  assert.deepEqual(payload, {
    action: 'order', clientOrderId: 'id-1', phone: '+84000000000', messenger: 'telegram', name: 'Ольга', room: '512', comment: 'Тест',
    adultConfirmed: true, items: [{ id: 'fr-001', qty: 1.5 }, { id: 'al-001', qty: 1 }], clientTotal: 1170, catalogVersion: 'v1', website: '',
  });
  assert.equal(buildOrderPayload({ values, lines: available, total, clientOrderId: 'x', website: 'spam' }).website, 'spam');
});

test('текст заказа для WhatsApp', () => {
  const { available, total } = splitCart({ 'fr-001': 2, 'al-001': 1 }, products);
  const full = validateOrderForm({ phone: '+84 000 000 000', name: 'Ольга', room: '512', comment: 'Манго поспелее', adultConfirmed: true }).values;
  assert.equal(buildOrderText({ lines: available, total, values: full }), [
    'Здравствуйте! Хочу заказать:',
    '• Манго — 2 кг',
    '• Ром тёмный, 0,7 л — 1 бут.',
    'Итого ≈ 1 310 ₽',
    'Имя: Ольга',
    'Телефон: +84000000000',
    'Комната: 512',
    'Комментарий: Манго поспелее',
  ].join('\n'));
  const short = validateOrderForm({ phone: '+84 000 000 000' }).values;
  const text = buildOrderText({ lines: available, total, values: short });
  assert.ok(!text.includes('Имя:') && !text.includes('Комната:') && !text.includes('Комментарий:'));
  assert.ok(!text.includes(' '), 'неразрывных пробелов нет');
});
