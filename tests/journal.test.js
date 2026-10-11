// Лист «Журнал»: события сервера и пакеты событий с сайта (Journal.gs) на подставных сервисах Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGas, plain, parseCsv } from './gas-loader.js';
import { createGoogle } from './gas-fakes.js';

const FILES = ['Logic.gs', 'Catalog.gs', 'Orders.gs', 'Notify.gs', 'Journal.gs', 'Main.gs', 'Setup.gs'];
const sampleCsv = parseCsv(readFileSync(new URL('../content/descriptions/sample-products.csv', import.meta.url), 'utf8'));
const TOKEN = '123456789:AAFakeTokenForTestsOnly-0123456789abc';
const VISITOR = 'v-test-0123456789';
let counter = 0;

function env({ chats = '111111111' } = {}) {
  const google = createGoogle();
  const g = loadGas(FILES, google.globals);
  g.setup();
  const products = google.ss.getSheetByName('Товары');
  products.getRange(1, 1, sampleCsv.length, sampleCsv[0].length).setValues(sampleCsv.map(r => r.map(v => (v === 'TRUE' ? true : v === 'FALSE' ? false : v))));
  google.props.set('TELEGRAM_BOT_TOKEN', TOKEN);
  if (chats) google.props.set('TELEGRAM_CHAT_IDS', chats);
  const log = () => {
    const s = google.ss.getSheetByName('Журнал');
    const headers = s.values()[0];
    // В листе новые строки сверху; для проверок порядка событий отдаём от старых к новым
    return s.values().slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]]))).reverse();
  };
  const clearLog = () => google.ss.getSheetByName('Журнал').deleteRows(2, 100000);
  const post = body => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  const order = (o = {}) => ({
    action: 'order', clientOrderId: `journal-order-${++counter}-abcdef`, phone: '+84 000 000 000', messenger: 'whatsapp', name: 'Ольга', room: '512',
    comment: 'Секретный комментарий', adultConfirmed: false, items: [{ id: 'fr-001', qty: 1.5 }], visitorId: VISITOR, website: '', ...o,
  });
  const batch = (events, extra = {}) => ({
    action: 'log', visitorId: VISITOR, now: 1_000_000, device: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1', w: 390, h: 844, lang: 'ru-RU' },
    events, ...extra,
  });
  clearLog();
  return { google, g, log, clearLog, post, order, batch, ss: google.ss };
}

const names = rows => rows.map(r => r['Событие']);

test('setup создаёт лист «Журнал» с заголовками, формат времени с секундами', () => {
  const e = env();
  const sheet = e.ss.getSheetByName('Журнал');
  assert.deepEqual(sheet.values()[0], ['Время', 'Уровень', 'Источник', 'Событие', 'Подробности', 'Экран', 'Посетитель', 'Заказ', 'Устройство']);
  assert.ok(sheet.formats.some(f => f.col === 1 && f.format === 'yyyy-mm-dd hh:mm:ss'));
  assert.ok(e.ss.getSheetByName('Ошибки').formats.some(f => f.col === 1 && f.format === 'yyyy-mm-dd hh:mm:ss'), 'в «Ошибках» время с секундами');
});

test('запрос каталога и ping попадают в журнал, время — Date', () => {
  const e = env();
  e.g.doGet({ parameter: { action: 'catalog' } });
  e.g.doGet({ parameter: { action: 'catalog' } });
  e.g.doGet({ parameter: { action: 'ping' } });
  const rows = e.log();
  assert.ok(names(rows).includes('Каталог собран из таблицы'));
  assert.equal(rows.filter(r => r['Событие'] === 'Запрос каталога').length, 2);
  assert.match(rows.filter(r => r['Событие'] === 'Запрос каталога')[1]['Подробности'], /отдан из кэша/);
  assert.ok(names(rows).includes('Проверка связи (ping)'));
  assert.ok(rows.every(r => Object.prototype.toString.call(r['Время']) === '[object Date]'));
  assert.ok(rows.every(r => r['Источник'] === 'Сервер' && r['Уровень'] === 'инфо'));
});

test('заказ: получен → записан → Telegram → итог; без телефона, имени, комнаты и комментария', () => {
  const e = env();
  const r = e.post(e.order());
  assert.equal(r.ok, true);
  const rows = e.log();
  const sequence = names(rows).filter(n => !n.startsWith('Каталог'));
  assert.deepEqual(sequence.slice(-4), ['Заказ получен', 'Заказ записан в таблицу', 'Telegram: отправлено', 'Уведомление о заказе']);
  const saved = rows.find(x => x['Событие'] === 'Заказ записан в таблицу');
  assert.equal(saved['Заказ'], r.orderNo);
  assert.equal(saved['Посетитель'], VISITOR.slice(0, 8));
  assert.match(saved['Подробности'], /Манго/);
  const text = JSON.stringify(rows);
  for (const secret of ['84 000 000 000', 'Ольга', '512', 'Секретный комментарий', TOKEN, '111111111']) {
    assert.ok(!text.includes(secret), `в журнале нет «${secret}»`);
  }
  assert.match(rows.find(x => x['Событие'] === 'Telegram: отправлено')['Подробности'], /…1111/);
});

test('заказ: отказ, повтор, ловушка для ботов и пауза — каждое событие в журнале', () => {
  const e = env();
  const o = e.order();
  e.post(o);
  e.clearLog();
  e.post(o);
  assert.deepEqual(names(e.log()).filter(n => n.includes('Повтор')), ['Повтор заказа']);
  e.clearLog();
  e.post(e.order({ phone: '123' }));
  const bad = e.log().find(r => r['Событие'] === 'Заказ отклонён');
  assert.equal(bad['Уровень'], 'внимание');
  assert.match(bad['Подробности'], /VALIDATION.*phone/);
  e.clearLog();
  e.post(e.order({ website: 'http://spam' }));
  assert.ok(names(e.log()).includes('Заказ: сработала ловушка для ботов'));
});

test('сбой Telegram: ошибка в журнале и в «Ошибках», токена нигде нет', () => {
  const e = env();
  e.google.state.fetchHandler = (url, options, reply) => reply(401, { ok: false, description: 'Unauthorized ' + TOKEN });
  e.post(e.order());
  const failed = e.log().find(r => r['Событие'] === 'Telegram: не доставлено');
  assert.equal(failed['Уровень'], 'ошибка');
  const all = JSON.stringify([e.log(), e.ss.getSheetByName('Ошибки').values()]);
  assert.ok(!all.includes(TOKEN));
  assert.ok(e.log().some(r => r['Уровень'] === 'ошибка' && r['Событие'].startsWith('Telegram, заказ')), 'ошибка из «Ошибок» продублирована в журнале');
});

test('«Ошибки»: время записывается с секундами', () => {
  const e = env();
  e.g.logError_('где-то', 'что-то');
  const sheet = e.ss.getSheetByName('Ошибки');
  assert.equal(Object.prototype.toString.call(sheet.get(2, 1)), '[object Date]');
  assert.ok(sheet.formats.filter(f => f.col === 1).every(f => f.format === 'yyyy-mm-dd hh:mm:ss'));
});

test('пакет событий с сайта: записывается с устройством, лишнее отбрасывается, телефоны скрываются', () => {
  const e = env();
  const res = e.post(e.batch([
    { t: 999_000, k: 'visit', d: 'новый, из t.me', s: 'home' },
    { t: 999_500, k: 'click', d: 'Кнопка «В корзину» +7 926 000-00-00', s: 'product', o: 'N-0007' },
    { t: 1_000_000, k: 'hack', d: 'не из списка' },
    { t: 1_000_000, k: 'error', d: 'TypeError: x is not a function' },
  ]));
  assert.deepEqual(res, { ok: true, logged: 3 });
  const rows = e.log();
  assert.deepEqual(names(rows).filter(n => !n.startsWith('Каталог')), ['Вход на сайт', 'Нажатие', 'Ошибка на сайте']);
  const click = rows.find(r => r['Событие'] === 'Нажатие');
  assert.equal(click['Источник'], 'Сайт');
  assert.equal(click['Посетитель'], VISITOR.slice(0, 8));
  assert.equal(click['Заказ'], 'N-0007');
  assert.equal(click['Экран'], 'product');
  assert.equal(click['Устройство'], 'iPhone · Safari · 390×844 · ru-RU');
  assert.ok(!click['Подробности'].includes('926'));
  assert.match(click['Подробности'], /\[номер\]/);
  assert.equal(rows.find(r => r['Событие'] === 'Ошибка на сайте')['Уровень'], 'ошибка');
  // время события — «сколько назад» по часам телефона, пересчитанное на часы сервера: вход раньше клика
  const visit = rows.find(r => r['Событие'] === 'Вход на сайт')['Время'].getTime();
  assert.ok(click['Время'].getTime() - visit >= 400 && click['Время'].getTime() - visit <= 600, 'между событиями полсекунды');
});

test('пакет событий: неверный посетитель, настройка log_events=выкл, лимиты', () => {
  const e = env();
  assert.equal(e.post(e.batch([{ t: 1, k: 'visit' }], { visitorId: 'x' })).ok, false);
  assert.equal(e.log().filter(r => r['Источник'] === 'Сайт').length, 0);

  // 15 пакетов в минуту можно, 16-й отбрасывается
  let limited = 0;
  for (let i = 0; i < 17; i++) if (e.post(e.batch([{ t: 1_000_000, k: 'view', d: '#/' }])).limited) limited++;
  assert.equal(limited, 2);
  assert.equal(e.log().filter(r => r['Событие'] === 'Открыт экран').length, 15);

  // Саня выключил журнал в настройках
  const settings = e.ss.getSheetByName('Настройки');
  const row = settings.values().findIndex(r => r[0] === 'log_events') + 1;
  assert.ok(row > 1, 'настройка log_events есть');
  settings.getRange(row, 2).setValue(false);
  e.g.handleEdit({ range: settings.getRange(row, 2) });
  e.clearLog();
  const res = e.post(e.batch([{ t: 1_000_000, k: 'visit' }], { visitorId: 'another-visitor-01' }));
  assert.deepEqual(res, { ok: true, logged: 0, disabled: true });
  assert.equal(e.log().filter(r => r['Источник'] === 'Сайт').length, 0);
});

test('правка таблицы и пункты меню попадают в журнал', () => {
  const e = env();
  const sheet = e.ss.getSheetByName('Товары');
  e.g.handleEdit({ range: sheet.getRange(2, 8) });
  e.g.menuRefreshSite();
  e.g.menuCheckSheet();
  e.g.testNotify();
  const list = names(e.log());
  for (const n of ['Правка таблицы', 'Меню: обновить сайт', 'Меню: проверить таблицу', 'Меню: тестовое уведомление', 'Telegram: проверка отправлена']) {
    assert.ok(list.includes(n), n);
  }
});

test('лист «Журнал» создаётся сам, если настройку не повторяли', () => {
  const e = env();
  e.ss.deleteSheet(e.ss.getSheetByName('Журнал'));
  e.g.doGet({ parameter: { action: 'ping' } });
  const sheet = e.ss.getSheetByName('Журнал');
  assert.ok(sheet);
  assert.equal(sheet.values()[0][0], 'Время');
  assert.ok(names(e.log()).includes('Проверка связи (ping)'));
});

test('журнал: старые строки удаляются, сбой блокировки или таблицы не ломает ответ', () => {
  const e = env();
  const sheet = e.ss.getSheetByName('Журнал');
  sheet.maxRows = 40000;
  const keep = plain(e.g.run('LOG_KEEP_'));
  const trimAt = plain(e.g.run('LOG_TRIM_AT_'));
  for (let r = 2; r <= trimAt + 1; r++) sheet.grid[r - 1] = [new Date(r), 'инфо', 'Сервер', 'старое', '', '', '', '', ''];
  e.g.doGet({ parameter: { action: 'ping' } });
  assert.ok(sheet.count() <= keep + 5 && sheet.count() >= keep - 5, `строк: ${sheet.count()}`);
  assert.equal(sheet.values()[1][3], 'Проверка связи (ping)', 'свежая запись — сверху');
  assert.equal(sheet.values().at(-1)[3], 'старое', 'внизу остались самые старые из оставшихся');
  assert.equal(sheet.values()[0][0], 'Время', 'заголовок на месте');

  e.google.state.lockFails = true;
  assert.equal(JSON.parse(e.g.doGet({ parameter: { action: 'ping' } }).getContent()).ok, true);
  e.google.state.lockFails = false;
  e.ss.getSheetByName = () => { throw new Error('нет доступа'); };
  assert.equal(JSON.parse(e.g.doGet({ parameter: { action: 'ping' } }).getContent()).ok, true);
});

test('authorize и «Проверить разрешения» оставляют след в журнале', () => {
  const e = env();
  e.g.authorize();
  e.g.menuCheckPermissions();
  const list = names(e.log());
  assert.ok(list.includes('Проверка разрешений'));
  assert.ok(list.includes('Меню: проверка разрешений'));
});

test('журнал: новые записи сверху, под заголовком, внутри пачки от новых к старым', () => {
  const e = env();
  e.g.doGet({ parameter: { action: 'ping' } });
  e.post(e.batch([{ t: 999_000, k: 'visit' }, { t: 999_900, k: 'view', d: '#/' }]));
  e.g.doGet({ parameter: { action: 'ping' } });
  const sheet = e.ss.getSheetByName('Журнал');
  const rows = sheet.values();
  assert.equal(rows[0][0], 'Время');
  const times = rows.slice(1).map(r => r[0].getTime());
  assert.ok(times.length >= 4);
  // порядок убывает (допускаем равные значения в одну миллисекунду)
  for (let i = 1; i < times.length; i++) assert.ok(times[i - 1] >= times[i] - 1000, `строка ${i + 1} не новее строки ${i + 2}`);
  assert.equal(rows[1][3], 'Проверка связи (ping)', 'самая свежая запись — сразу под заголовком');
  const site = rows.filter(r => r[2] === 'Сайт').map(r => r[3]);
  assert.deepEqual(site, ['Открыт экран', 'Вход на сайт'], 'внутри пачки новое выше старого');
  assert.ok(sheet.formats.some(f => f.col === 1 && f.format === 'yyyy-mm-dd hh:mm:ss'));
});

// ---------------------------------------------------------------- проверка заказа (ответ на POST не дошёл до телефона)
const status = (e, id) => JSON.parse(e.g.doGet({ parameter: { action: 'orderStatus', id } }).getContent());

test('orderStatus: принятый заказ находится по clientOrderId, чужой и неверный — нет', () => {
  const e = env();
  const o = e.order();
  const r = e.post(o);
  assert.deepEqual(status(e, o.clientOrderId), { ok: true, found: true, orderNo: r.orderNo, total: r.total });
  assert.deepEqual(status(e, 'never-sent-order-id'), { ok: true, found: false });
  assert.equal(status(e, 'x').ok, false);
  assert.equal(status(e, undefined).error, 'VALIDATION');
  assert.ok(names(e.log()).includes('Проверка заказа'));
});

test('orderStatus: отказанный заказ не считается принятым; в ответе нет персональных данных', () => {
  const e = env();
  const bad = e.order({ phone: '123' });
  e.post(bad);
  assert.equal(status(e, bad.clientOrderId).found, false);
  const ok = e.order();
  e.post(ok);
  const text = JSON.stringify(status(e, ok.clientOrderId));
  assert.ok(!text.includes('84 000') && !text.includes('Ольга'));
});

// ---------------------------------------------------------------- JSONP (запасной способ чтения ответа)
test('JSONP: ping, каталог и проверка заказа отвечают скриптом callback(...); чужое имя функции не принимается', () => {
  const e = env();
  const out = parameter => e.g.doGet({ parameter });
  const ping = out({ action: 'ping', callback: 'cb123' });
  assert.equal(ping.mime, 'JAVASCRIPT');
  assert.match(ping.getContent(), /^cb123\(\{"ok":true,"time":".*","version":"\d{4}-\d\d-\d\d\.\d+"\}\);$/);
  const catalog = out({ action: 'catalog', callback: 'onCatalog' }).getContent();
  assert.ok(catalog.startsWith('onCatalog({"ok":true') && catalog.endsWith(');'));
  assert.match(out({ action: 'orderStatus', id: 'never-sent-order-id', callback: 'cb1' }).getContent(), /^cb1\(\{"ok":true,"found":false\}\);$/);
  for (const bad of ['alert(1)//', 'a.b', '1abc', 'x'.repeat(60), 'a b']) {
    const r = out({ action: 'ping', callback: bad });
    assert.equal(r.mime, 'JSON', `«${bad}» не принимается`);
    assert.ok(r.getContent().startsWith('{'));
  }
});

// ---------------------------------------------------------------- отложенные ошибки таблицы не должны ломать ответ
const TYPED_COLUMN_ERROR = 'Нельзя выбрать числовой формат ячеек для столбца с заданным типом данных.';

test('отложенная ошибка таблицы (колонка с типом данных) не превращает ответ в страницу ошибки', () => {
  const e = env();
  const call = () => {
    const out = JSON.parse(e.g.doGet({ parameter: { action: 'ping' } }).getContent());
    e.google.endExecution(); // здесь запуск в настоящем Google упал бы, и гость получил бы страницу ошибки вместо JSON
    return out;
  };
  e.google.state.flushError = TYPED_COLUMN_ERROR;
  assert.equal(call().ok, true, 'ping отвечает JSON, а не исключением');
  assert.ok(names(e.log()).includes('Проверка связи (ping)'), 'запись в журнал всё равно сделана');

  // Сбой формата при записи строк журнала: запись остаётся, ответ нормальный
  const sheet = e.ss.getSheetByName('Журнал');
  const original = sheet.getRange(1, 1).constructor.prototype.setNumberFormat;
  sheet.getRange(1, 1).constructor.prototype.setNumberFormat = () => { throw new Error(TYPED_COLUMN_ERROR); };
  try {
    e.clearLog();
    assert.equal(call().ok, true);
    assert.ok(names(e.log()).includes('Проверка связи (ping)'));
    assert.equal(JSON.parse(e.g.doGet({ parameter: { action: 'catalog' } }).getContent()).ok, true);
  } finally {
    sheet.getRange(1, 1).constructor.prototype.setNumberFormat = original;
  }
});

test('заказ и отправка пакета событий переживают отложенную ошибку таблицы', () => {
  const e = env();
  e.google.state.flushError = TYPED_COLUMN_ERROR;
  const r = e.post(e.order());
  assert.equal(r.ok, true);
  assert.doesNotThrow(() => e.google.endExecution());
  e.google.state.flushError = TYPED_COLUMN_ERROR;
  assert.equal(e.post(e.batch([{ t: 1_000_000, k: 'visit' }])).ok, true);
  assert.doesNotThrow(() => e.google.endExecution());
});

test('«Первоначальная настройка» не падает, если формат даты запрещён', () => {
  const e = env();
  const proto = e.ss.getSheetByName('Журнал').getRange(1, 1).constructor.prototype;
  const original = proto.setNumberFormat;
  proto.setNumberFormat = () => { throw new Error(TYPED_COLUMN_ERROR); };
  try {
    assert.doesNotThrow(() => e.g.setup());
  } finally {
    proto.setNumberFormat = original;
  }
});
