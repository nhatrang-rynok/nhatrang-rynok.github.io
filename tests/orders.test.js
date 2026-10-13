// T2.4: приём заказа (Orders.gs, Notify.gs, doPost) на подставных сервисах Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGas, plain, parseCsv } from './gas-loader.js';
import { createGoogle } from './gas-fakes.js';

const FILES = ['Logic.gs', 'Catalog.gs', 'Orders.gs', 'Notify.gs', 'Journal.gs', 'Main.gs', 'Setup.gs'];
const sampleCsv = parseCsv(readFileSync(new URL('../content/descriptions/sample-products.csv', import.meta.url), 'utf8'));
const TOKEN = '123456789:AAFakeTokenForTestsOnly-0123456789abc';
const NB = ' ';
let counter = 0;

function env({ token = TOKEN, chats = '111111111', email = 'owner@example.com' } = {}) {
  const google = createGoogle();
  const g = loadGas(FILES, google.globals);
  g.setup();
  const products = google.ss.getSheetByName('Товары');
  products.getRange(1, 1, sampleCsv.length, sampleCsv[0].length).setValues(sampleCsv.map(r => r.map(v => (v === 'TRUE' ? true : v === 'FALSE' ? false : v))));
  if (token) google.props.set('TELEGRAM_BOT_TOKEN', token);
  if (chats) google.props.set('TELEGRAM_CHAT_IDS', chats);
  if (email) google.props.set('ALERT_EMAIL', email);
  const sheet = name => google.ss.getSheetByName(name);
  const post = body => JSON.parse(g.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());
  const order = (o = {}) => ({
    action: 'order', clientOrderId: `test-order-${++counter}-abcdef`, phone: '+84 000 000 000', messenger: 'whatsapp', name: 'Ольга', room: '512',
    comment: 'Манго поспелее', adultConfirmed: false, items: [{ id: 'fr-001', qty: 1.5 }, { id: 'fr-008', qty: 2 }], clientTotal: 1, catalogVersion: 'x', website: '', ...o,
  });
  const row = (sheetName, n) => {
    const s = sheet(sheetName);
    const headers = s.values()[0];
    return Object.fromEntries(headers.map((h, i) => [h, s.values()[n]?.[i]]));
  };
  const errors = () => sheet('Ошибки').values().slice(1).map(r => `${r[1]}: ${r[2]}`);
  const allText = () => JSON.stringify([...google.ss.sheets.map(s => s.values()), google.alerts, google.fetches.map(f => f.payload), google.mails]);
  return { google, g, post, order, row, sheet, errors, allText };
}

const isDate = v => Object.prototype.toString.call(v) === '[object Date]';

// ---------------------------------------------------------------- успешный заказ
test('заказ: запись в «Заказы» и «Позиции заказов», сообщение в Telegram', () => {
  const e = env();
  const r = e.post(e.order());
  assert.deepEqual(r, { ok: true, orderNo: 'N-0001', total: 860, duplicate: false });

  const o = e.row('Заказы', 1);
  assert.equal(o['Номер'], 'N-0001');
  assert.ok(isDate(o['Создан']));
  assert.equal(o['Статус'], 'Новый');
  assert.equal(o['Телефон'], "'+84000000000", 'телефон с «+» защищён от превращения в формулу');
  assert.equal(o['Связь'], 'WhatsApp');
  assert.equal(o['Имя'], 'Ольга');
  assert.equal(o['Комната'], '512');
  assert.equal(o['Комментарий'], 'Манго поспелее');
  assert.equal(o['Состав'], `Манго — 1,5 кг × 280${NB}₽ = 420${NB}₽; Помело — 2 шт × 220${NB}₽ = 440${NB}₽`);
  assert.equal(o['Сумма ₽'], 860);
  assert.equal(o['Уведомление'], 'ok');
  assert.match(o['ID клиента'], /^test-order-/);

  const items = e.sheet('Позиции заказов').values();
  assert.equal(e.sheet('Позиции заказов').count(), 3);
  assert.deepEqual(items[1].slice(0, 1).concat(items[1].slice(2)), ['N-0001', 'fr-001', 'Манго', 1.5, 280, 420, false]);
  assert.equal(e.google.props.get('ORDER_SEQ'), '1');
  assert.equal(e.google.state.locks, 0, 'блокировка снята');

  assert.equal(e.google.fetches.length, 1);
  const f = e.google.fetches[0];
  assert.equal(f.url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(f.options.method, 'post');
  assert.equal(f.options.contentType, 'application/json');
  assert.equal(f.payload.chat_id, '111111111');
  assert.equal(f.payload.parse_mode, 'HTML');
  assert.ok(f.payload.text.includes('Новый заказ N-0001') && f.payload.text.includes('Манго — 1,5 кг'));
  assert.equal(f.payload.reply_markup.inline_keyboard[0][0].url, 'https://wa.me/84000000000');
  assert.equal(f.payload.reply_markup.inline_keyboard[1][0].url, 'https://docs.google.com/spreadsheets/d/FAKE_SPREADSHEET_ID/edit');
  assert.equal(e.google.mails.length, 0, 'письмо не нужно, если Telegram сработал');
});

test('заказ: номера идут подряд', () => {
  const e = env();
  assert.equal(e.post(e.order()).orderNo, 'N-0001');
  assert.equal(e.post(e.order({ phone: '+84 000 000 001' })).orderNo, 'N-0002');
  assert.equal(e.post(e.order({ phone: '+84 000 000 002' })).orderNo, 'N-0003');
  assert.equal(e.sheet('Заказы').count(), 4);
});

test('заказ: номер не повторяется, если служебный счётчик пропал или отстал', () => {
  const e = env();
  const orders = e.sheet('Заказы');
  orders.getRange(2, 1).setValue('N-0041');
  orders.getRange(3, 1).setValue('N-0007');
  assert.equal(e.post(e.order()).orderNo, 'N-0042');
  e.google.props.set('ORDER_SEQ', '100');
  assert.equal(e.post(e.order({ phone: '+84 000 000 001' })).orderNo, 'N-0101');
});

test('заказ: данные пишутся по заголовкам, если колонки переставили', () => {
  const e = env();
  const s = e.sheet('Заказы');
  s.grid[0] = [...s.grid[0]].reverse();
  const r = e.post(e.order());
  assert.equal(r.ok, true);
  const o = e.row('Заказы', 1);
  assert.equal(o['Номер'], 'N-0001');
  assert.equal(o['Сумма ₽'], 860);
  assert.equal(o['Имя'], 'Ольга');
  assert.equal(o['Уведомление'], 'ok', 'итог уведомления вписан в свою колонку');
});

test('заказ: формулы и «+» превращаются в текст', () => {
  const e = env();
  e.post(e.order({ name: '=HYPERLINK("http://evil","x")', comment: '@SUM(A1)', room: '-1' }));
  const o = e.row('Заказы', 1);
  assert.equal(o['Имя'], `'=HYPERLINK("http://evil","x")`);
  assert.equal(o['Комментарий'], "'@SUM(A1)");
  assert.equal(o['Комната'], "'-1");
  assert.equal(o['Телефон'], "'+84000000000");
});

test('заказ: цены берутся из таблицы, а не из запроса', () => {
  const e = env();
  const r = e.post(e.order({ items: [{ id: 'fr-001', qty: 1, price: 1, name: 'ВЗЛОМ' }], clientTotal: 1 }));
  assert.equal(r.total, 280);
  assert.ok(!e.allText().includes('ВЗЛОМ'));
});

test('заказ с алкоголем принимается без подтверждения возраста (D78), в таблице и Telegram есть пометка', () => {
  const e = env();
  const ok = e.post(e.order({ items: [{ id: 'al-001', qty: 1 }], adultConfirmed: false }));
  assert.equal(ok.ok, true);
  assert.equal(e.row('Заказы', 1)['18+ подтверждено'], true);
  assert.ok(e.google.fetches[0].payload.text.includes('🔞'));
});

// ---------------------------------------------------------------- повторы и лимиты
test('идемпотентность: повтор того же заказа возвращает тот же номер и ничего не дублирует', () => {
  const e = env();
  const body = e.order();
  const first = e.post(body);
  const again = e.post(body);
  assert.equal(first.duplicate, false);
  assert.deepEqual({ ...again, duplicate: false }, first);
  assert.equal(again.duplicate, true);
  assert.equal(e.sheet('Заказы').count(), 2);
  assert.equal(e.sheet('Позиции заказов').count(), 3);
  assert.equal(e.google.fetches.length, 1, 'второе уведомление не уходит');
});

test('лимит: 4-й заказ с одного телефона за 10 минут отклоняется, другой телефон принимается', () => {
  const e = env();
  for (let i = 0; i < 3; i++) assert.equal(e.post(e.order()).ok, true);
  const blocked = e.post(e.order());
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'RATE_LIMIT');
  assert.equal(e.sheet('Заказы').count(), 4);
  assert.equal(e.post(e.order({ phone: '+84 000 000 111' })).ok, true);
  assert.equal(e.google.state.locks, 0);
});

test('лимит: через 10 минут тот же телефон снова может заказывать, дубль не считается за заказ', () => {
  const e = env();
  const t0 = Date.now();
  const body = e.order();
  assert.equal(e.post(body).ok, true);
  assert.equal(e.post(body).duplicate, true, 'повтор не сжигает лимит');
  assert.equal(e.post(e.order()).ok, true);
  assert.equal(e.post(e.order()).ok, true);
  assert.equal(e.post(e.order()).error, 'RATE_LIMIT');
  e.g.run(`Date.now = () => ${t0 + 11 * 60 * 1000}`);
  assert.equal(e.post(e.order()).ok, true, 'окно закончилось');
});

test('лимит: 60 заказов в час всего', () => {
  const e = env();
  const t0 = Date.now();
  e.g.run(`Date.now = () => ${t0}`);
  for (let i = 0; i < 60; i++) assert.equal(e.post(e.order({ phone: `+84 100 000 ${String(i).padStart(3, '0')}` })).ok, true, `заказ ${i + 1}`);
  const r = e.post(e.order({ phone: '+84 999 999 999' }));
  assert.equal(r.error, 'RATE_LIMIT');
  assert.equal(e.sheet('Заказы').count(), 61);
});

// ---------------------------------------------------------------- пауза, ловушка, мусор
test('заказы на паузе', () => {
  const e = env();
  const settings = e.sheet('Настройки');
  const row = settings.values().findIndex(r => r[0] === 'orders_enabled') + 1;
  settings.getRange(row, 2).setValue(false);
  e.g.handleEdit({ range: settings.getRange(row, 2) });
  const r = e.post(e.order());
  assert.equal(r.error, 'ORDERS_PAUSED');
  assert.equal(e.sheet('Заказы').count(), 1);
  assert.equal(e.google.fetches.length, 0);
});

test('ловушка для ботов: притворный успех, ничего не пишется и не отправляется', () => {
  const e = env();
  const r = e.post(e.order({ website: 'http://spam.example' }));
  assert.deepEqual(r, { ok: true, orderNo: 'N-0000', total: 0, duplicate: false });
  assert.equal(e.sheet('Заказы').count(), 1);
  assert.equal(e.google.fetches.length, 0);
  assert.equal(e.google.props.get('ORDER_SEQ') ?? null, null);
});

test('doPost: мусор вместо запроса', () => {
  const e = env();
  for (const raw of ['', 'не json', '[]', '"строка"', '42', 'null']) {
    const r = e.post(raw);
    assert.equal(r.ok, false, raw);
    assert.equal(r.error, 'VALIDATION', raw);
  }
  assert.equal(e.post({ action: 'что-то' }).error, 'UNKNOWN_ACTION');
  assert.equal(e.post({ action: 'order', pad: 'я'.repeat(31000) }).error, 'VALIDATION', 'слишком большой запрос');
  assert.equal(JSON.parse(e.g.doPost({}).getContent()).error, 'VALIDATION');
  assert.equal(JSON.parse(e.g.doPost().getContent()).error, 'VALIDATION');
  assert.equal(e.sheet('Заказы').count(), 1);
});

test('ошибки проверки отдаются по контракту', () => {
  const e = env();
  const r = e.post(e.order({ phone: '12', items: [] }));
  assert.deepEqual(Object.keys(r).sort(), ['error', 'fields', 'items', 'message', 'ok']);
  assert.equal(r.error, 'VALIDATION');
  assert.ok(r.fields.phone && r.fields.items);
});

test('недоступный товар: ITEM_UNAVAILABLE со списком, заказ не пишется', () => {
  const e = env();
  const r = e.post(e.order({ items: [{ id: 'fr-001', qty: 1 }, { id: 'fr-010', qty: 1 }, { id: 'zz-999', qty: 1 }] }));
  assert.equal(r.error, 'ITEM_UNAVAILABLE');
  assert.deepEqual(r.items, ['fr-010', 'zz-999']);
  assert.equal(e.sheet('Заказы').count(), 1);
});

test('устаревший кэш: перед отказом таблица перечитывается', () => {
  const e = env();
  const products = e.sheet('Товары');
  const stockCol = products.values()[0].indexOf('Наличие') + 1;
  products.getRange(2, stockCol).setValue('Сезон закончился'); // манго
  e.g.handleEdit({ range: products.getRange(2, stockCol) });
  assert.equal(e.post(e.order({ items: [{ id: 'fr-001', qty: 1 }] })).error, 'ITEM_UNAVAILABLE');
  // Манго снова в наличии, но правку сделали без триггера: кэш ещё говорит «закончилось»
  products.getRange(2, stockCol).setValue('В наличии');
  const r = e.post(e.order({ items: [{ id: 'fr-001', qty: 1 }] }));
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------- уведомления
test('Telegram не сработал: заказ принят, письмо на ALERT_EMAIL, ошибка записана', () => {
  const e = env();
  e.google.state.fetchHandler = (url, o, reply) => reply(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' });
  const r = e.post(e.order());
  assert.equal(r.ok, true);
  assert.equal(e.row('Заказы', 1)['Уведомление'], 'ошибка Telegram: Forbidden: bot was blocked by the user; письмо отправлено');
  assert.equal(e.google.mails.length, 1);
  const mail = e.google.mails[0];
  assert.equal(mail.to, 'owner@example.com');
  assert.match(mail.subject, /^Заказ N-0001: Telegram не сработал$/);
  assert.ok(mail.body.includes('Новый заказ N-0001') && mail.body.includes('Манго') && mail.body.includes('Таблица: https://docs.google.com/'));
  assert.ok(!mail.body.includes('<b>'), 'письмо без разметки');
  assert.ok(e.errors().some(t => t.startsWith('Telegram, заказ N-0001: chat_id 111111111: Forbidden')));
});

test('Telegram: исключение с токеном в тексте не попадает ни в таблицу, ни в письма', () => {
  const e = env();
  e.google.state.fetchHandler = url => { throw new Error(`Request failed for ${url} returned code 502`); };
  const r = e.post(e.order());
  assert.equal(r.ok, true);
  assert.ok(e.row('Заказы', 1)['Уведомление'].startsWith('ошибка Telegram: Request failed for https://api.telegram.org/bot***/sendMessage'));
  assert.ok(!e.allText().includes('AAFakeTo'), 'токена нет нигде');
});

test('Telegram не настроен: заказ принят, в статусе подсказка, в «Ошибки» одна запись', () => {
  const e = env({ token: '', chats: '', email: '' });
  const r = e.post(e.order());
  assert.equal(r.ok, true);
  assert.match(e.row('Заказы', 1)['Уведомление'], /^Telegram не настроен .*; почта \(ALERT_EMAIL\) не задана$/);
  assert.equal(e.google.fetches.length, 0);
  assert.equal(e.errors().length, 1);
  assert.match(e.errors()[0], /не настроены ни Telegram, ни почта/);
});

test('Telegram не настроен, но есть почта: уведомление идёт письмом', () => {
  const e = env({ token: '', chats: '' });
  e.post(e.order());
  assert.equal(e.google.mails.length, 1);
  assert.match(e.row('Заказы', 1)['Уведомление'], /письмо отправлено$/);
});

test('два получателя: один недоступен — заказ «ok, но не всем», письмо не нужно', () => {
  const e = env({ chats: '111111111, 222222222' });
  e.google.state.fetchHandler = (url, o, reply) => (JSON.parse(o.payload).chat_id === '222222222'
    ? reply(400, { ok: false, description: 'Bad Request: chat not found' })
    : reply(200, { ok: true }));
  e.post(e.order());
  assert.equal(e.row('Заказы', 1)['Уведомление'], 'ok, но не всем: 222222222 — Bad Request: chat not found');
  assert.equal(e.google.fetches.length, 2);
  assert.equal(e.google.mails.length, 0);
});

test('письмо тоже не ушло: честный итог, заказ всё равно принят', () => {
  const e = env();
  e.google.state.fetchHandler = (url, o, reply) => reply(500, 'не json');
  e.google.state.mailFails = true;
  const r = e.post(e.order());
  assert.equal(r.ok, true);
  assert.equal(e.row('Заказы', 1)['Уведомление'], 'ошибка Telegram: HTTP 500; письмо не отправлено: Превышена суточная квота писем');
});

// ---------------------------------------------------------------- сбои
test('блокировка не получена: ошибка сервера, ничего не записано', () => {
  const e = env();
  e.google.state.lockFails = true;
  const r = e.post(e.order());
  assert.equal(r.error, 'SERVER');
  assert.equal(e.sheet('Заказы').count(), 1);
  assert.equal(e.google.fetches.length, 0);
});

test('сбой при записи: блокировка снимается, гость видит общую ошибку без подробностей', () => {
  const e = env();
  e.google.ss.sheets = e.google.ss.sheets.filter(s => s.name !== 'Заказы');
  const r = e.post(e.order());
  assert.deepEqual(r, { ok: false, error: 'SERVER', message: 'Ошибка сервера' });
  assert.equal(e.google.state.locks, 0);
  assert.ok(e.errors().some(t => t.startsWith('doPost: Нет листа «Заказы»')));
});

test('в листе «Заказы» нет обязательной колонки: заказ не принимается', () => {
  const e = env();
  const s = e.sheet('Заказы');
  s.grid[0][s.grid[0].indexOf('Состав')] = 'Что заказали';
  const r = e.post(e.order());
  assert.equal(r.error, 'SERVER');
  assert.ok(e.errors().some(t => t.includes('нет колонок: Состав')));
  assert.equal(s.count(), 1);
  assert.equal(e.google.state.locks, 0);
});

test('нет листа «Позиции заказов»: заказ принят, проблема записана', () => {
  const e = env();
  e.google.ss.sheets = e.google.ss.sheets.filter(s => s.name !== 'Позиции заказов');
  const r = e.post(e.order());
  assert.equal(r.ok, true);
  assert.equal(e.sheet('Заказы').count(), 2);
  assert.ok(e.errors().some(t => t.includes('Позиции не записаны')));
});

test('«Ошибки» не содержат токен и после сбоев', () => {
  const e = env();
  e.google.state.fetchHandler = url => { throw new Error(`boom ${url}`); };
  e.post(e.order());
  e.post(e.order({ phone: '+84 000 000 009' }));
  assert.ok(!e.allText().includes(TOKEN));
});

// ---------------------------------------------------------------- меню: проверка связи и chat_id
test('testNotify: без токена, без получателей, успех и ошибка', () => {
  let e = env({ token: '', chats: '' });
  e.g.testNotify();
  assert.match(e.google.alerts.at(-1).message, /Не задан токен бота/);

  e = env({ chats: '' });
  e.g.testNotify();
  assert.match(e.google.alerts.at(-1).message, /Не задан TELEGRAM_CHAT_IDS/);

  e = env({ chats: '111111111, 222222222' });
  e.google.state.fetchHandler = (url, o, reply) => (JSON.parse(o.payload).chat_id === '222222222' ? reply(400, { ok: false, description: 'chat not found' }) : reply(200, { ok: true }));
  e.g.testNotify();
  const msg = e.google.alerts.at(-1).message;
  assert.match(msg, /✅ 111111111: сообщение отправлено/);
  assert.match(msg, /❌ 222222222: chat not found/);
  assert.match(msg, /Запасная почта: owner@example.com/);
  assert.ok(e.google.fetches[0].payload.text.startsWith('✅'));
  assert.ok(!msg.includes(TOKEN));
});

test('findTelegramChatIds: показывает, кто писал боту, и по согласию сохраняет id', () => {
  const e = env({ chats: '' });
  e.google.state.updates = { ok: true, result: [
    { update_id: 1, message: { chat: { id: 111111111, type: 'private', first_name: 'Саня', username: 'sanya' } } },
    { update_id: 2, message: { chat: { id: 222222222, type: 'private', first_name: 'Владелец' } } },
  ] };
  e.google.state.alertAnswer = 'NO';
  e.g.findTelegramChatIds();
  const msg = e.google.alerts.at(-1).message;
  assert.match(msg, /Саня \(@sanya\) — 111111111/);
  assert.match(msg, /Владелец — 222222222/);
  assert.equal(e.google.alerts.at(-1).buttons, 'YES_NO');
  assert.equal(e.google.props.get('TELEGRAM_CHAT_IDS') ?? null, null, 'без согласия ничего не сохраняется');
  assert.ok(e.google.fetches[0].url.endsWith('/getUpdates'));

  e.google.state.alertAnswer = 'YES';
  e.g.findTelegramChatIds();
  assert.equal(e.google.props.get('TELEGRAM_CHAT_IDS'), '111111111,222222222');
  assert.equal(e.google.ss.toasts.length, 1);
});

test('findTelegramChatIds: нет токена, никого нет, ошибка Telegram', () => {
  let e = env({ token: '' });
  e.g.findTelegramChatIds();
  assert.match(e.google.alerts.at(-1).message, /Не задан токен бота/);

  e = env();
  e.g.findTelegramChatIds();
  assert.match(e.google.alerts.at(-1).message, /Бот пока никого не видит/);

  e = env();
  e.google.state.fetchHandler = (url, o, reply) => reply(409, { ok: false, description: 'Conflict: can\'t use getUpdates method while webhook is active' });
  e.g.findTelegramChatIds();
  assert.match(e.google.alerts.at(-1).message, /Telegram не ответил: Conflict/);

  e = env();
  e.google.state.fetchHandler = url => { throw new Error(`сбой ${url}`); };
  e.g.findTelegramChatIds();
  assert.ok(!e.google.alerts.at(-1).message.includes('AAFl'), 'токен скрыт в сообщении');
});

// ---------------------------------------------------------------- тестовый заказ из меню
test('menuTestOrder: создаёт заказ, отправляет уведомление и помечает заказ «Отменён»', () => {
  const e = env();
  e.g.menuTestOrder();
  const msg = e.google.alerts.at(-1).message;
  assert.match(msg, /Заказ N-0001 создан и помечен «Отменён»/);
  assert.match(msg, /Товар: Манго, сумма 280 ₽/);
  assert.match(msg, /Уведомление: ok/);
  const o = e.row('Заказы', 1);
  assert.equal(o['Статус'], 'Отменён');
  assert.equal(o['Имя'], 'ТЕСТ');
  assert.equal(e.row('Позиции заказов', 1)['Отменён'], true);
  assert.equal(e.google.fetches.length, 1);
  assert.ok(e.google.fetches[0].payload.text.includes('ТЕСТ'));
  // Отменённая позиция не учитывается в «Самом популярном»
  const lines = plain(e.g.parseOrderLines_(e.sheet('Позиции заказов').values()));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].cancelled, true);
  const products = plain(e.g.run('JSON.parse(JSON.stringify(getCatalog_(true).products))'));
  assert.deepEqual(plain(e.g.computePopular_(products, {}, lines, Date.now(), 30, 8)), []);
});

test('menuTestOrder: нет товаров — понятное сообщение; ошибка уведомления показана', () => {
  const google = createGoogle();
  const g = loadGas(FILES, google.globals);
  g.setup();
  g.menuTestOrder();
  assert.match(google.alerts.at(-1).message, /нет доступных товаров/);

  const e = env({ token: '', chats: '', email: '' });
  e.g.menuTestOrder();
  assert.match(e.google.alerts.at(-1).message, /Уведомление: Telegram не настроен/);
  assert.match(e.google.alerts.at(-1).message, /лист «Ошибки»/);
});

test('menuTestOrder: упавший заказ не раскрывает токен', () => {
  const e = env();
  e.sheet('Заказы').grid[0][e.sheet('Заказы').grid[0].indexOf('Состав')] = 'x';
  e.g.menuTestOrder();
  const msg = e.google.alerts.at(-1).message;
  assert.match(msg, /Не получилось: В листе «Заказы» нет колонок: Состав/);
  assert.ok(!msg.includes(TOKEN));
});

// ---------------------------------------------------------------- как ведёт себя настоящая таблица (флажки = FALSE в пустых строках)
test('в пустых строках лежит FALSE, но первый заказ пишется во вторую строку, а не в конец листа', () => {
  const e = env();
  const orders = e.sheet('Заказы');
  const checkboxCol = orders.values()[0].indexOf('18+ подтверждено') + 1;
  assert.equal(orders.get(500, checkboxCol), false, 'как в настоящей таблице: флажки заполнили пустые строки');
  assert.equal(orders.getLastRow(), 1000, 'getLastRow() вернул бы конец листа');
  assert.equal(e.post(e.order()).orderNo, 'N-0001');
  assert.equal(orders.get(2, 1), 'N-0001');
  assert.equal(orders.get(1001, 1), '', 'ничего не записано за пределами листа');
  assert.equal(e.post(e.order({ phone: '+84 000 000 001' })).orderNo, 'N-0002');
  assert.equal(orders.get(3, 1), 'N-0002');
  const items = e.sheet('Позиции заказов');
  assert.equal(items.get(2, 1), 'N-0001');
  assert.equal(items.get(4, 1), 'N-0002');
});

test('лист «Заказы» заполнен до конца: он растёт, а не ломается', () => {
  const e = env();
  const orders = e.sheet('Заказы');
  for (let r = 2; r <= 1000; r++) orders.set(r, 1, `N-${String(r - 1).padStart(4, '0')}`);
  const r = e.post(e.order());
  assert.equal(r.ok, true);
  assert.equal(r.orderNo, 'N-1000', 'после N-0999 в таблице');
  assert.ok(orders.getMaxRows() > 1000, 'лист вырос');
  const written = orders.values().find(row => row[0] === r.orderNo);
  assert.ok(written, 'заказ записан');
  assert.equal(orders.get(1001, 1), r.orderNo, 'заказ в первой строке после прежнего конца');
});

test('лист «Позиции заказов» заполнен до конца: тоже растёт', () => {
  const e = env();
  const items = e.sheet('Позиции заказов');
  for (let r = 2; r <= 1000; r++) items.set(r, 1, 'N-0001');
  assert.equal(e.post(e.order()).ok, true);
  assert.ok(items.getMaxRows() > 1000);
  assert.equal(items.get(1001, 3), 'fr-001');
  assert.equal(items.get(1002, 3), 'fr-008');
});

test('лист «Ошибки» с длинной историей не ломается', () => {
  const e = env();
  const errors = e.sheet('Ошибки');
  for (let r = 2; r <= 1000; r++) errors.set(r, 1, new Date());
  e.g.logError_('где-то', 'новая запись');
  assert.ok(e.errors().some(t => t === 'где-то: новая запись'));
});

// ---------------------------------------------------------------- разрешения
test('нет разрешений на Telegram и почту: в статусе подсказка, как их выдать', () => {
  const e = env({ chats: '111111111' });
  const denied = fn => { throw new Error(`У вас нет разрешения на вызов функции "${fn}". Требуемые разрешения: https://www.googleapis.com/auth/script.x`); };
  e.google.state.fetchHandler = () => denied('UrlFetchApp.fetch');
  e.google.state.mailFails = true;
  e.g.run("MailApp.sendEmail = () => { throw new Error('У вас нет разрешения на вызов функции \"MailApp.sendEmail\".'); }");
  const r = e.post(e.order());
  assert.equal(r.ok, true, 'заказ принят');
  const status = e.row('Заказы', 1)['Уведомление'];
  assert.match(status, /UrlFetchApp\.fetch/);
  assert.match(status, /письмо не отправлено: .*функцию authorize/);
  assert.equal((status.match(/функцию authorize/g) || []).length, 2, 'подсказка и у Telegram, и у письма');
});

test('findTelegramChatIds без разрешения: подсказка про authorize', () => {
  const e = env();
  e.google.state.fetchHandler = () => { throw new Error('У вас нет разрешения на вызов функции "UrlFetchApp.fetch".'); };
  e.g.findTelegramChatIds();
  assert.match(e.google.alerts.at(-1).message, /функцию authorize/);
});

test('authorize: итог проверки разрешений и свойств, версия кода', () => {
  const e = env({ chats: '' });
  const alertsBefore = e.google.alerts.length;
  const lines = plain(e.g.authorize());
  assert.match(lines[0], /^Версия кода: \d{4}-\d\d-\d\d\.\d+$/);
  assert.ok(lines.some(l => l.startsWith('✅ Таблица: ')));
  assert.ok(lines.some(l => l.startsWith('✅ Запросы в интернет (Telegram): HTTP 200')));
  assert.ok(lines.some(l => l.startsWith('✅ Почта: можно отправить ещё 100 писем')));
  assert.ok(lines.some(l => l.startsWith('✅ Свойство TELEGRAM_BOT_TOKEN')));
  assert.ok(lines.some(l => l.startsWith('❌ Свойство TELEGRAM_CHAT_IDS: пусто')));
  assert.ok(lines.some(l => l.startsWith('✅ Свойство ALERT_EMAIL')));
  assert.equal(e.google.alerts.length, alertsBefore, 'из редактора окно не открываем: оно может зависнуть');
  assert.equal(e.google.ss.toasts.at(-1).title, 'Проверка разрешений');
  assert.ok(!JSON.stringify(lines).includes(TOKEN), 'токен не показывается');
});

test('меню «Проверить разрешения»: окно с отчётом и подсказкой, что делать', () => {
  const e = env({ chats: '' });
  e.google.state.fetchHandler = () => { throw new Error('нет разрешения на UrlFetchApp'); };
  e.g.menuCheckPermissions();
  const alert = e.google.alerts.at(-1);
  assert.equal(alert.title, 'Проверка разрешений');
  assert.match(alert.message, /❌ Запросы в интернет/);
  assert.match(alert.message, /выберите функцию authorize/);
  assert.ok(!alert.message.includes(TOKEN));
});

test('authorize: без разрешений показывает, что именно не работает, и не падает', () => {
  const e = env();
  e.google.state.fetchHandler = () => { throw new Error('нет разрешения на UrlFetchApp'); };
  e.g.run("MailApp.getRemainingDailyQuota = () => { throw new Error('нет разрешения на MailApp'); }");
  const lines = plain(e.g.authorize());
  assert.ok(lines.some(l => l.startsWith('❌ Запросы в интернет (Telegram): нет разрешения')));
  assert.ok(lines.some(l => l.startsWith('❌ Почта: нет разрешения')));
  assert.ok(lines.some(l => l.startsWith('✅ Таблица')));
});
