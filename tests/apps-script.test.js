// T2.2: Setup.gs, Catalog.gs, Main.gs на подставных сервисах Google (tests/gas-fakes.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGas, plain, parseCsv } from './gas-loader.js';
import { createGoogle } from './gas-fakes.js';

const FILES = ['Logic.gs', 'Catalog.gs', 'Orders.gs', 'Notify.gs', 'Journal.gs', 'Main.gs', 'Setup.gs'];
const sampleCsv = parseCsv(readFileSync(new URL('../content/descriptions/sample-products.csv', import.meta.url), 'utf8'));
const sample = JSON.parse(readFileSync(new URL('../site/data/catalog.sample.json', import.meta.url), 'utf8'));

function env(sheetNames) {
  const google = createGoogle({ sheetNames });
  const g = loadGas(FILES, google.globals);
  const get = action => JSON.parse(g.doGet({ parameter: { action } }).getContent());
  const sheet = name => google.ss.getSheetByName(name);
  const headers = key => plain(g.run(`HEADERS_.${key}`));
  const importSample = () => {
    const s = sheet('Товары');
    s.getRange(1, 1, sampleCsv.length, sampleCsv[0].length).setValues(sampleCsv.map(r => r.map(v => (v === 'TRUE' ? true : v === 'FALSE' ? false : v))));
  };
  return { google, g, get, sheet, headers, importSample, ss: google.ss };
}

// Date из .gs создаётся в другом контексте Node, поэтому instanceof не подходит
const isDate = v => Object.prototype.toString.call(v) === '[object Date]';

// Журнал пополняется при каждом запуске, поэтому в снимок его строки не входят
const snapshot = ss => JSON.stringify(ss.sheets.filter(s => s.name !== 'Журнал').map(s => [s.name, s.values(), s.validations.length, s.protections.length, s.rules.length]));

// ---------------------------------------------------------------- setup
test('setup: листы в нужном порядке, заголовки, пустой «Лист1» удалён', () => {
  const e = env(['Лист1']);
  e.g.setup();
  assert.deepEqual(e.ss.names(), ['Товары', 'Категории', 'Настройки', 'Заказы', 'Позиции заказов', 'Ошибки', 'Журнал']);
  for (const [key, name] of Object.entries(plain(e.g.run('SHEET_NAMES_')))) {
    assert.deepEqual(e.sheet(name).values()[0], e.headers(key), `заголовки «${name}»`);
    assert.equal(e.sheet(name).frozen, 1, `закреплена первая строка «${name}»`);
  }
  assert.equal(e.ss.timeZone, 'Asia/Ho_Chi_Minh');
  assert.equal(e.google.props.get('SPREADSHEET_ID'), 'FAKE_SPREADSHEET_ID');
  assert.match(e.google.alerts[0].message, /Созданы листы: Товары, Категории/);
  assert.match(e.google.alerts[0].message, /Удалены пустые листы: Лист1/);
});

test('setup: «Лист1» с данными не удаляется', () => {
  const e = env(['Лист1']);
  e.sheet('Лист1').getRange(1, 1).setValue('мои заметки');
  e.g.setup();
  assert.ok(e.ss.names().includes('Лист1'));
});

test('setup: начальные категории и настройки', () => {
  const e = env();
  e.g.setup();
  const cats = e.sheet('Категории').values();
  assert.equal(e.sheet('Категории').count(), 7);
  assert.deepEqual(cats.slice(1, 7).map(r => [r[0], r[1]]), [['fruits', true], ['alcohol', true], ['sweets', false], ['coffee', false], ['souvenirs', false], ['pharmacy', false]]);
  const settings = e.sheet('Настройки').values();
  assert.deepEqual(settings.slice(1, 15).map(r => r[0]), Object.keys(plain(e.g.run('DEFAULT_SETTINGS_'))));
  assert.ok(settings.slice(1, 15).every(r => r[3] !== ''), 'у каждой настройки есть пояснение');
  assert.equal(settings.find(r => r[0] === 'orders_enabled')[1], true);
});

test('setup: выпадающие списки, флажки, защита заголовков, правила цвета', () => {
  const e = env();
  e.g.setup();
  const products = e.sheet('Товары');
  const col = h => e.headers('products').indexOf(h) + 1;
  const kinds = sheet => sheet.validations.map(v => `${v.col}:${v.rule.calls.map(c => c[0]).join('+')}`);
  for (const h of ['Показывать', '18+', 'Хит']) assert.ok(kinds(products).includes(`${col(h)}:requireCheckbox`), h);
  assert.ok(kinds(products).includes(`${col('Категория')}:requireValueInRange+setAllowInvalid`));
  assert.ok(kinds(products).includes(`${col('Наличие')}:requireValueInList+setAllowInvalid`));
  const stock = products.validations.find(v => v.col === col('Наличие')).rule.calls.find(c => c[0] === 'requireValueInList')[1];
  assert.deepEqual(plain(stock), ['В наличии', 'Под заказ', 'Сезон закончился']);
  const orders = e.sheet('Заказы');
  const statusRule = orders.validations.find(v => v.col === e.headers('orders').indexOf('Статус') + 1).rule.calls.find(c => c[0] === 'requireValueInList')[1];
  assert.deepEqual(plain(statusRule), ['Новый', 'Связались', 'Закуплено', 'Доставлено', 'Отменён']);
  assert.equal(orders.rules.length, 5, 'цвета по пяти статусам');
  assert.ok(orders.rules[0].calls.some(c => c[0] === 'whenFormulaSatisfied' && c[1] === '=$C2="Новый"'));
  for (const s of e.ss.sheets) {
    assert.equal(s.protections.length, 1, `защита заголовков «${s.name}»`);
    assert.equal(s.protections[0].warningOnly, true);
  }
  // Флажок «Принимаем заказы» стоит именно в строке orders_enabled
  const settings = e.sheet('Настройки');
  const row = settings.values().findIndex(r => r[0] === 'orders_enabled') + 1;
  assert.ok(settings.validations.some(v => v.row === row && v.col === 2 && v.rule.calls[0][0] === 'requireCheckbox'));
});

test('setup: один триггер на правки, повторный запуск не плодит триггеры', () => {
  const e = env();
  e.g.setup();
  e.g.setup();
  e.g.setup();
  assert.equal(e.google.triggers.length, 1);
  assert.equal(e.google.triggers[0].getHandlerFunction(), 'handleEdit');
  assert.equal(e.google.triggers[0].spec.event, 'onEdit');
});

test('setup: повторный запуск ничего не меняет и не дублирует', () => {
  const e = env(['Лист1']);
  e.g.setup();
  const first = snapshot(e.ss);
  e.g.setup();
  assert.equal(snapshot(e.ss), first);
  assert.match(e.google.alerts[1].message, /Все листы уже были на месте/);
});

test('setup: данные Сани не затираются, недостающие настройки добавляются', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  const settings = e.sheet('Настройки');
  const phoneRow = settings.values().findIndex(r => r[0] === 'phone') + 1;
  settings.getRange(phoneRow, 2).setValue('+84 111 222 333');
  // Саня удалил две настройки и поменял категорию
  settings.deleteRows(settings.values().findIndex(r => r[0] === 'popular_count') + 1, 1);
  const cats = e.sheet('Категории');
  cats.getRange(4, 2).setValue(true); // включил «Сладости»
  const productsBefore = JSON.stringify(e.sheet('Товары').values());
  e.g.setup();
  assert.equal(e.sheet('Товары').count(), 15);
  assert.equal(JSON.stringify(e.sheet('Товары').values()), productsBefore);
  assert.equal(settings.values().find(r => r[0] === 'phone')[1], '+84 111 222 333');
  assert.ok(settings.values().some(r => r[0] === 'popular_count'), 'недостающая настройка вернулась');
  assert.equal(cats.values()[3][1], true, 'включённая категория осталась включённой');
  assert.equal(cats.count(), 7);
});

test('setup: переставленные колонки остаются на местах, недостающие заголовки дописываются в конец', () => {
  const e = env();
  e.g.setup();
  const sheet = e.sheet('Товары');
  const row = sheet.values()[0];
  // Саня поменял местами «Название» и «Категорию» и удалил колонку «Хит»
  const swapped = [...row];
  [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
  const withoutHit = swapped.filter(h => h !== 'Хит');
  sheet.grid[0] = [...withoutHit];
  e.g.setup();
  const after = sheet.values()[0];
  assert.deepEqual(after.slice(0, withoutHit.length), withoutHit, 'порядок колонок не тронут');
  assert.equal(after[withoutHit.length], 'Хит', 'удалённая колонка вернулась в конец');
  assert.equal(after.length, row.length);
  assert.match(e.google.alerts.at(-1).message, /Добавлены колонки: Товары: Хит/);
});

test('setup: у пользователя уже есть свои колонки — не мешают', () => {
  const e = env();
  e.g.setup();
  const sheet = e.sheet('Товары');
  const n = sheet.values()[0].length;
  sheet.getRange(1, n + 1).setValue('Моя заметка');
  e.g.setup();
  assert.equal(sheet.values()[0].length, n + 1);
  assert.equal(sheet.values()[0][n], 'Моя заметка');
});

// ---------------------------------------------------------------- каталог через doGet
test('doGet: ping и неизвестное действие', () => {
  const e = env();
  const ping = e.get('ping');
  assert.equal(ping.ok, true);
  assert.ok(!Number.isNaN(Date.parse(ping.time)));
  assert.match(ping.version, /^\d{4}-\d\d-\d\d\.\d+$/, 'в ответе ping есть версия кода');
  assert.equal(e.get('что-то').error, 'UNKNOWN_ACTION');
  assert.equal(JSON.parse(e.g.doGet({}).getContent()).error, 'UNKNOWN_ACTION');
  assert.equal(JSON.parse(e.g.doGet().getContent()).error, 'UNKNOWN_ACTION');
  assert.equal(e.g.doGet({ parameter: { action: 'ping' } }).mime, 'JSON');
});

test('doGet: каталог по контракту, совпадает с заглушкой сайта', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  const catalog = e.get('catalog');
  assert.equal(catalog.ok, true);
  assert.match(catalog.version, /^\d{4}-\d\d-\d\dT[\d:.]+Z#[0-9a-f]{6}$/);
  assert.ok(!Number.isNaN(Date.parse(catalog.generatedAt)));
  assert.deepEqual(catalog.products, sample.products);
  assert.deepEqual(catalog.categories, sample.categories);
  assert.deepEqual(catalog.settings, sample.settings);
  assert.ok(catalog.popular.length > 0 && catalog.popular.every(id => catalog.products.some(p => p.id === id)));
  assert.deepEqual(Object.keys(catalog).sort(), ['categories', 'generatedAt', 'ok', 'popular', 'products', 'settings', 'version']);
});

test('каталог: второй запрос берётся из кэша, правка сбрасывает кэш', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  e.get('catalog');
  const reads = e.ss.reads;
  const again = e.get('catalog');
  assert.equal(e.ss.reads, reads, 'таблица не читалась');
  assert.equal(again.products.length, 14);

  // Саня поменял цену → сработал триггер handleEdit
  const sheet = e.sheet('Товары');
  const priceCol = e.headers('products').indexOf('Цена ₽') + 1;
  const dongCol = e.headers('products').indexOf('Цена ₫') + 1;
  sheet.getRange(2, dongCol).setValue(90000);
  e.g.handleEdit({ range: sheet.getRange(2, dongCol) });
  const fresh = e.get('catalog');
  assert.ok(e.ss.reads > reads, 'таблица прочитана заново');
  assert.equal(fresh.products[0].price, 300, '90 000 ₫ / 300 = 300 ₽');
  assert.notEqual(fresh.version, again.version);
  void priceCol;
});

test('каталог: меню «Обновить сайт» сбрасывает кэш', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  e.get('catalog');
  const reads = e.ss.reads;
  e.g.menuRefreshSite();
  e.get('catalog');
  assert.ok(e.ss.reads > reads);
  assert.equal(e.ss.toasts.length, 1);
});

test('каталог: большой каталог режется на куски меньше 100 КБ и читается обратно целиком', () => {
  const e = env();
  e.g.setup();
  const sheet = e.sheet('Товары');
  const headers = e.headers('products');
  const rows = [headers];
  for (let i = 1; i <= 300; i++) {
    const row = headers.map(() => '');
    const set = (h, v) => { row[headers.indexOf(h)] = v; };
    set('ID', `fr-${String(i).padStart(3, '0')}`); set('Показывать', true); set('Категория', 'fruits'); set('Название', `Товар ${i} ${'я'.repeat(40)}`);
    set('Описание', 'Длинное описание. '.repeat(33)); set('Предупреждения', 'Предупреждение. '.repeat(24)); set('Цена ₽', 100 + i); set('Единица', 'кг');
    rows.push(row);
  }
  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  const catalog = e.get('catalog');
  assert.equal(catalog.products.length, 300);
  const parts = JSON.parse(e.google.store.get('cat_v1_meta')).parts;
  assert.ok(parts > 1, `кусков: ${parts}`);
  const again = e.get('catalog');
  assert.deepEqual(again, catalog, 'из кэша получается то же самое');
});

test('каталог: если кэш потерял кусок, каталог пересобирается', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  e.get('catalog');
  e.google.store.delete('cat_v1_0');
  const reads = e.ss.reads;
  assert.equal(e.get('catalog').products.length, 14);
  assert.ok(e.ss.reads > reads);
});

test('каталог: сломали заголовки — отдаётся прошлый хороший каталог, ошибка записана один раз', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  const good = e.get('catalog');
  const sheet = e.sheet('Товары');
  sheet.getRange(1, 2).setValue('Видно'); // переименовали «Показывать»
  e.g.handleEdit({ range: sheet.getRange(1, 2) });
  const during = e.get('catalog');
  assert.deepEqual(during.products, good.products, 'сайт не опустел');
  const errors = e.sheet('Ошибки').values().slice(1);
  assert.equal(errors.length, 1);
  assert.match(errors[0][2], /Нет обязательных колонок: Показывать/);
  assert.equal(errors[0][1], 'Товары, строка 1');

  // Пересборка при той же поломке не добавляет новых строк
  e.g.clearCatalogCache();
  e.get('catalog');
  e.g.clearCatalogCache();
  e.get('catalog');
  assert.equal(e.sheet('Ошибки').values().length, 2);

  // Починили — снова всё работает, сигнатура сброшена
  sheet.getRange(1, 2).setValue('Показывать');
  e.g.handleEdit({ range: sheet.getRange(1, 2) });
  assert.equal(e.get('catalog').products.length, 14);
  sheet.getRange(1, 2).setValue('Видно');
  e.g.handleEdit({ range: sheet.getRange(1, 2) });
  e.get('catalog');
  assert.equal(e.sheet('Ошибки').values().length, 3, 'новая поломка — новая запись');
});

test('каталог: поломка без прошлого хорошего каталога — пустой, но настройки и контакты на месте', () => {
  const e = env();
  e.g.setup();
  const catalog = e.get('catalog');
  assert.equal(catalog.ok, true);
  assert.deepEqual(catalog.products, []);
  assert.equal(catalog.settings.phone, '+84 000 000 000');
});

test('каталог: ошибки строк пишутся в лист «Ошибки» с номером строки', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  const sheet = e.sheet('Товары');
  sheet.getRange(3, 1).setValue('Плохой ID!');
  e.g.clearCatalogCache();
  const catalog = e.get('catalog');
  assert.equal(catalog.products.length, 13);
  const row = e.sheet('Ошибки').values()[1];
  assert.ok(isDate(row[0]));
  assert.equal(row[1], 'Товары, строка 3');
  assert.match(row[2], /Неверный ID/);
});

test('каталог: не создан лист «Товары» — не падаем', () => {
  const e = env(['Лист1']);
  const catalog = e.get('catalog');
  assert.equal(catalog.ok, true);
  assert.deepEqual(catalog.products, []);
});

test('doGet: сбой чтения таблицы не раскрывает подробности наружу', () => {
  const e = env();
  e.g.setup();
  e.ss.getSheetByName = () => { throw new Error('СЕКРЕТНАЯ ВНУТРЕННЯЯ ОШИБКА'); };
  const r = JSON.parse(e.g.doGet({ parameter: { action: 'catalog' } }).getContent());
  assert.deepEqual(r, { ok: false, error: 'SERVER', message: 'Ошибка сервера' });
});

// ---------------------------------------------------------------- handleEdit
test('handleEdit: проставляет «Обновлено» только у изменённых строк товаров', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  const sheet = e.sheet('Товары');
  const col = e.headers('products').indexOf('Обновлено') + 1;
  e.g.handleEdit({ range: sheet.getRange(3, 4, 2, 2) }); // строки 3–4
  assert.ok(isDate(sheet.get(3, col)) && isDate(sheet.get(4, col)));
  assert.equal(sheet.get(2, col), '');
  assert.equal(sheet.get(5, col), '');
  // правка самой даты не штампуется повторно
  sheet.set(6, col, 'вручную');
  e.g.handleEdit({ range: sheet.getRange(6, col) });
  assert.equal(sheet.get(6, col), 'вручную');
  // заголовок не штампуется
  e.g.handleEdit({ range: sheet.getRange(1, 1) });
  assert.equal(sheet.get(1, col), 'Обновлено');
});

test('handleEdit: правки в других листах не сбрасывают кэш; ошибки не ломают таблицу', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  e.get('catalog');
  const reads = e.ss.reads;
  e.g.handleEdit({ range: e.sheet('Заказы').getRange(2, 3) });
  e.g.handleEdit({ range: e.sheet('Ошибки').getRange(2, 1) });
  e.get('catalog');
  assert.equal(e.ss.reads, reads, 'кэш цел');
  e.g.handleEdit(undefined);
  e.g.handleEdit({});
  e.g.handleEdit({ range: { getSheet() { throw new Error('сбой'); } } }); // исключение гасится
});

test('handleEdit: правка «Настроек» и «Категорий» сбрасывает кэш', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  e.get('catalog');
  for (const name of ['Настройки', 'Категории']) {
    const reads = e.ss.reads;
    e.g.handleEdit({ range: e.sheet(name).getRange(2, 2) });
    e.get('catalog');
    assert.ok(e.ss.reads > reads, name);
    e.get('catalog');
  }
});

// ---------------------------------------------------------------- меню
test('меню: пункты и проверка таблицы', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  e.g.onOpen();
  assert.equal(e.google.menus[0].title, '🛒 Рынок');
  const fns = e.google.menus[0].items.filter(i => i[1]).map(i => i[1]);
  assert.deepEqual(fns, ['menuRefreshSite', 'menuCheckSheet', 'testNotify', 'findTelegramChatIds', 'menuTestOrder', 'menuCheckPermissions', 'setup']);
  for (const fn of fns) assert.equal(typeof e.g[fn], 'function', `функция ${fn} существует и видна в меню`);

  e.g.menuCheckSheet();
  assert.match(e.google.alerts.at(-1).message, /Проблем не найдено/);
  assert.match(e.google.alerts.at(-1).message, /товаров — 14, категорий — 2/);

  e.sheet('Товары').getRange(3, 1).setValue('');
  e.sheet('Товары').getRange(4, 1).setValue('Плохой ID');
  e.g.menuCheckSheet();
  const msg = e.google.alerts.at(-1).message;
  assert.match(msg, /Найдено проблем: 2/);
  assert.match(msg, /строка 3: Пустой ID/);
  assert.match(msg, /строка 4: Неверный ID/);
});

// ---------------------------------------------------------------- прочее
test('логирование ошибок: хранится не больше 500 последних строк и нет формул', () => {
  const e = env();
  e.g.setup();
  for (let i = 0; i < 650; i++) e.g.logError_('тест', i === 649 ? '=HYPERLINK("x")' : `ошибка ${i}`);
  const rows = e.sheet('Ошибки').values();
  assert.ok(rows.length <= 601 && rows.length >= 501, `строк: ${rows.length}`);
  assert.equal(rows.at(-1)[2], `'=HYPERLINK("x")`);
  assert.equal(rows[0][0], 'Когда');
});

test('логирование: сбой записи не ломает вызывающий код', () => {
  const e = env();
  e.g.setup();
  e.ss.getSheetByName = () => { throw new Error('нет доступа'); };
  e.g.logError_('где-то', 'что-то');
});

test('манифест: V8, часовой пояс, веб-приложение от имени владельца для всех, минимум разрешений', () => {
  const m = JSON.parse(readFileSync(new URL('../apps-script/appsscript.json', import.meta.url), 'utf8'));
  assert.equal(m.runtimeVersion, 'V8');
  assert.equal(m.timeZone, 'Asia/Ho_Chi_Minh');
  assert.deepEqual(m.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
  // Явного списка разрешений нет: иначе устаревший список в редакторе владельца молча отнимал бы новые разрешения (D68)
  assert.equal(m.oauthScopes, undefined);
});

test('все .gs файлы грузятся вместе: имена не повторяются (как в одном проекте Apps Script)', () => {
  const google = createGoogle();
  assert.doesNotThrow(() => loadGas(FILES, google.globals));
});

test('в .gs нет синтаксиса модулей и обращений к лишним сервисам', () => {
  for (const file of FILES) {
    const code = readFileSync(new URL(`../apps-script/${file}`, import.meta.url), 'utf8');
    assert.ok(!/^\s*(import|export)\s/m.test(code), `${file}: import/export недопустимы`);
    assert.ok(!/DriveApp|GmailApp|DocumentApp/.test(code), `${file}: сервисы, для которых нет разрешений в манифесте`);
    if (file !== 'Notify.gs') assert.ok(!/UrlFetchApp|MailApp/.test(code), `${file}: внешние запросы и почта только в Notify.gs`);
  }
  const logic = readFileSync(new URL('../apps-script/Logic.gs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/SpreadsheetApp|CacheService|PropertiesService|ScriptApp|ContentService|Utilities\./.test(logic), 'Logic.gs должен оставаться чистым');
});

// ---------------------------------------------------------------- пустые строки с флажками и датами
test('каталог: пустые строки с FALSE в флажках и датой «Обновлено» не считаются товарами и не дают ошибок', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  e.g.setup(); // повторная настройка снова заливает флажки FALSE в пустые строки
  const products = e.sheet('Товары');
  const stampCol = e.headers('products').indexOf('Обновлено') + 1;
  const showCol = e.headers('products').indexOf('Показывать') + 1;
  assert.equal(products.get(500, showCol), false, 'в пустых строках лежит FALSE');
  for (let r = 16; r <= 26; r++) products.set(r, stampCol, new Date()); // след старой штамповки

  const catalog = e.get('catalog');
  assert.equal(catalog.products.length, 14);
  assert.deepEqual(e.sheet('Ошибки').values().slice(1), [], 'в «Ошибки» ничего не попало');
  e.g.menuCheckSheet();
  assert.match(e.google.alerts.at(-1).message, /Проблем не найдено/);
});

test('handleEdit: пустые строки не штампуются датой', () => {
  const e = env();
  e.g.setup();
  e.importSample();
  const sheet = e.sheet('Товары');
  const stampCol = e.headers('products').indexOf('Обновлено') + 1;
  e.g.handleEdit({ range: sheet.getRange(14, 1, 6, 20) }); // строки 14–19: две с товарами (14, 15), остальные пустые
  assert.ok(isDate(sheet.get(14, stampCol)) && isDate(sheet.get(15, stampCol)));
  for (let r = 16; r <= 19; r++) assert.equal(sheet.get(r, stampCol), '', `строка ${r}`);
});

test('setup: на листах с FALSE в пустых строках ничего не ломается при повторе и категории не заливаются заново', () => {
  const e = env();
  e.g.setup();
  const cats = e.sheet('Категории');
  cats.getRange(4, 2).setValue(true);
  e.g.setup();
  e.g.setup();
  assert.equal(cats.count(), 7);
  assert.equal(cats.get(4, 2), true);
  const settings = e.sheet('Настройки');
  assert.equal(settings.count(), 15, 'настройки не продублированы');
});

test('каждый .gs файл начинается со своего имени (по нему владелец проверяет, что вставил нужный код)', () => {
  for (const file of FILES) {
    const lines = readFileSync(new URL(`../apps-script/${file}`, import.meta.url), 'utf8').split('\n');
    assert.equal(lines[0], '/**', `${file}: первая строка`);
    assert.ok(lines[1].startsWith(` * ${file} — `), `${file}: вторая строка начинается с « * ${file} — »`);
  }
});

test('имена верхнего уровня не повторяются между файлами (так на настоящем проекте не бывает «already declared»)', () => {
  const owners = new Map();
  for (const file of FILES) {
    const code = readFileSync(new URL(`../apps-script/${file}`, import.meta.url), 'utf8');
    for (const m of code.matchAll(/^(?:const|let|var|function)\s+([A-Za-z0-9_$]+)/gm)) {
      assert.ok(!owners.has(m[1]), `«${m[1]}» объявлено и в ${owners.get(m[1])}, и в ${file}`);
      owners.set(m[1], file);
    }
  }
  assert.equal(owners.get('HEADER_COLOR_'), 'Setup.gs');
});
