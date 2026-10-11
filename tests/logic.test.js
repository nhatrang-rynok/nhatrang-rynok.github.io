// T2.1: чистая логика серверной части (apps-script/Logic.gs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGas, plain, parseCsv } from './gas-loader.js';
import { checkPhone as siteCheckPhone } from '../site/js/order.js';

const g = loadGas(['Logic.gs']);
const sample = JSON.parse(readFileSync(new URL('../site/data/catalog.sample.json', import.meta.url), 'utf8'));
const NB = ' ';
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

// ---------------------------------------------------------------- помощники
test('parseNumber_: числа, запятая, пробелы, мусор', () => {
  assert.equal(g.parseNumber_(1.5), 1.5);
  assert.equal(g.parseNumber_('1,5'), 1.5);
  assert.equal(g.parseNumber_('85 000'), 85000);
  assert.equal(g.parseNumber_(`85${NB}000`), 85000);
  assert.equal(g.parseNumber_(''), null);
  assert.equal(g.parseNumber_('12abc'), null);
  assert.equal(g.parseNumber_(null), null);
  assert.equal(g.parseNumber_(NaN), null);
});

test('parseBool_: флажки и слова', () => {
  for (const v of [true, 'TRUE', 'true', 'Да', '1', 1 === 1 && '✓']) assert.equal(g.parseBool_(v, false), true, String(v));
  for (const v of [false, 'FALSE', 'нет', '0']) assert.equal(g.parseBool_(v, true), false, String(v));
  assert.equal(g.parseBool_('', true), true);
  assert.equal(g.parseBool_(undefined, false), false);
  assert.equal(g.parseBool_('что-то', true), true);
});

test('toMs_: Date, число, строка', () => {
  assert.equal(g.toMs_(new Date(NOW)), NOW);
  assert.equal(g.toMs_(NOW), NOW);
  assert.equal(g.toMs_('2026-10-11T12:00:00Z'), NOW);
  assert.equal(g.toMs_(''), null);
  assert.equal(g.toMs_('не дата'), null);
});

test('cleanText_: управляющие символы, переносы, длина', () => {
  assert.equal(g.cleanText_('  a\u0000b\tc  '), 'a b c');
  assert.equal(g.cleanText_('a\nb'), 'a b');
  assert.equal(g.cleanText_('a\r\nb\n\nc', 0, true), 'a\nb\n\nc');
  assert.equal(g.cleanText_('abcdef', 3), 'abc');
  assert.equal(g.cleanText_(null), '');
});

// ---------------------------------------------------------------- защита
test('escapeHtml_: теги и кавычки', () => {
  assert.equal(g.escapeHtml_('<b>Тест</b> & "кавычки"'), '&lt;b&gt;Тест&lt;/b&gt; &amp; &quot;кавычки&quot;');
  assert.equal(g.escapeHtml_(null), '');
  assert.equal(g.escapeHtml_(42), '42');
});

test('sanitizeCell_: формулы превращаются в текст, числа и обычный текст не трогаем', () => {
  for (const v of ['=HYPERLINK("http://x","a")', '+79990000000', '-1+1', '@SUM(A1)', '\t=1']) assert.equal(g.sanitizeCell_(v), `'${v}`, v);
  assert.equal(g.sanitizeCell_('Манго'), 'Манго');
  assert.equal(g.sanitizeCell_('Ольга = хорошая'), 'Ольга = хорошая');
  assert.equal(g.sanitizeCell_(42), 42);
  assert.equal(g.sanitizeCell_(true), true);
  assert.equal(g.sanitizeCell_(''), '');
});

// ---------------------------------------------------------------- телефон
test('normalizePhone_: разные записи', () => {
  const cases = {
    '+7 (000) 000-00-00': '+70000000000', '8 000 000 00 00': '+70000000000', '70000000000': '+70000000000',
    '+84 000 000 000': '+84000000000', '0084 000 000 000': '+84000000000', '': '', '   ': '', 'abc': '',
    'тел: +7-000-000-00-00 вечером': '+70000000000',
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(g.normalizePhone_(raw), want, JSON.stringify(raw));
  assert.equal(g.normalizePhone_(null), '');
  assert.equal(g.normalizePhone_(undefined), '');
});

test('checkPhone_: границы длины и номер без кода страны', () => {
  assert.equal(g.checkPhone_('+7 000 000-00-00').ok, true);
  assert.equal(g.checkPhone_('+84 000 000 000').ok, true);
  assert.equal(g.checkPhone_('').error, 'Введите номер телефона');
  assert.equal(g.checkPhone_('+7 000').ok, false);
  assert.equal(g.checkPhone_('+7000000000000000').ok, false);
  assert.match(g.checkPhone_('999 000 00 00').error, /код страны/);
  assert.equal(g.checkPhone_('+999 000 00 00').ok, true);
});

test('телефон: сервер и сайт принимают и отклоняют одно и то же', () => {
  const samples = ['+7 000 000-00-00', '8 000 000 00 00', '70000000000', '+84 000 000 000', '0084 000 000 000', '999 000 00 00', '+999 000 00 00', '12', '', 'abc', '+7 000', '+7000000000000000', '+1 (000) 000-0000', '   ', '+', '00', '8 (000) 000-00-0', '+84-000-000-000', '84000000000', '+8 000 000 00 00'];
  for (const raw of samples) {
    const server = g.checkPhone_(raw);
    const site = siteCheckPhone(raw);
    assert.equal(server.ok, site.ok, `ok для ${JSON.stringify(raw)}`);
    assert.equal(server.phone, site.phone, `номер для ${JSON.stringify(raw)}`);
    assert.equal(server.error, site.error, `сообщение для ${JSON.stringify(raw)}`);
  }
});

// ---------------------------------------------------------------- цены
test('computeRubPrice_: рубли главнее, донги по курсу с округлением вверх', () => {
  assert.equal(g.computeRubPrice_(250, 99999, 300, 10), 250);
  assert.equal(g.computeRubPrice_('', 85000, 300, 10), 290);
  assert.equal(g.computeRubPrice_('', 84000, 300, 10), 280);
  assert.equal(g.computeRubPrice_('', 84001, 300, 10), 290);
  assert.equal(g.computeRubPrice_(0, 30000, 300, 10), 100);
  assert.equal(g.computeRubPrice_('', 85000, 300, 1), 284);
  assert.equal(g.computeRubPrice_('', 85000, 300, 0), 284, 'нулевое округление → 1');
  assert.equal(g.computeRubPrice_('', '85 000', '300', '10'), 290, 'значения из ячеек-строк');
  assert.equal(g.computeRubPrice_('', '', 300, 10), null);
  assert.equal(g.computeRubPrice_('', 85000, 0, 10), null, 'курс не задан');
  assert.equal(g.computeRubPrice_(-5, '', 300, 10), null);
  assert.equal(g.computeRubPrice_(12.345, '', 300, 10), 12.35);
});

// ---------------------------------------------------------------- «Похожие», фото
test('parseRelated_: разделители, регистр, дубли, неизвестные и сам товар', () => {
  const known = { 'fr-002': true, 'sw-005': true, 'fr-003': true, 'fr-001': true };
  assert.deepEqual(plain(g.parseRelated_('fr-002, sw-005;  FR-003', known, 'fr-001')), ['fr-002', 'sw-005', 'fr-003']);
  assert.deepEqual(plain(g.parseRelated_('fr-002 fr-002 zz-999 fr-001', known, 'fr-001')), ['fr-002']);
  assert.deepEqual(plain(g.parseRelated_('', known, 'fr-001')), []);
  assert.deepEqual(plain(g.parseRelated_(null, known, 'fr-001')), []);
  assert.deepEqual(plain(g.parseRelated_('constructor, toString', known, 'fr-001')), []);
});

test('photoUrl_ и extractDriveId_', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  assert.equal(g.extractDriveId_(id), id);
  assert.equal(g.extractDriveId_(`https://drive.google.com/file/d/${id}/view?usp=sharing`), id);
  assert.equal(g.extractDriveId_(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(g.extractDriveId_('короткий'), '');
  assert.equal(g.photoUrl_(id), `https://lh3.googleusercontent.com/d/${id}`);
  assert.equal(g.photoUrl_(`https://drive.google.com/file/d/${id}/view`), `https://lh3.googleusercontent.com/d/${id}`);
  assert.equal(g.photoUrl_('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(g.photoUrl_('http://example.com/a.jpg'), '', 'только https');
  assert.equal(g.photoUrl_('javascript:alert(1)'), '');
  assert.equal(g.photoUrl_(''), '');
});

// ---------------------------------------------------------------- настройки
const settingsValues = rows => [['Ключ', 'Значение', 'Публично', 'Пояснение'], ...rows];

test('parseSettings_: значения по умолчанию', () => {
  const s = plain(g.parseSettings_(g.tableFromValues_([])));
  assert.equal(s.public.site_title, 'Рынок у отеля');
  assert.equal(s.public.orders_enabled, true);
  assert.equal(s.public.whatsapp, '84000000000');
  assert.equal(s.rate, 300);
  assert.equal(s.rounding, 10);
  assert.equal(s.popularDays, 30);
  assert.equal(s.popularCount, 8);
});

test('parseSettings_: очистка значений, флажок, закрытые настройки не уходят на сайт', () => {
  const s = plain(g.parseSettings_(g.tableFromValues_(settingsValues([
    ['site_title', ' Мой рынок ', 'да', ''],
    ['whatsapp', 84000000001, 'да', ''],
    ['telegram', '@my_nick!', 'да', ''],
    ['orders_enabled', false, 'да', ''],
    ['announcement', 'Завтра выходной\nпривезу в четверг', 'да', ''],
    ['rate_vnd_per_rub', '305,5', 'нет', ''],
    ['rub_rounding', 5, 'нет', ''],
    ['popular_days', 'abc', 'нет', ''],
    ['popular_count', 3.7, 'нет', ''],
  ]))));
  assert.equal(s.public.site_title, 'Мой рынок');
  assert.equal(s.public.whatsapp, '84000000001');
  assert.equal(s.public.telegram, 'my_nick');
  assert.equal(s.public.orders_enabled, false);
  assert.equal(s.public.announcement, 'Завтра выходной\nпривезу в четверг');
  assert.equal(s.rate, 305.5);
  assert.equal(s.rounding, 5);
  assert.equal(s.popularDays, 30, 'мусор заменяется значением по умолчанию');
  assert.equal(s.popularCount, 3);
  assert.deepEqual(Object.keys(s.public).sort(), [...g.run('PUBLIC_SETTING_KEYS_')].sort());
});

test('начальные строки настроек: каждая настройка с пояснением, публичные помечены', () => {
  const rows = plain(g.initialSettingRows_());
  assert.deepEqual(rows.map(r => r[0]), Object.keys(plain(g.run('DEFAULT_SETTINGS_'))));
  assert.ok(rows.every(r => r[3].length > 0), 'у каждой настройки есть пояснение');
  assert.equal(rows.find(r => r[0] === 'rate_vnd_per_rub')[2], 'нет');
  assert.equal(rows.find(r => r[0] === 'phone')[2], 'да');
});

// ---------------------------------------------------------------- каталог из таблицы
const CAT_HEADERS = ['ID', 'Показывать', 'Название', 'Иконка', 'Подпись', 'Порядок'];
const productValues = rows => [plain(g.run('HEADERS_.products')), ...rows];
const prow = (o = {}) => {
  const base = { 'ID': 'fr-001', 'Показывать': true, 'Категория': 'fruits', 'Название': 'Манго', 'Цена ₽': 280, 'Единица': 'кг' };
  const data = { ...base, ...o };
  return plain(g.run('HEADERS_.products')).map(h => data[h] ?? '');
};
const build = (extra = {}) => plain(g.assembleCatalog_({
  categoryValues: [CAT_HEADERS, ...plain(g.run('INITIAL_CATEGORY_ROWS_'))],
  productValues: productValues([prow()]),
  settingValues: settingsValues([]),
  orderItemValues: [],
  nowMs: NOW,
  ...extra,
}));

test('каталог: товар из строки таблицы получает все поля контракта', () => {
  const { catalog, errors, fatal } = build();
  assert.equal(fatal, false);
  assert.deepEqual(errors, []);
  assert.deepEqual(catalog.products, [{
    id: 'fr-001', cat: 'fruits', name: 'Манго', short: '', desc: '', price: 280, unit: 'кг', step: 1, min: 1, img: '', warn: '', src: '',
    adult: false, stock: 'in', rel: [], sort: 1000000,
  }]);
});

test('каталог: заглушка сайта совпадает с тем, что даёт сервер для sample-products.csv', () => {
  const rows = parseCsv(readFileSync(new URL('../content/descriptions/sample-products.csv', import.meta.url), 'utf8'));
  const { catalog, errors } = build({ productValues: rows });
  assert.deepEqual(errors, []);
  assert.deepEqual(catalog.products, sample.products, 'товары');
  assert.deepEqual(catalog.categories, sample.categories, 'категории');
  assert.deepEqual(catalog.settings, sample.settings, 'настройки');
  // «Самое популярное»: все товары с флажком «Хит», кроме «закончился»
  assert.deepEqual([...catalog.popular].sort(), [...sample.popular].sort());
});

test('каталог: выключенные товары и категории скрыты без ошибок', () => {
  const values = productValues([
    prow({ 'ID': 'fr-001' }),
    prow({ 'ID': 'fr-002', 'Показывать': false }),
    prow({ 'ID': 'sw-001', 'Категория': 'sweets', 'Название': 'Желейки' }), // категория выключена
  ]);
  const { catalog, errors } = build({ productValues: values });
  assert.deepEqual(catalog.products.map(p => p.id), ['fr-001']);
  assert.deepEqual(errors, []);
  assert.deepEqual(catalog.categories.map(c => c.id), ['fruits', 'alcohol']);
});

test('каталог: кривые строки пропускаются и попадают в ошибки', () => {
  const values = productValues([
    prow({ 'ID': 'fr-001' }),
    prow({ 'ID': '' }),
    prow({ 'ID': 'Bad ID!' }),
    prow({ 'ID': 'fr-001', 'Название': 'Дубль' }),
    prow({ 'ID': 'fr-003', 'Категория': 'nope' }),
    prow({ 'ID': 'fr-004', 'Категория': '' }),
    prow({ 'ID': 'fr-005', 'Цена ₽': '', 'Цена ₫': '' }),
    prow({ 'ID': 'fr-006', 'Цена ₽': -5 }),
    prow({ 'ID': 'fr-007', 'Название': '' }),
    prow({ 'ID': 'fr-008', 'Цена ₽': 'текст' }),
  ]);
  const { catalog, errors } = build({ productValues: values });
  assert.deepEqual(catalog.products.map(p => p.id), ['fr-001']);
  assert.deepEqual(errors.map(e => e.row), [3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.ok(errors.every(e => e.where === 'Товары' && e.message.length > 0));
  assert.match(errors[2].message, /уже есть выше/);
  assert.match(errors[3].message, /Категория «nope» не найдена/);
});

test('каталог: значения приводятся к допустимым', () => {
  const values = productValues([
    prow({ 'ID': 'FR-010', 'Название': 'Н'.repeat(100), 'Коротко': 'К'.repeat(200), 'Шаг': '0,5', 'Минимум': 0.2, 'Единица': '', 'Наличие': 'Под заказ', '18+': 'да', 'Порядок': '20', 'Цена ₽': '', 'Цена ₫': '85 000' }),
    prow({ 'ID': 'fr-011', 'Шаг': 'abc', 'Минимум': 3, 'Наличие': 'Сезон закончился' }),
    prow({ 'ID': 'fr-012', 'Наличие': 'что-то', 'Фото': 'https://example.com/a.jpg' }),
  ]);
  const { catalog } = build({ productValues: values });
  const [a, b, c] = catalog.products;
  assert.equal(a.id, 'fr-010', 'ID приводится к нижнему регистру');
  assert.equal(a.name.length, 60);
  assert.equal(a.short.length, 80);
  assert.equal(a.step, 0.5);
  assert.equal(a.min, 0.5, 'минимум не меньше шага');
  assert.equal(a.unit, 'шт');
  assert.equal(a.stock, 'preorder');
  assert.equal(a.adult, true);
  assert.equal(a.sort, 20);
  assert.equal(a.price, 290);
  assert.equal(b.step, 1);
  assert.equal(b.min, 3);
  assert.equal(b.stock, 'out');
  assert.equal(c.stock, 'in');
  assert.equal(c.img, 'https://example.com/a.jpg');
});

test('каталог: «Похожие» — только опубликованные товары', () => {
  const values = productValues([
    prow({ 'ID': 'fr-001', 'Похожие': 'fr-002, fr-003, fr-001, zz-999' }),
    prow({ 'ID': 'fr-002' }),
    prow({ 'ID': 'fr-003', 'Показывать': false }),
  ]);
  const { catalog } = build({ productValues: values });
  assert.deepEqual(catalog.products[0].rel, ['fr-002']);
});

test('каталог: колонки ищутся по заголовку, порядок и лишние колонки не мешают', () => {
  const headers = ['Моя заметка', 'Название', 'Цена ₽', 'ID', 'Категория', 'Показывать', 'Единица'];
  const values = [headers, ['не трогать', 'Папайя', 150, 'fr-020', 'fruits', true, 'шт']];
  const { catalog, errors, fatal } = build({ productValues: values });
  assert.equal(fatal, false);
  assert.deepEqual(errors, []);
  assert.deepEqual([catalog.products[0].id, catalog.products[0].name, catalog.products[0].price, catalog.products[0].unit], ['fr-020', 'Папайя', 150, 'шт']);
});

test('каталог: нет обязательных колонок — fatal, каталог пустой, настройки остаются', () => {
  const broken = [['ID', 'Название', 'Цена ₽'], ['fr-001', 'Манго', 280]];
  const r = build({ productValues: broken });
  assert.equal(r.fatal, true);
  assert.deepEqual(r.catalog.products, []);
  assert.match(r.errors[0].message, /Нет обязательных колонок: Показывать, Категория/);
  assert.equal(r.catalog.settings.phone, '+84 000 000 000');

  const noPrice = build({ productValues: [['ID', 'Показывать', 'Категория', 'Название']] });
  assert.equal(noPrice.fatal, true);
  assert.match(noPrice.errors[0].message, /Цена ₽ \/ Цена ₫/);

  const noCats = build({ categoryValues: [['ID', 'Название']] });
  assert.equal(noCats.fatal, true);
});

test('каталог: пустые листы дают пустой каталог без ошибок и без сбоя', () => {
  const r = plain(g.assembleCatalog_({ categoryValues: [], productValues: [], settingValues: [], orderItemValues: [], nowMs: NOW }));
  assert.equal(r.fatal, true, 'без заголовков колонок каталог считается сломанным');
  assert.deepEqual(r.catalog.products, []);
});

test('категории: порядок, дубли, неверный ID, без названия', () => {
  const errors = [];
  const table = g.tableFromValues_([CAT_HEADERS,
    ['b-cat', true, 'Бета', '', '', 2], ['a-cat', true, 'Альфа', '', '', 1], ['a-cat', true, 'Дубль', '', '', 3],
    ['Bad Id', true, 'X', '', '', 4], ['no-name', true, '', '', '', 5], ['hid-den', false, 'Скрыта', '', '', 6], ['', '', '', '', '', ''],
  ]);
  const all = {};
  const list = plain(g.buildCategories_(table, errors, all));
  assert.deepEqual(list.map(c => c.id), ['a-cat', 'b-cat']);
  assert.equal(plain(errors).length, 3);
  assert.ok(all['hid-den'] && all['a-cat'], 'ID скрытых категорий запоминаются');
});

// ---------------------------------------------------------------- популярное
test('популярное: «Хит», затем по числу заказов; отменённые, старые и «закончился» не считаются', () => {
  const products = [
    { id: 'a-1', name: 'А', sort: 3, stock: 'in' }, { id: 'b-1', name: 'Б', sort: 2, stock: 'in' }, { id: 'c-1', name: 'В', sort: 1, stock: 'in' },
    { id: 'd-1', name: 'Г', sort: 4, stock: 'out' }, { id: 'e-1', name: 'Д', sort: 5, stock: 'in' }, { id: 'f-1', name: 'Е', sort: 6, stock: 'in' },
  ];
  const hits = { 'f-1': true, 'd-1': true };
  const line = (productId, daysAgo, cancelled = false) => ({ productId, ms: NOW - daysAgo * DAY, cancelled });
  const lines = [
    line('a-1', 1), line('a-1', 2), line('a-1', 3),
    line('b-1', 1), line('b-1', 5),
    line('c-1', 1), line('c-1', 2, true),
    line('d-1', 1), line('d-1', 1), line('e-1', 40),
  ];
  assert.deepEqual(plain(g.computePopular_(products, hits, lines, NOW, 30, 8)), ['f-1', 'a-1', 'b-1', 'c-1']);
  assert.deepEqual(plain(g.computePopular_(products, hits, lines, NOW, 30, 2)), ['f-1', 'a-1']);
  assert.deepEqual(plain(g.computePopular_(products, {}, [], NOW, 30, 8)), []);
  assert.deepEqual(plain(g.computePopular_(products, hits, lines, NOW, 60, 8)), ['f-1', 'a-1', 'b-1', 'c-1', 'e-1']);
});

test('популярное: равное число заказов — по порядку и названию; заказы «из будущего» не считаются', () => {
  const products = [{ id: 'a-1', name: 'Б', sort: 5, stock: 'in' }, { id: 'b-1', name: 'А', sort: 5, stock: 'in' }, { id: 'c-1', name: 'В', sort: 1, stock: 'in' }];
  const lines = [{ productId: 'a-1', ms: NOW - DAY, cancelled: false }, { productId: 'b-1', ms: NOW - DAY, cancelled: false }, { productId: 'c-1', ms: NOW + 10 * DAY, cancelled: false }];
  assert.deepEqual(plain(g.computePopular_(products, {}, lines, NOW, 30, 8)), ['b-1', 'a-1']);
});

test('parseOrderLines_: строки листа «Позиции заказов»', () => {
  const values = [['Номер заказа', 'Создан', 'ID товара', 'Название', 'Кол-во', 'Цена ₽', 'Сумма ₽', 'Отменён'],
    ['N-0001', new Date(NOW), 'FR-001', 'Манго', 2, 280, 560, false],
    ['N-0002', '2026-10-10T10:00:00Z', 'fr-002', 'Питайя', 1, 320, 320, true],
    ['N-0003', 'не дата', 'fr-003', '', 1, 1, 1, ''],
    ['N-0004', new Date(NOW), '', '', 1, 1, 1, '']];
  assert.deepEqual(plain(g.parseOrderLines_(values)), [
    { productId: 'fr-001', ms: NOW, cancelled: false },
    { productId: 'fr-002', ms: Date.UTC(2026, 9, 10, 10), cancelled: true },
  ]);
  assert.deepEqual(plain(g.parseOrderLines_([])), []);
});

test('каталог: популярное считается из листа «Позиции заказов»', () => {
  const lines = [['Номер заказа', 'Создан', 'ID товара', 'Отменён'], ['N-1', NOW - DAY, 'fr-002', ''], ['N-2', NOW - DAY, 'fr-002', ''], ['N-3', NOW - DAY, 'fr-001', '']];
  const values = productValues([prow({ 'ID': 'fr-001' }), prow({ 'ID': 'fr-002', 'Название': 'Питайя' })]);
  const { catalog } = build({ productValues: values, orderItemValues: lines });
  assert.deepEqual(catalog.popular, ['fr-002', 'fr-001']);
});

// ---------------------------------------------------------------- заказ
const catalogIndex = () => g.indexProducts_(sample);
const goodBody = (o = {}) => ({
  action: 'order', clientOrderId: 'c0f7e6a2-1b3c-4d5e-9f00-123456789abc', phone: '+84 000 000 000', messenger: 'whatsapp',
  name: 'Ольга', room: '512', comment: 'Манго поспелее', adultConfirmed: false, items: [{ id: 'fr-001', qty: 1.5 }, { id: 'fr-008', qty: 2 }],
  clientTotal: 1, catalogVersion: 'x', website: '', ...o,
});
const check = body => plain(g.validateOrder_(body, catalogIndex()));

test('заказ: правильный запрос, цены пересчитываются по таблице, а не по браузеру', () => {
  const r = check(goodBody({ clientTotal: 1 }));
  assert.equal(r.ok, true);
  assert.equal(r.order.total, 1.5 * 280 + 2 * 220);
  assert.equal(r.order.phone, '+84000000000');
  assert.deepEqual(r.order.items.map(i => [i.id, i.qty, i.price, i.sum]), [['fr-001', 1.5, 280, 420], ['fr-008', 2, 220, 440]]);
  assert.equal(r.order.hasAdult, false);
  assert.equal(r.order.name, 'Ольга');
});

test('заказ: подставленные цены и названия из запроса игнорируются', () => {
  const r = check(goodBody({ items: [{ id: 'fr-001', qty: 1, price: 1, name: 'ВЗЛОМ' }], clientTotal: 1 }));
  assert.equal(r.order.items[0].price, 280);
  assert.equal(r.order.items[0].name, 'Манго');
});

test('заказ: телефон нормализуется и проверяется', () => {
  assert.equal(check(goodBody({ phone: '8 000 000 00 00' })).order.phone, '+70000000000');
  const bad = check(goodBody({ phone: '12' }));
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'VALIDATION');
  assert.ok(bad.fields.phone);
  assert.equal(check(goodBody({ phone: undefined })).fields.phone, 'Введите номер телефона');
});

test('заказ: длины полей и управляющие символы', () => {
  assert.equal(check(goodBody({ name: 'я'.repeat(51) })).fields.name.includes('50'), true);
  assert.equal(check(goodBody({ room: '1'.repeat(11) })).ok, false);
  assert.equal(check(goodBody({ comment: 'к'.repeat(501) })).ok, false);
  assert.equal(check(goodBody({ comment: 'к'.repeat(500) })).ok, true);
  const r = check(goodBody({ name: 'О\u0000льга', comment: 'a\nb\u0007c' }));
  assert.equal(r.order.name, 'О льга');
  assert.equal(r.order.comment, 'a\nb c');
});

test('заказ: способ связи', () => {
  assert.equal(check(goodBody({ messenger: 'telegram' })).order.messenger, 'telegram');
  assert.equal(check(goodBody({ messenger: undefined })).order.messenger, 'whatsapp');
  assert.ok(check(goodBody({ messenger: 'viber' })).fields.messenger);
  assert.ok(check(goodBody({ messenger: ['call'] })).fields.messenger);
});

test('заказ: clientOrderId обязателен и безопасен', () => {
  assert.ok(check(goodBody({ clientOrderId: '' })).fields.clientOrderId);
  assert.ok(check(goodBody({ clientOrderId: 'short' })).fields.clientOrderId);
  assert.ok(check(goodBody({ clientOrderId: 'a'.repeat(65) })).fields.clientOrderId);
  assert.ok(check(goodBody({ clientOrderId: 'abc def ghi jkl' })).fields.clientOrderId);
  assert.ok(check(goodBody({ clientOrderId: 12345678 })).fields.clientOrderId);
  assert.equal(check(goodBody({ clientOrderId: 'lq3k9x0a-4fj2k1m9x' })).ok, true, 'запасной формат ID с сайта');
});

test('заказ: состав — пустой, слишком большой, мусор, дубли складываются', () => {
  assert.equal(check(goodBody({ items: [] })).fields.items, 'Корзина пуста');
  assert.ok(check(goodBody({ items: undefined })).fields.items);
  assert.ok(check(goodBody({ items: 'fr-001' })).fields.items);
  assert.ok(check(goodBody({ items: Array.from({ length: 51 }, (_, i) => ({ id: `x-${i}`, qty: 1 })) })).fields.items.includes('50'));
  assert.ok(check(goodBody({ items: [{ id: 'fr-001', qty: 0 }] })).fields.items);
  assert.ok(check(goodBody({ items: [{ id: 'fr-001', qty: -1 }] })).fields.items);
  assert.ok(check(goodBody({ items: [{ id: 'fr-001', qty: 'много' }] })).fields.items);
  assert.ok(check(goodBody({ items: [{ id: 5, qty: 1 }] })).fields.items);
  assert.ok(check(goodBody({ items: [null] })).fields.items);
  const dup = check(goodBody({ items: [{ id: 'fr-001', qty: 1 }, { id: 'FR-001', qty: 1.5 }] }));
  assert.equal(dup.ok, true);
  assert.deepEqual(dup.order.items.map(i => [i.id, i.qty]), [['fr-001', 2.5]]);
});

test('заказ: количество — шаг, минимум и максимум', () => {
  assert.ok(check(goodBody({ items: [{ id: 'fr-001', qty: 0.5 }] })).fields.items, 'минимум манго 1 кг');
  assert.ok(check(goodBody({ items: [{ id: 'fr-001', qty: 1.2 }] })).fields.items, 'не кратно шагу 0,5');
  assert.equal(check(goodBody({ items: [{ id: 'fr-001', qty: 1.5 }] })).ok, true);
  assert.equal(check(goodBody({ items: [{ id: 'fr-003', qty: 0.5 }] })).ok, true, 'у маракуйи минимум 0,5');
  assert.ok(check(goodBody({ items: [{ id: 'fr-008', qty: 1.5 }] })).fields.items, 'помело только штуками');
  assert.equal(check(goodBody({ items: [{ id: 'fr-008', qty: 100 }] })).ok, true);
  assert.ok(check(goodBody({ items: [{ id: 'fr-008', qty: 101 }] })).fields.items);
  assert.equal(check(goodBody({ items: [{ id: 'fr-001', qty: '1,5' }] })).ok, true, 'число строкой с запятой');
});

test('заказ: недоступные товары', () => {
  const r = check(goodBody({ items: [{ id: 'fr-001', qty: 1 }, { id: 'fr-010', qty: 1 }, { id: 'zz-999', qty: 1 }] }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ITEM_UNAVAILABLE');
  assert.deepEqual(r.items, ['fr-010', 'zz-999']);
  assert.equal(check(goodBody({ items: [{ id: 'constructor', qty: 1 }] })).error, 'ITEM_UNAVAILABLE');
});

test('заказ: 18+ обязательна только для алкоголя и только значением true', () => {
  const rum = [{ id: 'al-001', qty: 1 }];
  assert.ok(check(goodBody({ items: rum, adultConfirmed: false })).fields.adult);
  assert.ok(check(goodBody({ items: rum, adultConfirmed: 'true' })).fields.adult, 'строка не считается подтверждением');
  assert.ok(check(goodBody({ items: rum, adultConfirmed: undefined })).fields.adult);
  const ok = check(goodBody({ items: rum, adultConfirmed: true }));
  assert.equal(ok.ok, true);
  assert.equal(ok.order.hasAdult, true);
  assert.equal(check(goodBody()).ok, true, 'без алкоголя галочка не нужна');
});

test('заказ: мусор вместо тела запроса не ломает проверку', () => {
  for (const body of [null, undefined, 'строка', 42, [], {}]) {
    const r = check(body);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'VALIDATION');
  }
});

// ---------------------------------------------------------------- тексты
const goodOrder = () => check(goodBody({ items: [{ id: 'fr-001', qty: 2 }, { id: 'al-001', qty: 1 }], adultConfirmed: true })).order;

test('номер заказа', () => {
  assert.equal(g.formatOrderNo_(1), 'N-0001');
  assert.equal(g.formatOrderNo_(42), 'N-0042');
  assert.equal(g.formatOrderNo_(9999), 'N-9999');
  assert.equal(g.formatOrderNo_(10000), 'N-10000');
});

test('состав заказа для таблицы', () => {
  assert.equal(g.buildOrderComposition_(goodOrder()), `Манго — 2 кг × 280${NB}₽ = 560${NB}₽; Ром тёмный, 0,7 л — 1 бут. 0,7 л × 750${NB}₽ = 750${NB}₽`);
});

test('сообщение в Telegram: текст, итог, 18+, экранирование', () => {
  const order = goodOrder();
  order.name = '<b>Оля</b> & Ко';
  order.comment = 'Позвонить <за час>';
  const html = g.buildOrderText_(order, 'N-0042', true);
  assert.equal(html, [
    '🛒 <b>Новый заказ N-0042</b>',
    '📞 +84000000000 — предпочитает WhatsApp',
    '👤 &lt;b&gt;Оля&lt;/b&gt; &amp; Ко, комн. 512',
    '',
    `• Манго — 2 кг × 280${NB}₽ = 560${NB}₽`,
    `• Ром тёмный, 0,7 л — 1 бут. 0,7 л × 750${NB}₽ = 750${NB}₽`,
    `<b>Итого ≈ 1${NB}310${NB}₽</b>`,
    '🔞 Возраст подтверждён',
    '',
    '💬 Позвонить &lt;за час&gt;',
  ].join('\n'));
  const plainText = g.buildOrderText_(order, 'N-0042', false);
  assert.ok(plainText.startsWith('🛒 Новый заказ N-0042') && !plainText.includes('<b>Новый') && !plainText.includes('&amp;'), 'в письме без разметки');
  assert.ok(plainText.includes('<b>Оля</b> & Ко'), 'и без экранирования');
});

test('сообщение: без имени, комнаты и комментария; способ связи', () => {
  const order = check(goodBody({ name: '', room: '', comment: '', messenger: 'call' })).order;
  const text = g.buildOrderText_(order, 'N-0001', true);
  assert.ok(text.includes('просит позвонить'));
  assert.ok(!text.includes('👤') && !text.includes('💬') && !text.includes('🔞'));
  assert.ok(g.buildOrderText_({ ...order, messenger: 'telegram', room: '7' }, 'N-1', true).includes('👤 комн. 7'));
});

test('кнопки под сообщением', () => {
  const order = goodOrder();
  assert.deepEqual(plain(g.buildOrderButtons_(order, 'https://docs.google.com/spreadsheets/d/ID/edit')), {
    inline_keyboard: [
      [{ text: 'Написать в WhatsApp', url: 'https://wa.me/84000000000' }, { text: 'Написать в Telegram', url: 'https://t.me/+84000000000' }],
      [{ text: 'Открыть таблицу', url: 'https://docs.google.com/spreadsheets/d/ID/edit' }],
    ],
  });
  assert.equal(plain(g.buildOrderButtons_(order, '')).inline_keyboard.length, 1);
});

// ---------------------------------------------------------------- прочее
test('куски для кэша и подпись ошибок', () => {
  assert.deepEqual(plain(g.splitIntoChunks_('abcdefg', 3)), ['abc', 'def', 'g']);
  assert.deepEqual(plain(g.splitIntoChunks_('', 3)), ['']);
  assert.equal(plain(g.splitIntoChunks_('x'.repeat(250000), 90000)).length, 3);
  assert.equal(g.errorsSignature_([]), '');
  assert.notEqual(g.errorsSignature_([{ where: 'Товары', row: 2, message: 'a' }]), g.errorsSignature_([{ where: 'Товары', row: 3, message: 'a' }]));
  assert.equal(g.bytesToHex_([0, 15, 16, 255, -1, -128]), '000f10ffff80');
});

test('схема: у каждого листа есть заголовки, а заголовки обязательных колонок не дублируются', () => {
  const headers = plain(g.run('HEADERS_'));
  for (const [name, list] of Object.entries(headers)) {
    assert.ok(list.length > 0, name);
    assert.equal(new Set(list.map(h => h.toLowerCase())).size, list.length, `${name}: заголовки уникальны`);
  }
  assert.equal(Object.keys(plain(g.run('SHEET_NAMES_'))).length, Object.keys(headers).length);
});
