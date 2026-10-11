import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, formatUnitPrice, formatQty, shortUnit, plural, formatItemsCount, imageSrc, whatsappUrl, telegramUrl, telUrl } from '../site/js/format.js';

const NB = ' ';

test('цена: ≈, неразрывные пробелы, тысячи', () => {
  assert.equal(formatPrice(830), `≈${NB}830${NB}₽`);
  assert.equal(formatPrice(2450), `≈${NB}2${NB}450${NB}₽`);
  assert.equal(formatPrice(1234567), `≈${NB}1${NB}234${NB}567${NB}₽`);
  assert.equal(formatPrice(99.6), `≈${NB}100${NB}₽`);
});

test('цена за единицу', () => {
  assert.equal(formatUnitPrice(290, 'кг'), `≈${NB}290${NB}₽ / кг`);
  assert.equal(formatUnitPrice(750, 'бут. 0,7 л'), `≈${NB}750${NB}₽ / бут. 0,7 л`);
});

test('количество с запятой', () => {
  assert.equal(formatQty(1.5, 'кг'), `1,5${NB}кг`);
  assert.equal(formatQty(2, 'шт'), `2${NB}шт`);
  assert.equal(formatQty(0.1 + 0.2, 'кг'), `0,3${NB}кг`);
  assert.equal(formatQty(1, 'бут. 0,7 л'), `1${NB}бут.`);
});

test('короткая единица', () => {
  assert.equal(shortUnit('кг'), 'кг');
  assert.equal(shortUnit('шт'), 'шт');
  assert.equal(shortUnit('бут. 0,7 л'), 'бут.');
  assert.equal(shortUnit('упак. 500 г'), 'упак.');
  assert.equal(shortUnit('500 г'), '500 г');
});

test('склонение', () => {
  const f = ['товар', 'товара', 'товаров'];
  const expected = { 0: 'товаров', 1: 'товар', 2: 'товара', 4: 'товара', 5: 'товаров', 11: 'товаров', 12: 'товаров', 14: 'товаров', 21: 'товар', 22: 'товара', 25: 'товаров', 101: 'товар', 111: 'товаров' };
  for (const [n, word] of Object.entries(expected)) assert.equal(plural(Number(n), f), word, `n=${n}`);
  assert.equal(formatItemsCount(3), `3${NB}товара`);
});

test('адрес картинки', () => {
  assert.equal(imageSrc('', 400), 'img/placeholder.svg');
  assert.equal(imageSrc('https://lh3.googleusercontent.com/d/ABC', 400), 'https://lh3.googleusercontent.com/d/ABC=w400');
  assert.equal(imageSrc('https://lh3.googleusercontent.com/d/ABC=w100', 900), 'https://lh3.googleusercontent.com/d/ABC=w100');
  assert.equal(imageSrc('https://example.com/a.jpg', 400), 'https://example.com/a.jpg');
});

test('ссылки связи очищаются', () => {
  assert.equal(whatsappUrl('+84 (000) 000-000'), 'https://wa.me/84000000000');
  assert.equal(whatsappUrl('84000000000', 'Привет & пока'), 'https://wa.me/84000000000?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%26%20%D0%BF%D0%BE%D0%BA%D0%B0');
  assert.equal(telegramUrl('@primer_operator'), 'https://t.me/primer_operator');
  assert.equal(telegramUrl('a/b"><x'), 'https://t.me/abx');
  assert.equal(telUrl('+84 000 000 000'), 'tel:+84000000000');
});
