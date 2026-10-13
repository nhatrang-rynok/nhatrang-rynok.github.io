// T1.5: все экраны на 360, 390 и 430 px: переполнение, обрезанный текст, размеры кнопок,
// подписи для скринридера, заголовки, мелкий шрифт. Дополнительно — «тяжёлые» данные (длинные названия, большие суммы).
import { startServer, launch, check, failures } from './helpers.mjs';
import { readFileSync } from 'node:fs';

const SHOTS = process.argv[2];
const sample = JSON.parse(readFileSync(new URL('../../site/data/catalog.sample.json', import.meta.url), 'utf8'));
const browser = await launch();

// «Тяжёлый» каталог: длинные названия, огромные суммы, длинные тексты, длинное название сайта
function stress(d) {
  d.settings.site_title = 'Рынок у отеля «Солнечный берег»';
  d.settings.announcement = 'Внимание! ' + 'Очень длинное объявление про выходные и доставку. '.repeat(3);
  Object.assign(d.products[0], {
    name: 'Манго желтое сладкое сезонное отборное крупное экстра класса',
    short: 'Очень длинное описание в одну строку, которое должно перенестись',
    price: 123456, unit: 'упак. 500 г', step: 0.5, min: 1,
    warn: 'Очень длинное предупреждение. '.repeat(10),
  });
  Object.assign(d.products[1], { name: 'Суперлонгнеразрывноеназваниебезпробеловвообще-совсем-никак', price: 99999 });
}

const { server: srvA, base: baseA } = await startServer();
const { server: srvB, base: baseB } = await startServer({
  files: { 'data/catalog.sample.json': (() => { const d = structuredClone(sample); stress(d); return JSON.stringify(d); })() },
});

const CART = { 'fr-001': 100, 'fr-002': 1.5, 'al-001': 2, 'fr-010': 1, 'zz-999': 1 };
const SCREENS = [
  ['home', '#/'], ['cat-fruits', '#/c/fruits'], ['cat-alcohol', '#/c/alcohol'], ['product-warn', '#/p/fr-001'],
  ['product-adult', '#/p/al-001'], ['cart', '#/cart'], ['checkout', '#/checkout'], ['done', '#/done/N-0042'], ['orders', '#/orders'],
];

async function audit(page, tag) {
  const result = await page.evaluate(() => {
    const out = { brokenWords: [], overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, clipped: [], small: [], noName: [], noAlt: [], fonts: [], h1: [...document.querySelectorAll('h1')].filter(h => !h.closest('[inert]')).length, skipped: [] };
    const visible = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.right > 0 && r.left < innerWidth; };
    const label = e => (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest('label');
    const nameOf = e => (e.getAttribute('aria-label') || e.textContent || '').trim() || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent.trim()) || e.getAttribute('title') || '';
    const desc = e => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''}${e.id ? '#' + e.id : ''} «${(e.textContent || '').trim().slice(0, 25)}»`;

    for (const e of document.querySelectorAll('body *')) {
      if (!visible(e)) continue;
      const cs = getComputedStyle(e);
      if (['hidden', 'clip'].includes(cs.overflowX) && e.scrollWidth > e.clientWidth + 1 && !e.closest('.photo') && !e.closest('.hp') && !e.closest('.visually-hidden') && !e.matches('.visually-hidden')) out.clipped.push(desc(e));
      if (['hidden', 'clip'].includes(cs.overflowY) && e.scrollHeight > e.clientHeight + 1 && cs.display !== 'inline' && !e.closest('.photo') && !e.closest('.hp') && !e.closest('.visually-hidden') && !e.matches('.visually-hidden')) out.clipped.push(`${desc(e)} (по высоте)`);
    }
    for (const e of document.querySelectorAll('a[href], button, summary, input:not([type="hidden"]), textarea, select')) {
      if (!visible(e) && !(e.type === 'radio')) continue;
      if (e.closest('.hp') || e.matches('.card__link, .skip-link')) continue;
      const target = (e.type === 'radio' || e.type === 'checkbox') ? label(e) : e;
      if (!target) { out.noName.push(`${desc(e)} без подписи`); continue; }
      const r = target.getBoundingClientRect();
      if (r.height < 47.5 || r.width < 47.5) out.small.push(`${desc(target)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (!nameOf(e)) out.noName.push(desc(e));
    }
    for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) out.noAlt.push(img.src);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const e = n.parentElement;
      if (!visible(e) || e.closest('.hp, noscript, .visually-hidden')) continue;
      const size = parseFloat(getComputedStyle(e).fontSize);
      if (size < 16) out.fonts.push(`${desc(e)} ${size}px`);
    }
    // Слово не должно разрываться посреди (обычные данные): однословный текст не может занимать две строки
    if (!document.title.includes('Солнечный') && !document.getElementById('header-title').textContent.includes('Солнечный')) {
      const w2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w2.nextNode(); n; n = w2.nextNode()) {
        const t = n.textContent.trim();
        const e = n.parentElement;
        if (t.length < 4 || /\s/.test(t) || !visible(e) || e.closest('.hp, .visually-hidden')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const lines = new Set([...range.getClientRects()].map(r => Math.round(r.top)));
        if (lines.size > 1) out.brokenWords.push(`«${t}»`);
      }
    }
    let prev = 0;
    for (const h of document.querySelectorAll('h1, h2, h3, h4')) {
      const lvl = Number(h.tagName[1]);
      if (prev && lvl > prev + 1) out.skipped.push(`${h.tagName}:${h.textContent.trim().slice(0, 20)} после h${prev}`);
      prev = lvl;
    }
    return out;
  });
  check(result.overflow <= 0, `${tag}: нет горизонтальной прокрутки (${result.overflow}px)`);
  check(result.clipped.length === 0, `${tag}: нет обрезанного текста${result.clipped.length ? ' → ' + result.clipped.join('; ') : ''}`);
  check(result.small.length === 0, `${tag}: зоны нажатия ≥ 48px${result.small.length ? ' → ' + result.small.join('; ') : ''}`);
  check(result.noName.length === 0, `${tag}: у кнопок и полей есть подписи${result.noName.length ? ' → ' + result.noName.join('; ') : ''}`);
  check(result.brokenWords.length === 0, `${tag}: слова не разорваны${result.brokenWords.length ? ' → ' + result.brokenWords.join('; ') : ''}`);
  check(result.noAlt.length === 0, `${tag}: у картинок есть alt`);
  check(result.fonts.length === 0, `${tag}: шрифт ≥ 16px${result.fonts.length ? ' → ' + result.fonts.slice(0, 4).join('; ') : ''}`);
  check(result.h1 === 1, `${tag}: один заголовок h1 (${result.h1})`);
  check(result.skipped.length === 0, `${tag}: уровни заголовков без пропусков${result.skipped.length ? ' → ' + result.skipped.join('; ') : ''}`);
}

for (const [label, root] of [['обычные данные', baseA], ['тяжёлые данные', baseB]]) {
  for (const width of [360, 390, 430]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, locale: 'ru-RU' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('pageerror', e => problems.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
    await page.goto(root);
    await page.waitForSelector('.tile');
    await page.evaluate(c => { localStorage.setItem('cart.v1', JSON.stringify(c)); localStorage.setItem('profile.v1', JSON.stringify({ phone: '+84 000 000 000', messenger: 'call', name: 'Ольга', room: '512' })); }, CART);
    await page.reload();
    await page.waitForSelector('.tile');
    for (const [name, hash] of SCREENS) {
      await page.goto(root + hash);
      await page.reload();
      await page.waitForSelector('h1');
      await page.waitForTimeout(150);
      await audit(page, `[${label}, ${width}] ${name}`);
      if (SHOTS && (label === 'обычные данные' || name === 'cat-fruits')) {
        await page.screenshot({ path: `${SHOTS}/t15-${label === 'обычные данные' ? 'n' : 's'}-${width}-${name}.png`, fullPage: true });
      }
    }
    check(problems.length === 0, `[${label}, ${width}] консоль без ошибок${problems.length ? ': ' + problems.join(' | ') : ''}`);
    await ctx.close();
  }
}

await browser.close();
srvA.close();
srvB.close();
console.log(failures() ? `\nПровалено проверок: ${failures()}` : '\nВсе проверки пройдены');
process.exit(failures() ? 1 : 0);
