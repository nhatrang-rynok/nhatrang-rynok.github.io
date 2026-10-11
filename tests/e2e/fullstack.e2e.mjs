// Сквозная проверка: настоящий сайт в браузере разговаривает с настоящим кодом Apps Script (.gs),
// который работает на подставных сервисах Google. Так проверяется, что контракт сайта и сервера совпадает.
import { readFileSync } from 'node:fs';
import { startServer, launch, check, failures } from './helpers.mjs';
import { loadGas, parseCsv } from '../gas-loader.js';
import { createGoogle } from '../gas-fakes.js';

const SHOTS = process.argv[2];
const FILES = ['Logic.gs', 'Catalog.gs', 'Orders.gs', 'Notify.gs', 'Journal.gs', 'Main.gs', 'Setup.gs'];
const TOKEN = '123456789:AAFakeTokenForTestsOnly-0123456789abc';
const NB = / /g;

// «Google»: таблица с примерами товаров и настройками
const google = createGoogle();
const g = loadGas(FILES, google.globals);
g.setup();
const csv = parseCsv(readFileSync(new URL('../../content/descriptions/sample-products.csv', import.meta.url), 'utf8'));
google.ss.getSheetByName('Товары').getRange(1, 1, csv.length, csv[0].length).setValues(csv.map(r => r.map(v => (v === 'TRUE' ? true : v === 'FALSE' ? false : v))));
google.props.set('TELEGRAM_BOT_TOKEN', TOKEN);
google.props.set('TELEGRAM_CHAT_IDS', '111111111');
const sheet = name => google.ss.getSheetByName(name);

const api = async (req, body, url) => {
  if (req.method === 'GET') return { json: JSON.parse(g.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent()) };
  return { json: JSON.parse(g.doPost({ postData: { contents: body } }).getContent()) };
};
const config = 'export const API_URL = "__BASE__api";\nexport const SITE_TITLE = "Рынок у отеля";\nexport const FALLBACK_CONTACTS = { phone: "+84 000 000 000", whatsapp: "84000000000", telegram: "primer_operator" };\nexport const APP_VERSION = "test";\n';
const { server, base } = await startServer({ files: { 'config.js': config }, api });
const browser = await launch();
const text = async (page, sel) => ((await page.textContent(sel)) || '').replace(NB, ' ').replace(/\s+/g, ' ').trim();
const waitH1 = (page, t) => page.waitForFunction(x => document.querySelector('h1')?.textContent.includes(x), t);

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
  await page.goto(base);
  await page.waitForSelector('.tile');
  return { ctx, page, problems };
}
const card = (page, name) => page.locator('.list .card').filter({ has: page.locator(`.card__link:text-is("${name}")`) });

// ---- 1. Каталог из «таблицы» на сайте
{
  const { ctx, page, problems } = await open();
  check((await page.locator('.tile').count()) === 2, 'каталог с сервера: две категории');
  check((await text(page, '.tile__name')) === 'Фрукты', 'названия категорий из таблицы');
  await page.click('.tile[href="#/c/fruits"]');
  await waitH1(page, 'Фрукты');
  check((await page.locator('.list .card').count()) === 11, 'каталог с сервера: 11 фруктов');
  check((await text(page, '.card:has(.card__link:text-is("Манго")) .card__price')) === '≈ 280 ₽ / кг', 'цена из «Цена ₫» пересчитана по курсу: 84 000 ₫ → 280 ₽');
  check(await card(page, 'Дуриан').locator('.qty__out').isVisible(), 'товар «Сезон закончился» помечен');
  check(problems.length === 0, `консоль без ошибок${problems.length ? ': ' + problems.join(' | ') : ''}`);
  await ctx.close();
}

// ---- 2. Заказ через сайт → запись в таблицу → Telegram → «Готово»
{
  const { ctx, page } = await open();
  await page.click('.tile[href="#/c/fruits"]');
  await waitH1(page, 'Фрукты');
  await card(page, 'Манго').locator('.qty__add').click();
  await card(page, 'Манго').locator('[data-role="plus"]').click();
  await card(page, 'Помело').locator('.qty__add').click();
  await page.click('#cart-bar-link');
  await waitH1(page, 'Корзина');
  await page.click('text=Оставить заказ');
  await waitH1(page, 'Оформление заказа');
  await page.fill('#f-phone', '8 000 000 00 00');
  await page.fill('#f-name', 'Ольга');
  await page.fill('#f-room', '512');
  await page.fill('#f-comment', '=HYPERLINK("http://evil","x") Манго поспелее');
  await page.locator('label[for="m-telegram"]').click();
  await page.click('button[type="submit"]');
  await waitH1(page, 'принят');
  check((await text(page, 'h1')) === 'Заказ № N-0001 принят', `номер заказа с сервера: «${await text(page, 'h1')}»`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/t24-done.png` });

  const orders = sheet('Заказы').values();
  const o = Object.fromEntries(orders[0].map((h, i) => [h, orders[1]?.[i]]));
  check(o['Номер'] === 'N-0001' && o['Телефон'] === "'+70000000000" && o['Связь'] === 'Telegram' && o['Имя'] === 'Ольга' && o['Комната'] === '512', 'в «Заказы»: номер, нормализованный телефон, способ связи, имя, комната');
  check(o['Комментарий'].startsWith("'=HYPERLINK"), 'формула в комментарии записана текстом');
  check(String(o['Состав']).replace(NB, ' ') === 'Манго — 1,5 кг × 280 ₽ = 420 ₽; Помело — 1 шт × 220 ₽ = 220 ₽' && o['Сумма ₽'] === 640, `в «Заказы»: состав и сумма (${o['Сумма ₽']})`);
  check(o['Уведомление'] === 'ok', 'итог уведомления «ok»');
  check(sheet('Позиции заказов').count() === 3, 'в «Позиции заказов»: две строки');
  check(google.fetches.length === 1 && google.fetches[0].payload.text.includes('Новый заказ N-0001') && google.fetches[0].payload.reply_markup.inline_keyboard[0][1].url === 'https://t.me/+70000000000', 'в Telegram ушло сообщение с кнопками');
  check(await page.isHidden('#cart-count'), 'корзина очищена');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); // отправляет накопленный журнал сразу
  await page.waitForTimeout(500);
  await ctx.close();
}

// ---- 3. Алкоголь и 18+
{
  const { ctx, page } = await open();
  await page.click('.tile[href="#/c/alcohol"]');
  await waitH1(page, 'Ром');
  await card(page, 'Ром кокосовый, 0,7 л').locator('.qty__add').click();
  await page.goto(base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await page.fill('#f-phone', '+84 000 000 000');
  await page.click('button[type="submit"]');
  check((await text(page, '#err-adult')).includes('18'), 'алкоголь: сайт требует галочку');
  await page.check('#f-adult');
  await page.click('button[type="submit"]');
  await waitH1(page, 'принят');
  const o = sheet('Заказы').values();
  check(sheet('Заказы').count() === 3 && o[2][o[0].indexOf('18+ подтверждено')] === true, 'в таблице отмечено подтверждение 18+');
  await ctx.close();
}

// ---- 4. Ответ на заказ не дошёл до браузера (так было на телефоне с Яндекс.Браузером)
// 4а. Отдельная проверка «принят ли заказ» работает: гость сразу видит «принят», дубля нет
{
  const { ctx, page } = await open();
  await page.goto(base + '#/c/fruits');
  await page.waitForSelector('.card');
  await card(page, 'Манго').locator('.qty__add').click();
  await page.goto(base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await page.fill('#f-phone', '+84 000 000 777');
  let drop = true;
  await page.route('**/api', route => {
    if (route.request().method() === 'POST' && !route.request().postData().includes('"action":"log"') && drop) {
      drop = false;
      // Сервер принял заказ, но ответ до гостя не дошёл
      route.fetch().then(() => route.abort('internetdisconnected'));
      return;
    }
    route.continue();
  });
  const before = sheet('Заказы').count();
  await page.click('button[type="submit"]');
  await waitH1(page, 'принят');
  check(sheet('Заказы').count() === before + 1, 'заказ принят один раз, гость увидел «принят» без повторной отправки');
  check(google.fetches.length === 3, `в Telegram ушло одно сообщение на заказ (${google.fetches.length} всего)`);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForTimeout(500);
  const jr = sheet('Журнал').values();
  check(jr.some(r => r[3] === 'Проверка заказа' && /найден/.test(r[4])), 'в «Журнале»: сервер отметил проверку заказа');
  check(jr.some(r => r[3] === 'Заказ (сайт)' && /ответ не получен.*Failed to fetch|ответ не получен/.test(r[4])), 'в «Журнале»: причина обрыва записана для разбора');
  await ctx.close();
}

// 4б. Не работает и проверка: гость видит ошибку, «Попробовать ещё раз» не создаёт дубль
{
  const { ctx, page } = await open();
  await page.goto(base + '#/c/fruits');
  await page.waitForSelector('.card');
  await card(page, 'Манго').locator('.qty__add').click();
  await page.goto(base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await page.fill('#f-phone', '+84 000 000 778');
  let dropPost = true;
  let blockStatus = true;
  await page.route('**/api**', route => {
    const req = route.request();
    if (req.method() === 'POST' && !req.postData().includes('"action":"log"') && dropPost) {
      dropPost = false;
      route.fetch().then(() => route.abort('internetdisconnected'));
      return;
    }
    if (req.method() === 'GET' && req.url().includes('action=orderStatus') && blockStatus) {
      route.abort('internetdisconnected');
      return;
    }
    route.continue();
  });
  const before = sheet('Заказы').count();
  await page.click('button[type="submit"]');
  await page.waitForSelector('#failure', { timeout: 20000 });
  blockStatus = false;
  await page.getByRole('button', { name: 'Попробовать ещё раз' }).click();
  await waitH1(page, 'принят');
  check(sheet('Заказы').count() === before + 1, 'нет ни ответа, ни проверки: после «Попробовать ещё раз» заказ всё равно один');
  await ctx.close();
}

// ---- 5. Пауза заказов из таблицы доходит до сайта
{
  const settings = sheet('Настройки');
  const row = settings.values().findIndex(r => r[0] === 'orders_enabled') + 1;
  settings.getRange(row, 2).setValue(false);
  g.handleEdit({ range: settings.getRange(row, 2) });
  const { ctx, page } = await open();
  check((await text(page, '.notice--danger')).includes('Сейчас заказы не принимаются'), 'orders_enabled=false в таблице → плашка на сайте');
  await page.goto(base + '#/c/fruits');
  await page.waitForSelector('.card');
  await card(page, 'Манго').locator('.qty__add').click();
  await page.goto(base + '#/cart');
  await waitH1(page, 'Корзина');
  check((await page.getByText('Оставить заказ').count()) === 0, 'в корзине нет кнопки заказа');
  settings.getRange(row, 2).setValue(true);
  g.handleEdit({ range: settings.getRange(row, 2) });
  await ctx.close();
}

// ---- 6. Правка цены в таблице видна на сайте
{
  const products = sheet('Товары');
  const dongCol = products.values()[0].indexOf('Цена ₫') + 1;
  products.getRange(2, dongCol).setValue(90000);
  g.handleEdit({ range: products.getRange(2, dongCol) });
  const { ctx, page } = await open();
  await page.goto(base + '#/c/fruits');
  await page.waitForSelector('.card');
  check((await text(page, '.card:has(.card__link:text-is("Манго")) .card__price')) === '≈ 300 ₽ / кг', 'новая цена из таблицы: 90 000 ₫ → 300 ₽');
  await ctx.close();
}

// ---- 7. Журнал: заходы, экраны, нажатия, корзина и заказ видны в листе «Журнал», личных данных там нет
{
  const logRows = () => {
    const s = sheet('Журнал');
    const headers = s.values()[0];
    return s.values().slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
  };
  const siteEvents = () => logRows().filter(r => r['Источник'] === 'Сайт').map(r => r['Событие']);
  const flushNow = async page => { await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(500); };

  const rows = logRows();
  if (process.env.DUMP_LOG) rows.forEach(r => console.log([r['Время'].toISOString().slice(11, 23), r['Уровень'], r['Источник'], r['Событие'], r['Подробности'], r['Экран'], r['Посетитель'], r['Заказ']].join(' | ')));
  const known = new Set(rows.map(r => r['Событие']));
  for (const name of ['Заказ записан в таблицу', 'Telegram: отправлено', 'Заказ (сайт)', 'Запрос каталога', 'Вход на сайт', 'Открыт экран', 'Нажатие', 'Корзина', 'Каталог (сайт)']) {
    check(known.has(name), `в «Журнале» есть «${name}»`);
  }
  const sent = rows.find(r => r['Событие'] === 'Заказ (сайт)' && /принят/.test(r['Подробности']));
  check(Boolean(sent) && /^N-\d{4}$/.test(sent['Заказ']), `событие «Заказ (сайт)» привязано к номеру заказа (${sent?.['Заказ']})`);
  check(rows.find(r => r['Событие'] === 'Вход на сайт')['Устройство'].includes('390×844'), 'устройство записано: ' + rows.find(r => r['Событие'] === 'Вход на сайт')['Устройство']);
  const everything = JSON.stringify(rows);
  for (const secret of ['8 000 000 00 00', '70000000000', '84 000 000 000', 'Ольга', 'поспелее', TOKEN]) {
    check(!everything.includes(secret), `в «Журнале» нет «${secret}»`);
  }

  // Саня выключил журнал: сайт ничего не присылает и не пишет про запись
  const settings = sheet('Настройки');
  const row = settings.values().findIndex(r => r[0] === 'log_events') + 1;
  settings.getRange(row, 2).setValue(false);
  g.handleEdit({ range: settings.getRange(row, 2) });
  const before = siteEvents().length;
  const { ctx, page } = await open();
  check((await page.getByText('Мы записываем, какие страницы открывают').count()) === 0, 'log_events=выкл: пометки про журнал на главной нет');
  await page.click('.tile[href="#/c/fruits"]');
  await waitH1(page, 'Фрукты');
  await flushNow(page);
  check(siteEvents().length === before, 'log_events=выкл: новых событий с сайта нет');
  settings.getRange(row, 2).setValue(true);
  g.handleEdit({ range: settings.getRange(row, 2) });
  await ctx.close();

  const second = await open();
  check((await second.page.getByText('Мы записываем, какие страницы открывают').count()) === 1, 'log_events=вкл: на главной есть пометка про журнал');
  await second.ctx.close();
}

await browser.close();
server.close();
console.log(failures() ? `\nПровалено проверок: ${failures()}` : '\nВсе проверки пройдены');
process.exit(failures() ? 1 : 0);
