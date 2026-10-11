// T1.4: корзина, оформление заказа, экран «Готово», ошибки отправки. Заглушка и поддельный бэкенд.
import { startServer, launch, check, failures } from './helpers.mjs';
import { readFileSync } from 'node:fs';

const SHOTS = process.argv[2];
const sample = JSON.parse(readFileSync(new URL('../../site/data/catalog.sample.json', import.meta.url), 'utf8'));
const NB = / /g;
const text = async (page, sel) => ((await page.textContent(sel)) || '').replace(NB, ' ').replace(/\s+/g, ' ').trim();
const shot = (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const waitH1 = (page, t) => page.waitForFunction(x => document.querySelector('h1')?.textContent.includes(x), t);
const browser = await launch();

// ---------- Поддельный бэкенд ----------
let script = [];          // очередь ответов на POST; пусто — успех
let calls = [];           // полученные заказы
const logCalls = [];      // пачки событий журнала
let catalogPatch = d => d;
const api = async (req, body) => {
  if (req.method === 'GET' && new URL(req.url, 'http://x').searchParams.get('action') === 'orderStatus') return { json: { ok: true, found: false } };
  if (req.method === 'GET') {
    const data = structuredClone(sample);
    catalogPatch(data);
    return { json: data };
  }
  const parsed = JSON.parse(body);
  if (parsed.action === 'log') { logCalls.push(parsed); return { json: { ok: true, logged: parsed.events.length } }; } // журнал посещений: не заказ
  calls.push({ contentType: req.headers['content-type'], body: parsed });
  return script.shift() ?? { json: { ok: true, orderNo: 'N-0042', total: parsed.clientTotal, duplicate: false } };
};
const config = 'export const API_URL = "__BASE__api";\nexport const SITE_TITLE = "Рынок у отеля";\nexport const FALLBACK_CONTACTS = { phone: "+84 000 000 000", whatsapp: "84000000000", telegram: "primer_operator" };\nexport const APP_VERSION = "test";\n';
const real = await startServer({ files: { 'config.js': config }, api });
const mock = await startServer();

async function open(base, { width = 390, height = 844, cart = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  await page.goto(base);
  await page.waitForSelector('.tile');
  if (cart) {
    await page.evaluate(c => localStorage.setItem('cart.v1', JSON.stringify(c)), cart);
    await page.reload();
    await page.waitForSelector('.tile');
  }
  return { ctx, page, problems };
}
const card = (page, name) => page.locator('.list .card').filter({ has: page.locator(`.card__link:text-is("${name}")`) });

// ====================================================================
// 1. Заглушка: весь путь гостя от каталога до «Готово»
// ====================================================================
{
  const { ctx, page, problems } = await open(mock.base);
  await page.click('.tile[href="#/c/fruits"]');
  await waitH1(page, 'Фрукты');
  await card(page, 'Манго').locator('.qty__add').click();
  await card(page, 'Манго').locator('[data-role="plus"]').click();
  await card(page, 'Помело').locator('.qty__add').click();
  await page.click('#cart-bar-link');
  await waitH1(page, 'Корзина');

  check((await page.locator('.cart-line').count()) === 2, 'корзина: две строки');
  check((await text(page, '.total__sum')) === '≈ 640 ₽', `корзина: итого «${await text(page, '.total__sum')}»`);
  check((await text(page, '.total__note')).includes('ориентировочные'), 'корзина: пометка «цены ориентировочные»');
  check(await page.isHidden('#cart-bar'), 'на экране корзины нижней панели нет');
  const suggested = await page.$$eval('.strip .card__title', ts => ts.map(t => t.textContent));
  check(suggested.length > 0 && !suggested.includes('Манго') && !suggested.includes('Помело'), `«Возможно, будет интересно» без уже выбранного: ${suggested.slice(0, 3).join(', ')}`);
  await shot(page, 't14-01-cart');

  // Количество: суммы обновляются на месте, фокус остаётся на кнопке
  const mangoLine = page.locator('.cart-line').filter({ has: page.locator('a:text-is("Манго")') });
  await mangoLine.locator('[data-role="plus"]').click();
  check((await text(page, '.total__sum')) === '≈ 780 ₽', `«+» в корзине: итого ${await text(page, '.total__sum')}`);
  check(((await mangoLine.locator('.cart-line__sum').textContent()) || '').replace(NB, ' ') === '≈ 560 ₽', 'сумма строки обновилась');
  check((await page.evaluate(() => document.activeElement.dataset.role)) === 'plus', 'фокус остался на «+»');

  // Добавление из «Возможно, будет интересно» → появляется строка, предложение исчезает
  const firstSuggested = suggested[0];
  await page.locator('.strip .card').first().locator('.qty__add').click();
  await page.waitForFunction(n => document.querySelectorAll('.cart-line').length === n, 3);
  check((await page.locator('.cart-line').count()) === 3, `добавили «${firstSuggested}» из предложений`);
  check(!(await page.$$eval('.strip .card__title', ts => ts.map(t => t.textContent))).includes(firstSuggested), 'добавленное пропало из предложений');
  await page.locator('.cart-line').last().getByRole('button', { name: /^Удалить/ }).click();
  await page.waitForFunction(n => document.querySelectorAll('.cart-line').length === n, 2);
  check((await text(page, '.total__sum')) === '≈ 780 ₽', 'удаление строки пересчитывает итог');

  // Оформление
  await page.click('text=Оставить заказ');
  await waitH1(page, 'Оформление заказа');
  check((await text(page, '.summary summary')) === 'Ваш заказ: 2 товара, ≈ 780 ₽', `свёрнутый состав: «${await text(page, '.summary summary')}»`);
  check((await page.locator('#f-adult').count()) === 0, 'без алкоголя галочки 18+ нет');
  check((await page.locator('input[name="messenger"]:checked').getAttribute('value')) === 'whatsapp', 'по умолчанию связь по WhatsApp');
  await shot(page, 't14-02-checkout');

  await page.click('button[type="submit"]');
  check(await page.isVisible('#err-phone') && (await text(page, '#err-phone')) === 'Введите номер телефона', 'пустой телефон: ошибка у поля');
  check((await page.evaluate(() => document.activeElement.id)) === 'f-phone', 'фокус на поле телефона');
  check((await page.getAttribute('#f-phone', 'aria-invalid')) === 'true', 'aria-invalid у телефона');
  await shot(page, 't14-03-checkout-error');
  await page.fill('#f-phone', '999 000 00 00');
  await page.click('button[type="submit"]');
  check((await text(page, '#err-phone')).includes('код страны'), 'телефон без кода страны: подсказка');
  await page.fill('#f-phone', '+7 000 000-00-00');
  await page.fill('#f-name', 'Ольга');
  await page.locator('label[for="m-telegram"]').click();
  await page.click('button[type="submit"]');
  check((await text(page, 'button[type="submit"]')) === 'Отправляем…' && await page.isDisabled('button[type="submit"]'), 'идёт отправка: кнопка заблокирована');
  await waitH1(page, 'принят');
  check((await text(page, 'h1')) === 'Заказ № TEST-0001 принят', `экран «Готово»: «${await text(page, 'h1')}»`);
  check((await text(page, '.done__text')).startsWith('С вами свяжутся по поводу заказа'), 'текст «С вами свяжутся…»');
  check((await page.locator('.contacts a').count()) === 3, 'на «Готово» есть кнопки связи');
  check(await page.isHidden('#cart-bar') && await page.isHidden('#cart-count'), 'после заказа корзина очищена');
  await shot(page, 't14-04-done');

  // «Назад» с экрана «Готово» ведёт на главную, а системная «назад» — не к форме
  await page.click('#back-btn');
  await waitH1(page, 'Рынок у отеля');
  check(true, '«Назад» на экране «Готово» → главная');
  await page.goBack();
  await page.goBack().catch(() => {});
  check(!(await page.url()).endsWith('#/checkout'), 'к форме после заказа вернуться нельзя');

  // Запомнили телефон, имя и способ связи
  await page.goto(mock.base + '#/c/fruits');
  await card(page, 'Манго').locator('.qty__add').click();
  await page.goto(mock.base + '#/checkout');
  await page.waitForSelector('#f-phone');
  check((await page.inputValue('#f-phone')) === '+7 000 000-00-00' || (await page.inputValue('#f-phone')) === '+70000000000', `телефон подставлен: ${await page.inputValue('#f-phone')}`);
  check((await page.inputValue('#f-name')) === 'Ольга', 'имя подставлено');
  check((await page.locator('input[name="messenger"]:checked').getAttribute('value')) === 'telegram', 'способ связи запомнен');

  check(problems.length === 0, `заглушка: консоль без ошибок${problems.length ? ': ' + problems.join(' | ') : ''}`);
  await ctx.close();
}

// ====================================================================
// 2. Заглушка: сценарии ошибок через ?mock=
// ====================================================================
for (const [scenario, expectText] of [['error', 'Не получилось отправить заказ'], ['rate', 'Слишком много заказов'], ['paused', 'Сейчас заказы не принимаются'], ['validation', 'Проверьте номер']]) {
  const { ctx, page } = await open(`${mock.base}?mock=${scenario}`, { cart: { 'fr-001': 1 } });
  await page.goto(`${mock.base}?mock=${scenario}#/checkout`);
  await page.waitForSelector('#f-phone');
  await page.fill('#f-phone', '+84 000 000 000');
  await page.click('button[type="submit"]');
  await page.waitForFunction(t => document.body.textContent.includes(t), expectText);
  check(true, `заглушка ?mock=${scenario}: «${expectText}»`);
  await ctx.close();
}

// ====================================================================
// 3. Настоящий API (поддельный бэкенд): запрос, повтор, ошибки
// ====================================================================
async function fillAndSend(page, phone = '8 000 000 00 00') {
  await page.fill('#f-phone', phone);
  await page.click('button[type="submit"]');
}

{
  // 3.1 Успех: тело запроса и тип содержимого
  calls = []; script = [];
  const { ctx, page, problems } = await open(real.base, { cart: { 'fr-001': 1.5, 'fr-008': 2 } });
  await page.goto(real.base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await page.fill('#f-name', 'Ольга');
  await page.fill('#f-room', '512');
  await page.fill('#f-comment', 'Манго поспелее');
  await fillAndSend(page);
  await waitH1(page, 'принят');
  const body = calls[0]?.body;
  check(calls.length === 1 && calls[0].contentType.startsWith('text/plain'), 'API: один POST с Content-Type text/plain');
  check(body.action === 'order' && body.phone === '+70000000000' && body.messenger === 'whatsapp', `API: телефон нормализован (${body?.phone})`);
  check(/^[A-Za-z0-9_-]{8,64}$/.test(body.visitorId || ''), `API: в заказе есть номер посетителя для журнала (${body?.visitorId})`);
  check(JSON.stringify(body.items) === JSON.stringify([{ id: 'fr-001', qty: 1.5 }, { id: 'fr-008', qty: 2 }]), 'API: состав заказа');
  check(body.name === 'Ольга' && body.room === '512' && body.comment === 'Манго поспелее' && body.website === '', 'API: имя, комната, комментарий, ловушка пуста');
  check(body.clientTotal === 860 && typeof body.catalogVersion === 'string' && body.clientOrderId.length >= 8, 'API: сумма, версия каталога, ID заказа');
  check((await text(page, 'h1')) === 'Заказ № N-0042 принят', 'номер заказа от сервера на экране «Готово»');
  check(problems.length === 0, `API: консоль без ошибок${problems.length ? ': ' + problems.join(' | ') : ''}`);
  await ctx.close();
}

{
  // 3.2 Поле-ловушка
  calls = []; script = [];
  const { ctx, page } = await open(real.base, { cart: { 'fr-001': 1 } });
  await page.goto(real.base + '#/checkout');
  await page.waitForSelector('#f-phone');
  const trapRect = await page.evaluate(() => document.getElementById('f-hp').getBoundingClientRect().right);
  check(trapRect < 0 && (await page.getAttribute('.hp', 'aria-hidden')) === 'true' && (await page.getAttribute('#f-hp', 'tabindex')) === '-1', 'ловушка за пределами экрана, скрыта от скринридера и клавиатуры');
  await page.evaluate(() => { document.getElementById('f-hp').value = 'http://spam.example'; });
  await fillAndSend(page);
  await waitH1(page, 'принят');
  check(calls[0].body.website === 'http://spam.example', 'заполненная ловушка уходит в поле website');
  await ctx.close();
}

{
  // 3.3 Нет сети → экран ошибки → повтор с тем же ID → успех; запасной WhatsApp
  calls = []; script = [];
  const { ctx, page } = await open(real.base, { cart: { 'fr-001': 2, 'al-001': 1 } });
  // Пропавшая сеть: первый POST обрывается в браузере (Chromium сам повторил бы оборванное соединение)
  let abortNext = true;
  const sentIds = [];
  await page.route('**/api', route => {
    if (route.request().method() === 'POST' && !route.request().postData().includes('"action":"log"')) {
      sentIds.push(JSON.parse(route.request().postData()).clientOrderId);
      if (abortNext) { abortNext = false; return route.abort('internetdisconnected'); }
    }
    return route.continue();
  });
  await page.goto(real.base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await page.check('#f-adult');
  await page.fill('#f-name', 'Ольга');
  await fillAndSend(page, '+84 000 000 000');
  await page.waitForSelector('#failure');
  check((await text(page, '#failure')).startsWith('Не получилось отправить заказ'), 'нет сети: экран ошибки');
  check((await page.evaluate(() => document.activeElement.id)) === 'failure', 'фокус на сообщении об ошибке');
  check((await page.inputValue('#f-phone')) === '+84 000 000 000' && (await page.inputValue('#f-name')) === 'Ольга', 'введённое не пропало');
  const wa = await page.getByRole('link', { name: 'Отправить через WhatsApp' }).getAttribute('href');
  const waText = decodeURIComponent(wa.split('?text=')[1]);
  check(wa.startsWith('https://wa.me/84000000000?text='), `WhatsApp: адрес ${wa.slice(0, 40)}…`);
  check(waText.includes('Здравствуйте! Хочу заказать:') && waText.includes('• Манго — 2 кг') && waText.includes('Итого ≈ 1 310 ₽') && waText.includes('Телефон: +84000000000') && waText.includes('Имя: Ольга'), 'WhatsApp: готовый текст заказа');
  await shot(page, 't14-05-send-error');
  await page.getByRole('button', { name: 'Попробовать ещё раз' }).click();
  await waitH1(page, 'принят');
  check(sentIds.length === 2 && sentIds[0] === sentIds[1] && calls.length === 1, 'повтор отправляется с тем же clientOrderId');
  check(calls[0].body.adultConfirmed === true, '18+ подтверждено в запросе');
  await ctx.close();
}

{
  // 3.4 Двойное нажатие — один заказ
  calls = []; script = [{ delay: 600, json: { ok: true, orderNo: 'N-0007', total: 280, duplicate: false } }];
  const { ctx, page } = await open(real.base, { cart: { 'fr-001': 1 } });
  await page.goto(real.base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await page.fill('#f-phone', '+84 000 000 000');
  await page.dispatchEvent('form', 'submit');
  await page.dispatchEvent('form', 'submit');
  await waitH1(page, 'принят');
  check(calls.length === 1, `двойная отправка: на сервер дошёл ${calls.length} запрос`);
  await ctx.close();
}

{
  // 3.5 Галочка 18+
  calls = []; script = [];
  const { ctx, page } = await open(real.base, { cart: { 'al-001': 1 } });
  await page.goto(real.base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await page.fill('#f-phone', '+84 000 000 000');
  await page.click('button[type="submit"]');
  check((await text(page, '#err-adult')).includes('18'), 'алкоголь без галочки: ошибка');
  check((await page.evaluate(() => document.activeElement.id)) === 'f-adult' && calls.length === 0, 'фокус на галочке, запрос не ушёл');
  await shot(page, 't14-06-adult-error');
  await page.check('#f-adult');
  await page.click('button[type="submit"]');
  await waitH1(page, 'принят');
  check(calls.length === 1, 'с галочкой заказ уходит');
  await ctx.close();
}

{
  // 3.6 Товар закончился, пока гость выбирал
  calls = []; script = [{ json: { ok: false, error: 'ITEM_UNAVAILABLE', message: 'x', items: ['fr-001'] } }];
  const { ctx, page } = await open(real.base, { cart: { 'fr-001': 1, 'fr-008': 1 } });
  await page.goto(real.base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await fillAndSend(page, '+84 000 000 000');
  await page.waitForSelector('#notice');
  check((await text(page, '#notice')).includes('«Манго» сейчас недоступен, мы убрали его из корзины'), `недоступный товар: «${await text(page, '#notice')}»`);
  check((await text(page, '.summary summary')) === 'Ваш заказ: 1 товар, ≈ 220 ₽', 'состав заказа обновился');
  check((await page.inputValue('#f-phone')) === '+84 000 000 000', 'телефон остался');
  await page.click('button[type="submit"]');
  await waitH1(page, 'принят');
  check(calls.length === 2 && JSON.stringify(calls[1].body.items) === JSON.stringify([{ id: 'fr-008', qty: 1 }]) && calls[0].body.clientOrderId !== calls[1].body.clientOrderId, 'повторная отправка без Манго, с новым ID (состав изменился)');
  await ctx.close();
}

{
  // 3.7 Ошибка проверки на сервере, пауза, лимит
  calls = []; script = [{ json: { ok: false, error: 'VALIDATION', message: 'Проверьте данные', fields: { phone: 'Проверьте номер' } } }];
  let { ctx, page } = await open(real.base, { cart: { 'fr-001': 1 } });
  await page.goto(real.base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await fillAndSend(page, '+84 000 000 000');
  await page.waitForFunction(() => document.getElementById('err-phone')?.textContent === 'Проверьте номер');
  check((await page.getAttribute('#f-phone', 'aria-invalid')) === 'true', 'ошибка сервера показана у поля телефона');
  await ctx.close();

  script = [{ json: { ok: false, error: 'ORDERS_PAUSED', message: 'x' } }];
  ({ ctx, page } = await open(real.base, { cart: { 'fr-001': 1 } }));
  await page.goto(real.base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await fillAndSend(page, '+84 000 000 000');
  await page.waitForSelector('.notice--danger');
  check((await text(page, '.notice--danger')).includes('Сейчас заказы не принимаются') && (await page.locator('#f-phone').count()) === 0, 'сервер: заказы на паузе → форма убрана, есть контакты');
  await ctx.close();

  script = [{ json: { ok: false, error: 'RATE_LIMIT', message: 'x' } }];
  ({ ctx, page } = await open(real.base, { cart: { 'fr-001': 1 } }));
  await page.goto(real.base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await fillAndSend(page, '+84 000 000 000');
  await page.waitForSelector('#failure');
  check((await text(page, '#failure')).includes('Слишком много заказов') && (await page.getByRole('button', { name: 'Попробовать ещё раз' }).count()) === 0 && (await page.getByRole('link', { name: 'Отправить через WhatsApp' }).count()) === 1, 'лимит: только WhatsApp, без повтора');
  await ctx.close();
}

{
  // 3.8 orders_enabled = false, недоступные товары, пустая корзина
  catalogPatch = d => { d.settings.orders_enabled = false; };
  let { ctx, page } = await open(real.base, { cart: { 'fr-001': 1 } });
  await page.goto(real.base + '#/cart');
  await waitH1(page, 'Корзина');
  check((await page.getByText('Оставить заказ').count()) === 0 && (await text(page, '.notice--danger')).includes('Сейчас заказы не принимаются'), 'orders_enabled=false: в корзине вместо кнопки плашка и контакты');
  await shot(page, 't14-07-cart-paused');
  await page.goto(real.base + '#/checkout');
  await waitH1(page, 'Оформление заказа');
  check((await page.locator('form').count()) === 0 && (await text(page, '.notice--danger')).includes('Сейчас заказы не принимаются'), 'orders_enabled=false: на оформлении формы нет');
  await ctx.close();
  catalogPatch = d => d;

  ({ ctx, page } = await open(real.base, { cart: { 'fr-001': 1, 'fr-010': 1, 'zz-999': 2 } }));
  await page.goto(real.base + '#/cart');
  await waitH1(page, 'Корзина');
  check((await text(page, '.notice')).includes('Дуриан') && (await text(page, '.notice')).includes('больше нет в каталоге'), 'недоступные товары отмечены в корзине');
  check((await page.locator('.cart-line').count()) === 1 && (await text(page, '.total__sum')) === '≈ 280 ₽', 'в итог входят только доступные');
  await shot(page, 't14-08-cart-unavailable');
  calls = []; script = [];
  await page.goto(real.base + '#/checkout');
  await page.waitForSelector('#f-phone');
  await fillAndSend(page, '+84 000 000 000');
  await waitH1(page, 'принят');
  check(JSON.stringify(calls[0].body.items) === JSON.stringify([{ id: 'fr-001', qty: 1 }]), 'недоступные в заказ не попали');
  await ctx.close();

  ({ ctx, page } = await open(real.base, { cart: { 'fr-010': 1 } }));
  await page.goto(real.base + '#/cart');
  await waitH1(page, 'Корзина');
  await page.click('text=Убрать недоступные');
  await page.waitForFunction(() => document.body.textContent.includes('Корзина пуста'));
  check(true, '«Убрать недоступные» очищает корзину');
  await page.goto(real.base + '#/checkout');
  await waitH1(page, 'Оформление заказа');
  check((await text(page, '#app')).includes('В корзине нет доступных товаров'), 'оформление с пустой корзиной');
  await ctx.close();
}

// ====================================================================
// 4. Ширины экрана: корзина и форма без горизонтальной прокрутки
// ====================================================================
for (const width of [360, 430]) {
  const { ctx, page } = await open(real.base, { width, height: 800, cart: { 'fr-001': 1.5, 'fr-008': 2, 'al-001': 1 } });
  for (const hash of ['#/cart', '#/checkout', '#/done/N-0042']) {
    await page.goto(real.base + hash);
    await page.waitForSelector('h1');
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(o <= 0, `[${width}] ${hash}: нет горизонтальной прокрутки (${o}px)`);
  }
  await ctx.close();
}

// Журнал посещений: события дошли до сервера, но телефонов и имён в них нет
check(logCalls.length > 0 && logCalls.every(b => /^[A-Za-z0-9_-]{8,64}$/.test(b.visitorId) && b.events.length > 0), `журнал: пачек событий ${logCalls.length}, у каждой есть посетитель`);
check(!/000 000|70000000000|Ольга|Манго поспелее/.test(JSON.stringify(logCalls)), 'журнал: в событиях нет телефона, имени и комментария');
check(logCalls.flatMap(b => b.events).some(e => e.k === 'order'), 'журнал: событие отправки заказа записано');

await browser.close();
real.server.close();
mock.server.close();
console.log(failures() ? `\nПровалено проверок: ${failures()}` : '\nВсе проверки пройдены');
process.exit(failures() ? 1 : 0);
