// Рисует иконки и картинку для превью ссылки (Open Graph) в site/img/.
// Запуск: node tools/gen-images.mjs  (нужен Playwright и Chromium, как для tests/e2e)
// Нужно перезапускать, если меняется название сайта или адрес превью, и класть результат в репозиторий.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

let playwright;
try { playwright = await import('playwright'); } catch { playwright = createRequire('/opt/node-tools/node_modules/')('playwright'); }
const { chromium } = playwright.chromium ? playwright : playwright.default;
const OUT = fileURLToPath(new URL('../site/img/', import.meta.url));

const font = "-apple-system, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const icon = size => `<body style="margin:0"><div style="width:${size}px;height:${size}px;background:#1E7A46;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.62)}px;line-height:1">🥭</div></body>`;
const og = `<body style="margin:0"><div style="width:1200px;height:630px;box-sizing:border-box;padding:70px 80px;background:#FFFDF8;font-family:${font};display:flex;align-items:center;gap:60px">
  <div style="width:300px;height:300px;flex:none;border-radius:60px;background:#1E7A46;display:flex;align-items:center;justify-content:center;font-size:190px;line-height:1">🥭</div>
  <div>
    <div style="font-size:84px;font-weight:800;color:#1F1F1F;line-height:1.05">Рынок у отеля</div>
    <div style="margin-top:28px;font-size:40px;line-height:1.3;color:#595959">Фрукты, ром, сладости и другие товары с рынка. Привезём в отель.</div>
    <div style="margin-top:36px;display:inline-block;padding:14px 32px;border-radius:16px;background:#1E7A46;color:#fff;font-size:36px;font-weight:700">Выберите и оставьте телефон</div>
  </div></div></body>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
async function render(html, width, height, file) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  await page.screenshot({ path: OUT + file, clip: { x: 0, y: 0, width, height } });
  await page.close();
  console.log('готово:', file);
}
await render(icon(192), 192, 192, 'icon-192.png');
await render(icon(512), 512, 512, 'icon-512.png');
await render(icon(180), 180, 180, 'apple-touch-icon.png');
await render(og, 1200, 630, 'og.png');
await browser.close();
