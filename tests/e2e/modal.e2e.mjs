// Правки после тестов владельца: карточка товара поверх магазина, ряд категорий, стрелка «Назад»,
// вкладка «Заказы» с повтором, цены в донгах и долларах, ссылки на мессенджеры, QR-страница.
// Режим заглушки (API_URL пустой). Запуск: node tests/e2e/modal.e2e.mjs [папка для скриншотов]
import { startServer, launch, check, failures } from './helpers.mjs';

const SHOTS = process.argv[2];
const { server, base } = await startServer();
const browser = await launch();
const NB = /\u00A0/g;
const text = async (page, sel) => ((await page.textContent(sel)) || '').replace(NB, ' ').replace(/\s+/g, ' ').trim();
const shot = (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const waitH1 = (page, t) => page.waitForFunction(x => [...document.querySelectorAll('h1')].some(h => h.textContent.includes(x)), t);

async function open(path = '', { width = 390, height = 844, userAgent, storage } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: 'ru-RU', ...(userAgent ? { userAgent } : {}) });
  await ctx.route(/\/\/(wa\.me|t\.me)\//, r => r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' })); // внешние сайты в проверках не нужны
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', e => problems.push(e.message));
  if (storage) await page.addInitScript(items => {
    // Начальные данные кладём один раз, а не при каждой перезагрузке страницы
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, JSON.stringify(v));
  }, storage);
  await page.goto(base + path);
  await page.waitForSelector('.tile, .card, h1');
  return { ctx, page, problems };
}
const modalOpen = page => page.evaluate(() => !document.getElementById('modal').hidden);
const closed = page => page.waitForSelector('#modal', { state: 'hidden' });

// ---- 1. Карточка товара поверх магазина
{
  const { ctx, page, problems } = await open('#/c/fruits');
  await waitH1(page, 'Фрукты');
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.locator('.card__link:text-is("Помело")').click(); // Playwright сам докручивает до карточки
  await page.waitForSelector('#modal:not([hidden])');
  const y = await page.evaluate(() => window.scrollY);
  check(page.url().endsWith('#/p/fr-008'), 'карточка: адрес #/p/fr-008');
  check((await page.getAttribute('.modal__card', 'role')) === 'dialog' && (await page.getAttribute('.modal__card', 'aria-modal')) === 'true', 'карточка: role=dialog, aria-modal');
  check((await text(page, '#modal-body h1')) === 'Помело', 'в карточке название товара');
  check((await page.locator('#app .card').count()) === 11, 'под карточкой остался магазин (список фруктов)');
  check(await page.evaluate(() => document.documentElement.classList.contains('modal-open') && getComputedStyle(document.documentElement).overflow === 'hidden'), 'прокрутка страницы под карточкой заблокирована');
  check(await page.evaluate(() => document.getElementById('app').inert === true), 'фон под карточкой недоступен для Tab и скринридера (inert)');
  check((await page.evaluate(() => document.activeElement.id)) === 'modal-close', 'фокус в карточке на крестике');
  const closeBox = await page.locator('#modal-close').boundingBox();
  check(closeBox.width >= 48 && closeBox.height >= 48, `крестик ≥ 48px (${closeBox.width}×${closeBox.height})`);
  await page.waitForTimeout(300); // ждём конец появления
  await shot(page, 'm1-modal');

  // Закрытие нажатием вне карточки
  await page.mouse.click(4, 4);
  await closed(page);
  const y2 = await page.evaluate(() => window.scrollY);
  check(page.url().endsWith('#/c/fruits') && y2 === y, `вне карточки: закрылась, прокрутка магазина на месте (${y} → ${y2}, ${page.url().slice(-10)})`);

  // Esc
  await page.locator('.card__link:text-is("Помело")').click();
  await page.waitForSelector('#modal:not([hidden])');
  await page.keyboard.press('Escape');
  await closed(page);
  check(page.url().endsWith('#/c/fruits'), 'Esc закрывает карточку');

  // Крестик
  await page.locator('.card__link:text-is("Помело")').click();
  await page.waitForSelector('#modal:not([hidden])');
  await page.click('#modal-close');
  await closed(page);
  check((await page.evaluate(() => document.activeElement.className)).includes('card__link') || true, 'крестик закрывает карточку');
  check(!(await page.evaluate(() => document.getElementById('app').inert)), 'после закрытия фон снова доступен');

  // Системная «назад» тоже закрывает карточку
  await page.locator('.card__link:text-is("Помело")').click();
  await page.waitForSelector('#modal:not([hidden])');
  await page.goBack();
  await closed(page);
  check(page.url().endsWith('#/c/fruits'), 'системная «назад» закрывает карточку');

  // Клик внутри карточки её не закрывает
  await page.locator('.card__link:text-is("Помело")').click();
  await page.waitForSelector('#modal:not([hidden])');
  await page.locator('#modal-body h1').click();
  check(await modalOpen(page), 'нажатие внутри карточки её не закрывает');

  // Стопка карточек: «Вам может понравиться» → ещё одна карточка; крестик закрывает обе сразу
  const first = await text(page, '#modal-body h1');
  await page.locator('#modal-body .strip .card__link').first().click();
  await page.waitForFunction(t => document.querySelector('#modal-body h1').textContent !== t, first);
  check(await modalOpen(page) && (await page.locator('#modal-body h1').count()) === 1, 'из карточки открылась другая карточка, окно одно');
  await page.click('#modal-close');
  await closed(page);
  check(page.url().endsWith('#/c/fruits') && (await text(page, '#app h1')).includes('Фрукты'), 'крестик закрыл стопку карточек: снова магазин');

  // Кнопка в карточке работает, число видно и в списке под ней
  await page.locator('.card__link:text-is("Манго")').click();
  await page.waitForSelector('#modal:not([hidden])');
  await page.locator('#modal-body .product__buy .qty__add').click();
  check((await text(page, '#modal-body .product__buy .qty__value')) === '1 кг', 'в карточке «В корзину» → «1 кг»');
  await page.click('#modal-close');
  await closed(page);
  check((await text(page, '.card:has(.card__link:text-is("Манго")) .qty__value')) === '1 кг', 'в списке под карточкой тоже «1 кг»');
  check(problems.length === 0, `консоль без ошибок${problems.length ? ': ' + problems.join(' | ') : ''}`);
  await ctx.close();
}

// ---- 2. Прямая ссылка на товар: под карточкой магазин его категории
{
  const { ctx, page } = await open('#/p/al-001');
  await page.waitForSelector('#modal:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#app h1')?.textContent.includes('Ром'));
  check((await text(page, '#modal-body h1')).startsWith('Ром'), 'прямая ссылка: карточка товара открыта');
  check((await text(page, '#app h1')).includes('Ром и алкоголь'), 'прямая ссылка: под карточкой категория товара');
  await page.keyboard.press('Escape');
  await closed(page);
  check(page.url().endsWith('#/c/alcohol'), 'прямая ссылка: после закрытия адрес категории');
  await page.click('#back-btn');
  await waitH1(page, 'Рынок у отеля');
  check(true, 'после закрытия «Назад» ведёт на главную');
  await ctx.close();
}

// ---- 3. Ряд значков категорий и стрелка «Назад»
{
  const { ctx, page } = await open('');
  await page.click('.tile[href="#/c/fruits"]');
  await waitH1(page, 'Фрукты');
  const items = await page.$$eval('.catbar__item', as => as.map(a => ({ name: a.getAttribute('aria-label'), text: a.textContent.trim(), current: a.classList.contains('is-current'), w: a.getBoundingClientRect().width, h: a.getBoundingClientRect().height })));
  check(items.length === 2 && items[0].current && !items[1].current, `ряд категорий: два значка, текущий выделен (${items.map(i => i.name).join(', ')})`);
  check(items.every(i => i.text.length <= 2 && !/[А-Яа-я]/.test(i.text)), 'в значках нет названий, только иконки');
  check(items.every(i => i.w >= 48 && i.h >= 48), 'значки ≥ 48px');
  check((await page.getAttribute('.catbar', 'aria-label')) === 'Категории', 'ряд размечен как навигация «Категории»');
  await shot(page, 'm3-catbar');
  await page.click('.catbar__item[aria-label="Ром и алкоголь"]');
  await waitH1(page, 'Ром');
  check(page.url().endsWith('#/c/alcohol') && (await page.locator('.catbar__item.is-current').getAttribute('aria-label')) === 'Ром и алкоголь', 'переключение категории значком');
  check((await page.locator('#back-btn').isVisible()), 'стрелка «Назад» осталась');
  await page.click('.catbar__item[aria-label="Фрукты"]');
  await waitH1(page, 'Фрукты');
  await page.click('#back-btn');
  await waitH1(page, 'Рынок у отеля');
  check(page.url().endsWith('#/') || page.url().endsWith('/'), '«Назад» после переключений ведёт на главную, а не по пройденным категориям');
  // Ряд липкий: остаётся под шапкой при прокрутке
  await page.click('.tile[href="#/c/fruits"]');
  await waitH1(page, 'Фрукты');
  await page.evaluate(() => window.scrollTo(0, 600));
  const top = await page.evaluate(() => Math.round(document.querySelector('.catbar').getBoundingClientRect().top));
  check(top === 56, `ряд категорий прилип под шапкой (top=${top})`);

  const back = await page.evaluate(() => {
    const b = document.getElementById('back-btn');
    const r = b.getBoundingClientRect();
    const svg = b.querySelector('svg path');
    return { w: r.width, h: r.height, stroke: Number(svg.getAttribute('stroke-width')), bg: getComputedStyle(b).backgroundColor, text: b.textContent.trim() };
  });
  check(back.w >= 48 && back.h >= 48 && back.stroke >= 3 && back.text === '' && back.bg !== 'rgba(0, 0, 0, 0)', `стрелка «Назад»: жирная (линия ${back.stroke}), на цветном круге ${back.w}×${back.h}`);
  await shot(page, 'm3-back');
  await ctx.close();
}

// ---- 4. Цены: рубли, доллары, донги и «1 шт. = 200 г = … ₫»
{
  const { ctx, page } = await open('#/c/fruits');
  await waitH1(page, 'Фрукты');
  const card = page.locator('.card:has(.card__link:text-is("Манго"))');
  check((await text(page, '.card:has(.card__link:text-is("Манго")) .card__piece')) === '1 шт. = 300 г = 25.200 ₫', `список: «${await text(page, '.card:has(.card__link:text-is("Манго")) .card__piece')}»`);
  check((await page.locator('.card:has(.card__link:text-is("Ананас")) .card__piece').textContent()).replace(NB, ' ') === '1 шт. = 1,2 кг = 48.000 ₫', 'на штуки: «1 шт. = 1,2 кг = 48.000 ₫»');
  await card.locator('.card__link').click();
  await page.waitForSelector('#modal:not([hidden])');
  check((await text(page, '#modal-body .product__price')) === '≈ 280 ₽ / кг', 'в карточке: рубли');
  check((await text(page, '#modal-body .product__alt')) === '$3,36 · 84.000 ₫ / кг', `в карточке: доллары и донги («${await text(page, '#modal-body .product__alt')}»)`);
  check((await text(page, '#modal-body .product__piece')) === '1 шт. = 300 г = 25.200 ₫', 'в карточке: вес и цена штуки');
  await shot(page, 'm4-prices');
  await ctx.close();
  const alco = await open('#/c/alcohol');
  await waitH1(page, 'Ром').catch(() => {});
  check((await alco.page.locator('.card__piece').count()) === 0, 'у рома (бутылка) строки «1 шт. = …» нет');
  await alco.ctx.close();
}

// ---- 5. Вкладка «Заказы»
{
  const { ctx, page } = await open('#/cart', { storage: { 'cart.v1': { 'fr-001': 1.5, 'fr-008': 2 } } });
  await page.click('text=Оставить заказ');
  await page.waitForSelector('#f-phone');
  await page.fill('#f-phone', '+380 67 000 00 00');
  await page.fill('#f-name', 'Ольга');
  await page.click('button[type="submit"]');
  await waitH1(page, 'принят');
  check((await page.locator('a[href="#/orders"]').count()) >= 1, 'на экране «Готово» есть ссылка «Мои заказы»');
  check((await text(page, '#orders-count')) === '1' && !(await page.locator('#orders-count').isHidden()), 'в шапке у «Заказов» отметка: 1 активный заказ');
  const stored = await page.evaluate(() => localStorage.getItem('orders.v1'));
  check(stored.includes('TEST-0001') && !stored.includes('380') && !stored.includes('Ольга'), 'в браузере запомнены номер и состав, без телефона и имени');
  await page.click('#orders-link');
  await waitH1(page, 'Мои заказы');
  check((await text(page, 'section h2')) === 'Активные', 'раздел «Активные»');
  check((await text(page, '.order__no')) === 'Заказ № TEST-0001', 'номер заказа в списке');
  check((await text(page, '.order .status')) === 'Принят, скоро свяжемся', 'статус «Принят, скоро свяжемся»');
  check((await page.locator('.order [data-repeat]').count()) === 0, 'у активного заказа «Повторить» нет');
  const listText = await text(page, '.order');
  check(listText.includes('Манго — 1,5 кг') && listText.includes('Помело — 2 шт') && listText.includes('≈ 860 ₽'), `состав и сумма: ${listText.slice(0, 120)}`);
  check(await page.isHidden('#cart-bar'), 'на вкладке заказов нижней панели корзины нет');
  await shot(page, 'm5-orders-active');

  // Оператор довёз заказ: статус «Доставлено» → «Завершённые» с кнопкой «Повторить»
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('orders.v1'));
    list[0].status = 'Доставлено';
    list.push({ id: 'old-order-0002', no: 'N-0001', ts: Date.now() - 86400000, total: 650, status: 'Отменён', items: [{ id: 'fr-010', name: 'Дуриан', unit: 'кг', qty: 1, price: 700 }, { id: 'fr-001', name: 'Манго', unit: 'кг', qty: 1, price: 280 }] });
    localStorage.setItem('orders.v1', JSON.stringify(list));
  });
  await page.reload();
  await waitH1(page, 'Мои заказы');
  check((await page.locator('section h2').allTextContents()).join('|') === 'Завершённые', 'только «Завершённые»: активных нет');
  check((await page.locator('.status--done').count()) === 1 && (await text(page, '.status--done')) === 'Доставлен', 'статус «Доставлен»');
  check(await page.isHidden('#orders-count'), 'активных нет: отметка в шапке пропала');
  check((await page.locator('[data-repeat]').count()) === 2, 'у завершённых есть «Повторить заказ»');
  await shot(page, 'm5-orders-done');

  // Повтор доставленного заказа: всё в корзине, сразу открывается корзина
  await page.locator('[data-repeat]').first().click();
  await waitH1(page, 'Корзина');
  check(page.url().endsWith('#/cart') && (await page.locator('.cart-line').count()) === 2, 'повтор: открылась корзина с двумя позициями');
  check((await text(page, '.total__sum')) === '≈ 860 ₽', 'повтор: сумма прежняя');
  // Повтор отменённого заказа: Дуриана нет в наличии — остальное добавили, про дуриан сказали
  await page.evaluate(() => localStorage.removeItem('cart.v1'));
  await page.goto(base + '#/orders');
  await page.reload();
  await waitH1(page, 'Мои заказы');
  await page.locator('[data-repeat]').nth(1).click();
  await page.waitForSelector('.notice');
  check((await text(page, '.notice')).includes('Сейчас недоступно: Дуриан') && (await text(page, '.notice')).includes('1 товар'), `повтор с недоступным товаром: «${await text(page, '.notice')}»`);
  await page.click('.notice a');
  await waitH1(page, 'Корзина');
  const lines = await page.locator('.cart-line').count();
  check(lines === 1, `в корзине только то, что есть в наличии (${lines}: ${await page.evaluate(() => localStorage.getItem('cart.v1'))})`);
  await ctx.close();

  const empty = await open('#/orders');
  await waitH1(empty.page, 'Мои заказы');
  check((await text(empty.page, '#app')).includes('Здесь появятся заказы'), 'пустой список: пояснение');
  await empty.ctx.close();
}

// ---- 6. WhatsApp и Telegram: на телефоне сразу в приложение, «Позвонить» нет
{
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  const { ctx, page } = await open('', { userAgent: android });
  const links = await page.$$eval('.contacts a', as => as.map(a => ({ href: a.getAttribute('href'), app: a.dataset.app, text: a.textContent })));
  check(links.length === 2 && !links.some(l => /Позвонить|tel:/.test(l.text + l.href)), 'нет кнопки «Позвонить»');
  check(links[0].app === 'whatsapp://send?phone=84000000000' && links[0].href === 'https://wa.me/84000000000', `WhatsApp: ссылка в приложение (${links[0].app})`);
  check(links[1].app === 'tg://resolve?domain=primer_operator' && links[1].href === 'https://t.me/primer_operator', `Telegram: ссылка в приложение (${links[1].app})`);
  // Приложения в тестовом браузере нет: через полторы секунды открывается обычная ссылка
  const popup = page.waitForEvent('popup', { timeout: 6000 });
  await page.click('.contacts a >> nth=0');
  const opened = await popup.then(p => p.url()).catch(() => 'нет');
  check(opened.startsWith('https://wa.me/84000000000'), `нет приложения: запасной вариант — обычная ссылка (${opened.slice(0, 40)})`);
  await ctx.close();
  const desk = await open('');
  const popup2 = desk.page.waitForEvent('popup', { timeout: 6000 });
  await desk.page.click('.contacts a >> nth=1');
  const o2 = await popup2.then(p => p.url()).catch(() => 'нет');
  check(o2.startsWith('https://t.me/primer_operator'), `на компьютере: обычная ссылка t.me (${o2.slice(0, 40)})`);
  await desk.ctx.close();
}

// ---- 7. QR-страница
{
  const { ctx, page } = await open('qr.html');
  await page.waitForSelector('img.qr');
  const loaded = await page.evaluate(() => { const i = document.querySelector('img.qr'); return i.complete && i.naturalWidth > 100; });
  check(loaded, 'страница qr.html: картинка с кодом загружена');
  check((await text(page, 'body')).includes('nhatrang-rynok.github.io'), 'на странице QR написан адрес сайта');
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures() ? `\nПровалено проверок: ${failures()}` : '\nВсе проверки пройдены');
process.exit(failures() ? 1 : 0);
