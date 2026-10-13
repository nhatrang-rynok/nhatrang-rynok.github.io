// Делает QR-код со ссылкой на сайт: site/img/qr-site.svg и site/img/qr-site.png (их использует страница site/qr.html).
// Зависимость `qrcode` в репозиторий не входит. Установка и запуск (папка любая, не из репозитория):
//   mkdir /tmp/qrgen && cd /tmp/qrgen && npm init -y && npm install qrcode
//   QR_MODULES=/tmp/qrgen/node_modules node tools/make-qr.mjs [адрес]
// Адрес по умолчанию — главная страница с меткой ?src=qr: в «Журнале» видно, сколько гостей пришло по QR.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const URL_DEFAULT = 'https://nhatrang-rynok.github.io/?src=qr';
const url = process.argv[2] || URL_DEFAULT;
const modules = process.env.QR_MODULES;
if (!modules) {
  console.error('Укажите папку с установленным qrcode: QR_MODULES=/путь/node_modules node tools/make-qr.mjs');
  process.exit(1);
}
const QRCode = createRequire(`${modules}/`)('qrcode');
const out = new globalThis.URL('../site/img/', import.meta.url);
mkdirSync(out, { recursive: true });
// Чёрный на белом и запас по краям: так код читается любой камерой, в том числе с распечатки
const options = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#FFFFFF' } };
await QRCode.toFile(new globalThis.URL('qr-site.svg', out).pathname, url, { ...options, type: 'svg' });
await QRCode.toFile(new globalThis.URL('qr-site.png', out).pathname, url, { ...options, type: 'png', width: 1024 });
console.log(`готово: site/img/qr-site.svg и qr-site.png → ${url}`);
