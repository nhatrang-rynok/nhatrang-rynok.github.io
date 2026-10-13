// T1.3: каталог, карточки, степпер, нижняя панель, кэш, безопасный вывод.
import { startServer, launch, check, failures } from './helpers.mjs';
import { readFileSync } from 'node:fs';

const SHOTS = process.argv[2];
const sample = JSON.parse(readFileSync(new URL('../../site/data/catalog.sample.json', import.meta.url), 'utf8'));
const { server, base } = await startServer();
const browser = await launch();
const NB = / /g;
const text = async (page, sel) => ((await page.textContent(sel)) || '').replace(NB, ' ').trim();
const shot = (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const waitH1 = (page, t) => page.waitForFunction(x => [...document.querySelectorAll('h1')].some(h => h.textContent.includes(x)), t);
const route = (page, patch) => page.route('**/data/catalog.sample.json', r => {
  const data = structuredClone(sample);
  patch(data);
  r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
});

async function newPage(width = 390, height = 844, patch) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  if (patch) await route(page, patch);
  return { ctx, page, problems };
}

for (const width of [390, 360]) {
  const { ctx, page, problems } = await newPage(width, width === 390 ? 844 : 740);
  const tag = `[${width}]`;
  const overflow = async name => {
    const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(o <= 0, `${tag} ${name}: нет горизонтальной прокрутки страницы (${o}px)`);
  };

  // --- Главная
  await page.goto(base);
  await page.waitForSelector('.tile');
  check((await page.locator('.tile').count()) === 2, `${tag} главная: две плитки категорий`);
  check((await page.locator('.strip .card').count()) === sample.popular.length, `${tag} главная: «Самое популярное» (${sample.popular.length} карточек)`);
  check(await page.isHidden('#cart-bar'), `${tag} пустая корзина: нижней панели нет`);
  check(await page.isHidden('#cart-count'), `${tag} пустая корзина: счётчика в шапке нет`);
  const links = await page.$$eval('.contacts a', as => as.map(a => a.getAttribute('href')));
  check(links.includes('https://wa.me/84000000000') && links.includes('https://t.me/primer_operator') && !links.some(l => l.startsWith('tel:')) && links.length === 2, `${tag} главная: кнопки связи WhatsApp и Telegram, без «Позвонить»`);
  await overflow('главная');
  if (width === 390) await shot(page, 't13-01-home');

  // --- Категория
  await page.click('.tile[href="#/c/fruits"]');
  await waitH1(page, 'Фрукты');
  const cards = page.locator('.list .card');
  check((await cards.count()) === 11, `${tag} категория «Фрукты»: 11 карточек`);
  const firstTitles = await page.$$eval('.list .card__title', ts => ts.slice(0, 3).map(t => t.textContent));
  check(firstTitles.join('|') === 'Манго|Драконий фрукт (питайя)|Маракуйя', `${tag} порядок по «Порядок»: ${firstTitles.join(', ')}`);
  const durian = cards.filter({ has: page.locator('.card__link:text-is("Дуриан")') });
  check((await durian.locator('.qty__add').count()) === 0 && (await text(page, '.card--out .qty__out')) === 'Сезон закончился', `${tag} дуриан: «Сезон закончился», кнопки нет`);
  check((await cards.filter({ has: page.locator('.card__link:text-is("Рамбутан")') }).locator('.badge-info').count()) === 1, `${tag} рамбутан: отметка «Под заказ»`);
  await overflow('категория');
  if (width === 390) await shot(page, 't13-02-category');

  // --- Степпер и нижняя панель
  const mango = cards.filter({ has: page.locator('.card__link:text-is("Манго")') });
  await mango.locator('.qty__add').click();
  check((await text(page, '.card:has(.card__link:text-is("Манго")) .qty__value')) === '1 кг', `${tag} «В корзину» → степпер «1 кг»`);
  check((await text(page, '#cart-bar-link')) === 'Корзина · 1 товар · ≈ 280 ₽ →', `${tag} панель: «${await text(page, '#cart-bar-link')}»`);
  check((await page.evaluate(() => document.activeElement.dataset.role)) === 'plus', `${tag} фокус перешёл на «+»`);
  await mango.locator('[data-role="plus"]').click();
  check((await text(page, '.card:has(.card__link:text-is("Манго")) .qty__value')) === '1,5 кг', `${tag} «+» → «1,5 кг» (шаг 0,5)`);
  check((await text(page, '#cart-bar-link')) === 'Корзина · 1 товар · ≈ 420 ₽ →', `${tag} панель: ≈ 420 ₽`);
  await cards.filter({ has: page.locator('.card__link:text-is("Помело")') }).locator('.qty__add').click();
  check((await text(page, '#cart-bar-link')) === 'Корзина · 2 товара · ≈ 640 ₽ →', `${tag} панель: 2 товара ≈ 640 ₽`);
  check((await text(page, '#cart-count')) === '2', `${tag} счётчик в шапке: 2`);
  const bar = await page.locator('#cart-bar-link').boundingBox();
  const mainPad = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('app')).paddingBottom));
  check(bar.height >= 48 && mainPad >= 80, `${tag} панель ≥ 48px, под ней есть запас прокрутки (${Math.round(mainPad)}px)`);
  await overflow('категория с панелью');
  if (width === 390) await shot(page, 't13-03-category-cart');

  // --- Товар
  await mango.locator('.card__link').click();
  await waitH1(page, 'Манго');
  check((await text(page, '#modal-body .product__price')) === '≈ 280 ₽ / кг', `${tag} товар: цена за кг`);
  check((await text(page, '#modal-body .qty__value')) === '1,5 кг', `${tag} товар: степпер показывает то, что в корзине`);
  check((await page.locator('#modal-body .notice').count()) === 1 && (await text(page, '#modal-body .notice')).includes('перекрёстная реакция'), `${tag} товар: предупреждение`);
  check((await text(page, '#modal-body')).includes('Где куплено: Рынок (пример)'), `${tag} товар: «Где куплено»`);
  const related = await page.$$eval('#modal-body .strip .card__title', ts => ts.map(t => t.textContent));
  check(related[0] === 'Драконий фрукт (питайя)' && related[1] === 'Помело', `${tag} «Вам может понравиться»: ${related.slice(0, 3).join(', ')}`);
  await page.locator('.product__buy [data-role="plus"]').click();
  check((await text(page, '.product__buy .qty__value')) === '2 кг', `${tag} товар: «+» → «2 кг»`);
  check((await text(page, '#cart-bar-link')) === 'Корзина · 2 товара · ≈ 780 ₽ →', `${tag} панель на товаре: ≈ 780 ₽`);
  await overflow('товар');
  if (width === 390) { await shot(page, 't13-04-product'); await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await shot(page, 't13-05-product-bottom'); await page.evaluate(() => window.scrollTo(0, 0)); }

  // --- Назад и сохранение корзины
  await page.click('#modal-close');
  await page.waitForSelector('#modal', { state: 'hidden' });
  check(page.url().endsWith('#/c/fruits'), `${tag} крестик закрыл карточку: адрес вернулся к категории`);
  check((await text(page, '.card:has(.card__link:text-is("Манго")) .qty__value')) === '2 кг', `${tag} возврат: в списке «2 кг»`);
  await page.reload();
  await page.waitForSelector('.card');
  check((await text(page, '#cart-bar-link')) === 'Корзина · 2 товара · ≈ 780 ₽ →', `${tag} корзина пережила перезагрузку`);

  // --- Уменьшение до нуля
  const mango2 = page.locator('.card').filter({ has: page.locator('.card__link:text-is("Манго")') });
  for (let i = 0; i < 3; i++) await mango2.locator('[data-role="minus"]').click();
  check((await mango2.locator('.qty__add').count()) === 1, `${tag} «−» до минимума убирает товар`);
  check((await page.evaluate(() => document.activeElement.dataset.role)) === 'add', `${tag} фокус вернулся на «В корзину»`);
  check((await text(page, '#cart-bar-link')) === 'Корзина · 1 товар · ≈ 220 ₽ →', `${tag} панель после удаления`);

  // --- Алкоголь
  await page.goto(base + '#/c/alcohol');
  await waitH1(page, 'Ром');
  check((await page.locator('.card .badge-adult').count()) === 3, `${tag} алкоголь: у всех трёх отметка 18+`);
  // Длинная единица («бут. 0,7 л») не должна ломать компактную карточку
  await page.goto(base);
  await page.waitForSelector('.strip .card');
  const rum = page.locator('.strip .card').filter({ has: page.locator('.card__link:text-is("Ром кокосовый, 0,7 л")') });
  await rum.locator('.qty__add').click();
  check((await text(page, '.strip .card:has(.card__link:text-is("Ром кокосовый, 0,7 л")) .qty__value')) === '1 бут.', `${tag} степпер бутылки: «1 бут.»`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.card--strip')].filter(c => c.scrollWidth > c.clientWidth + 1).length);
  check(clipped === 0, `${tag} ничего не вылезает из карточек ленты`);
  await rum.locator('[data-role="minus"]').click();
  await page.goto(base + '#/c/alcohol');
  await waitH1(page, 'Ром');
  if (width === 390) await shot(page, 't13-06-alcohol');

  // --- Несуществующее
  await page.goto(base + '#/p/zz-999');
  await waitH1(page, 'Товар не найден');
  check(true, `${tag} несуществующий товар`);
  await page.goto(base + '#/c/nope');
  await waitH1(page, 'Категория не найдена');
  check(true, `${tag} несуществующая категория`);

  // --- Размеры зон нажатия
  await page.goto(base + '#/c/fruits');
  await page.waitForSelector('.card');
  await page.locator('.card').first().locator('.qty__add').click();
  const small = await page.$$eval('.qty__add, .qty__btn, .tile, .contacts a, .icon-btn', els => els.filter(e => e.offsetParent && (e.getBoundingClientRect().height < 47.5 || e.getBoundingClientRect().width < 47.5)).map(e => `${e.className}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
  check(small.length === 0, `${tag} все кнопки ≥ 48px${small.length ? ': ' + small.join(', ') : ''}`);
  // Вся карточка — одна ссылка (растянутая ::after): нажатие на фото попадает в ссылку названия
  const hit = await page.evaluate(() => {
    const photo = document.querySelector('.list .card .photo').getBoundingClientRect();
    return document.elementFromPoint(photo.left + photo.width / 2, photo.top + photo.height / 2)?.closest('.card__link')?.getAttribute('href');
  });
  check(hit === '#/p/fr-001', `${tag} нажатие на фото карточки открывает товар (${hit})`);
  check(problems.length === 0, `${tag} консоль без ошибок${problems.length ? ': ' + problems.join(' | ') : ''}`);
  await ctx.close();
}

// --- Кэш: после первого визита каталог доступен без сети
{
  const { ctx, page } = await newPage();
  await page.goto(base);
  await page.waitForSelector('.tile');
  await page.route('**/data/catalog.sample.json', r => r.abort());
  await page.reload();
  await page.waitForSelector('.tile');
  check((await page.locator('.tile').count()) === 2, 'кэш: без сети каталог показывается из localStorage');
  await ctx.close();
}

// --- Нет сети и нет кэша: экран ошибки, затем «Повторить»
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.route('**/data/catalog.sample.json', r => r.abort());
  await page.goto(base);
  await waitH1(page, 'Не удалось загрузить каталог');
  check((await page.locator('.contacts a').count()) === 2, 'ошибка загрузки: есть кнопки связи с запасными контактами');
  await shot(page, 't13-07-error');
  await page.unroute('**/data/catalog.sample.json');
  await page.click('text=Повторить');
  await page.waitForSelector('.tile');
  check(true, 'ошибка загрузки: «Повторить» загружает каталог');
  await ctx.close();
}

// --- Безопасный вывод: HTML из таблицы не исполняется
{
  const evil = '<img src=x onerror="window.__xss=1"><b>жирный</b>';
  const { ctx, page } = await newPage(390, 844, d => {
    d.products[0].name = evil;
    d.products[0].short = evil;
    d.products[0].desc = evil;
    d.products[0].warn = evil;
    d.products[0].src = evil;
    d.products[0].img = 'https://invalid.invalid/x.jpg';
    d.settings.announcement = evil;
    d.categories[0].name = evil;
  });
  await page.route('https://invalid.invalid/**', r => r.abort());
  await page.goto(base + '#/c/fruits');
  await page.waitForSelector('.card');
  await page.goto(base + '#/p/fr-001');
  await page.waitForSelector('.product__price');
  await page.goto(base);
  await page.waitForSelector('.tile');
  const injected = await page.evaluate(() => ({ xss: window.__xss, imgs: document.querySelectorAll('img[src="x"]').length, bold: document.querySelectorAll('#app b').length }));
  check(!injected.xss && injected.imgs === 0 && injected.bold === 0, 'безопасность: <img onerror> и <b> из таблицы не исполняются');
  check((await text(page, '.notice')).includes('<img src=x'), 'безопасность: разметка показана как обычный текст');
  await page.goto(base + '#/p/fr-001');
  await page.waitForSelector('.product__price');
  await page.waitForFunction(() => document.querySelector('.photo img')?.getAttribute('src') === 'img/placeholder.svg');
  check(true, 'битое фото заменяется заглушкой');
  await ctx.close();
}

// --- Заказы на паузе, объявление, условия
{
  const { ctx, page } = await newPage(390, 844, d => {
    d.settings.orders_enabled = false;
    d.settings.announcement = 'Завтра выходной, привезу в четверг.';
    d.settings.terms = 'Оплата при получении.\nДоставка в отель.';
  });
  await page.goto(base);
  await page.waitForSelector('.tile');
  check((await text(page, '.notice--danger')).includes('Сейчас заказы не принимаются'), 'заказы на паузе: плашка на главной');
  check((await page.locator('.notice').first().textContent()).includes('Завтра выходной'), 'объявление над каталогом');
  check((await text(page, '#app')).includes('Оплата при получении.'), 'условия показаны');
  await shot(page, 't13-08-paused');
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures() ? `\nПровалено проверок: ${failures()}` : '\nВсе проверки пройдены');
process.exit(failures() ? 1 : 0);
