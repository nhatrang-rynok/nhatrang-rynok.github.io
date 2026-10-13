import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, formatUnitPrice, formatQty, shortUnit, plural, formatItemsCount, imageSrc, whatsappUrl, telegramUrl, whatsappAppUrl, telegramAppUrl, formatVnd, formatUsd, formatWeight, pieceLine, formatAltPrices } from '../site/js/format.js';

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
  assert.equal(whatsappAppUrl('+84 000 000 000', 'Привет\nмир'), 'whatsapp://send?phone=84000000000&text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%0A%D0%BC%D0%B8%D1%80');
  assert.equal(whatsappAppUrl('84000000000'), 'whatsapp://send?phone=84000000000');
  assert.equal(telegramAppUrl('@primer_operator'), 'tg://resolve?domain=primer_operator');
  assert.equal(telegramAppUrl('a/b"><x'), 'tg://resolve?domain=abx');
});

test('донги, доллары, вес', () => {
  assert.equal(formatVnd(300000), `300.000${NB}₫`);
  assert.equal(formatVnd(84000), `84.000${NB}₫`);
  assert.equal(formatVnd(950), `950${NB}₫`);
  assert.equal(formatVnd(1234567), `1.234.567${NB}₫`);
  assert.equal(formatUsd(3.36), '$3,36');
  assert.equal(formatUsd(12), '$12');
  assert.equal(formatUsd(125.4), '$125');
  assert.equal(formatUsd(0.5), '$0,50');
  assert.equal(formatWeight(200), `200${NB}г`);
  assert.equal(formatWeight(1000), `1${NB}кг`);
  assert.equal(formatWeight(1200), `1,2${NB}кг`);
});

test('строка «1 шт. = 200 г = 300.000 ₫»: на развес и поштучно', () => {
  // Цена за кг: вес штуки × цена за килограмм
  assert.equal(pieceLine({ unit: 'кг', vnd: 84000, pw: 200 }), `1${NB}шт. = 200${NB}г = 16.800${NB}₫`);
  assert.equal(pieceLine({ unit: 'кг', vnd: 90000, pw: 10 }), `1${NB}шт. = 10${NB}г = 900${NB}₫`);
  // Цена за штуку: она и есть цена штуки
  assert.equal(pieceLine({ unit: 'шт', vnd: 48000, pw: 1200 }), `1${NB}шт. = 1,2${NB}кг = 48.000${NB}₫`);
  assert.equal(pieceLine({ unit: 'шт', vnd: 300000, pw: 200 }), `1${NB}шт. = 200${NB}г = 300.000${NB}₫`);
  // Нет веса, нет цены в донгах или единица другая — строки нет
  assert.equal(pieceLine({ unit: 'кг', vnd: 84000, pw: 0 }), '');
  assert.equal(pieceLine({ unit: 'кг', vnd: 0, pw: 200 }), '');
  assert.equal(pieceLine({ unit: 'бут. 0,7 л', vnd: 195000, pw: 900 }), '');
  assert.equal(pieceLine({ unit: 'кг' }), '');
});

test('цены в долларах и донгах для карточки товара', () => {
  assert.equal(formatAltPrices({ unit: 'кг', usd: 3.36, vnd: 84000 }), `$3,36 · 84.000${NB}₫ / кг`);
  assert.equal(formatAltPrices({ unit: 'шт', usd: 0, vnd: 48000 }), `48.000${NB}₫ / шт`);
  assert.equal(formatAltPrices({ unit: 'шт' }), '');
});
