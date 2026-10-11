// Журнал посещений на стороне сайта: очередь событий, пачки, защита от лишнего (site/js/telemetry.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, describeClick, diffCart, randomId } from '../site/js/telemetry.js';

function make(overrides = {}) {
  const sent = [];
  const timers = [];
  let t = 1000;
  const tracker = createTracker({
    url: 'https://example.test/exec', visitorId: 'v-test-0123456789',
    post: (url, body, keepalive) => sent.push({ url, keepalive, body: JSON.parse(body) }),
    now: () => (t += 10), device: () => ({ ua: 'UA', w: 390, h: 844, lang: 'ru-RU' }),
    schedule: fn => { timers.push(fn); return timers.length; }, cancel: () => {},
    ...overrides,
  });
  return { tracker, sent, timers };
}

test('события уходят одной пачкой по таймеру', () => {
  const { tracker, sent, timers } = make();
  tracker.setScreen('home');
  tracker.track('visit', 'новый');
  tracker.track('click', 'кнопка «Фрукты»');
  assert.equal(sent.length, 0);
  assert.equal(timers.length, 1, 'таймер один на всю пачку');
  timers[0]();
  assert.equal(sent.length, 1);
  const { body } = sent[0];
  assert.equal(body.action, 'log');
  assert.equal(body.visitorId, 'v-test-0123456789');
  assert.deepEqual(body.device, { ua: 'UA', w: 390, h: 844, lang: 'ru-RU' });
  assert.deepEqual(body.events.map(e => [e.k, e.d, e.s]), [['visit', 'новый', 'home'], ['click', 'кнопка «Фрукты»', 'home']]);
  assert.ok(body.events[0].t < body.events[1].t && body.now > body.events[1].t);
});

test('flush(true) отправляет сразу с keepalive, пустую очередь не отправляет', () => {
  const { tracker, sent } = make();
  tracker.flush(true);
  assert.equal(sent.length, 0);
  tracker.track('session', 'ушёл');
  tracker.flush(true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].keepalive, true);
});

test('полная очередь отправляется сразу, подробности обрезаются, номер заказа добавляется', () => {
  const { tracker, sent } = make();
  for (let i = 0; i < 45; i++) tracker.track('view', 'x'.repeat(300), i === 44 ? 'N-0001' : '');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.events.length, 45);
  assert.equal(sent[0].body.events[0].d.length, 200);
  assert.equal(sent[0].body.events[44].o, 'N-0001');
  assert.equal('o' in sent[0].body.events[0], false);
});

test('выключено (нет адреса или log_events=выкл): ничего не копится и не отправляется', () => {
  const none = make({ url: '' });
  none.tracker.track('visit');
  none.tracker.flush();
  assert.equal(none.sent.length, 0);
  assert.equal(none.timers.length, 0);

  const { tracker, sent } = make();
  tracker.track('visit');
  tracker.setEnabled(false);
  tracker.track('click', 'после выключения');
  tracker.flush();
  assert.equal(sent.length, 0, 'то, что накопилось до выключения, тоже не уходит');
  tracker.setEnabled(true);
  tracker.track('visit');
  tracker.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.events.length, 1);
});

test('ошибок за визит записывается не больше пяти', () => {
  const { tracker, sent } = make();
  for (let i = 0; i < 20; i++) tracker.track('error', `ошибка ${i}`);
  tracker.flush();
  assert.equal(sent[0].body.events.length, 5);
});

test('diffCart: добавлено, изменено, убрано, очищено', () => {
  const name = id => ({ a: 'Манго', b: 'Ром' })[id];
  assert.deepEqual(diffCart({}, { a: 1.5 }, name), ['добавлен Манго: 1,5']);
  assert.deepEqual(diffCart({ a: 1.5 }, { a: 2 }, name), ['Манго: 1,5 → 2']);
  assert.deepEqual(diffCart({ a: 1, b: 1 }, { b: 1 }, name), ['убран Манго']);
  assert.deepEqual(diffCart({ a: 1 }, {}, name), ['убран Манго']);
  assert.deepEqual(diffCart({ a: 1, b: 1 }, {}, name), ['корзина очищена (позиций: 2)']);
  assert.deepEqual(diffCart({}, { z: 1 }), ['добавлен z: 1'], 'нет названия — пишем id');
  assert.deepEqual(diffCart({ a: 1 }, { a: 1 }, name), []);
});

// Заменитель элемента страницы: достаточно closest/getAttribute
const node = (tag, attrs = {}, text = '') => {
  const n = { tagName: tag, textContent: text, id: attrs.id || '', getAttribute: k => attrs[k] ?? null, closest: () => n };
  return n;
};

test('describeClick: подпись кнопки и ссылки без телефонов и номеров мессенджеров', () => {
  assert.equal(describeClick(node('BUTTON', {}, '  В корзину \n')), 'кнопка «В корзину»');
  assert.equal(describeClick(node('A', { href: '#/c/fruits' }, 'Фрукты')), 'ссылка «Фрукты» → #/c/fruits');
  assert.equal(describeClick(node('A', { href: 'tel:+84000000000' }, 'Позвонить +84 000 000 000')), 'ссылка «Позвонить [номер]» → звонок');
  assert.equal(describeClick(node('A', { href: 'tel:+84000000000' }, 'Позвонить')), 'ссылка «Позвонить» → звонок');
  assert.equal(describeClick(node('A', { href: 'https://wa.me/84000000000?text=abc' }, 'WhatsApp')), 'ссылка «WhatsApp» → wa.me');
  assert.equal(describeClick(node('BUTTON', { 'aria-label': 'Корзина, 2 товара' }, '2')), 'кнопка «Корзина, 2 товара»');
  assert.equal(describeClick({ closest: () => null }), null);
});

test('randomId подходит под правила сервера', () => {
  for (let i = 0; i < 20; i++) assert.match(randomId(), /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(randomId(), randomId());
});
