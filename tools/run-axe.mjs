// axe-core (WCAG 2.x A/AA и рекомендации) по всем экранам с заполненной корзиной на 360 и 430 px.
// Зависимости как у run-lighthouse.mjs. Запуск:  LH_DIR=/tmp/lh node tools/run-axe.mjs
import { join } from 'node:path';
import { startServer, launch } from '../tests/e2e/helpers.mjs';

const dir = process.env.LH_DIR || process.cwd();
const { server, base } = await startServer();
const browser = await launch();
let total = 0;
for (const width of [360, 430]) {
  const page = await (await browser.newContext({ viewport: { width, height: 800 }, locale: 'ru-RU' })).newPage();
  await page.goto(base);
  await page.waitForSelector('.tile');
  await page.evaluate(() => localStorage.setItem('cart.v1', JSON.stringify({ 'fr-001': 1.5, 'al-001': 1, 'fr-010': 1 })));
  for (const [name, hash] of [['home', '#/'], ['category', '#/c/alcohol'], ['product', '#/p/fr-001'], ['cart', '#/cart'], ['checkout', '#/checkout'], ['done', '#/done/N-0042']]) {
    await page.goto(base + hash);
    await page.reload();
    await page.waitForSelector('h1');
    if (name === 'checkout') await page.click('button[type="submit"]'); // показать ошибки полей
    await page.addScriptTag({ path: join(dir, 'node_modules/axe-core/axe.min.js') });
    const r = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }));
    total += r.violations.length;
    console.log(`[${width}] ${name}: нарушений ${r.violations.length}`);
    for (const v of r.violations) console.log(`   - ${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
  }
}
await browser.close();
server.close();
console.log(total ? `\nВсего нарушений: ${total}` : '\nНарушений нет');
process.exit(total ? 1 : 0);
