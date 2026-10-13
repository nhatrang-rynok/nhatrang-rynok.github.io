// Форматирование цен, количеств и ссылок. Чистые функции, без обращения к DOM.

const NBSP = ' ';

function groupThousands(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

// 830 → «≈ 830 ₽», 2450 → «≈ 2 450 ₽» (пробелы неразрывные)
export function formatPrice(rub) {
  return `≈${NBSP}${groupThousands(rub)}${NBSP}₽`;
}

// «≈ 290 ₽ / кг». Сумма с «₽» не разрывается, остальное может переноситься по пробелам.
export function formatUnitPrice(rub, unit) {
  return `${formatPrice(rub)} / ${unit}`;
}

// Единица для степпера без объёма: «бут. 0,7 л» → «бут.», «упак. 500 г» → «упак.», «кг» → «кг»
export function shortUnit(unit) {
  const words = unit.trim().split(/\s+/);
  const end = words.findIndex(w => /\d/.test(w));
  return (end > 0 ? words.slice(0, end) : words).join(' ');
}

// 1.5, 'кг' → «1,5 кг»; 1, 'бут. 0,7 л' → «1 бут.»
export function formatQty(qty, unit) {
  const text = String(Math.round(qty * 1000) / 1000).replace('.', ',');
  return `${text}${NBSP}${shortUnit(unit)}`;
}

// plural(2, ['товар', 'товара', 'товаров']) → «товара»
export function plural(n, forms) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function formatItemsCount(n) {
  return `${n}${NBSP}${plural(n, ['товар', 'товара', 'товаров'])}`;
}

// Адрес картинки с нужной шириной. Пустой img — заглушка. Для Google Диска добавляем размер.
export function imageSrc(img, width) {
  if (!img) return 'img/placeholder.svg';
  if (img.startsWith('https://lh3.googleusercontent.com/d/') && !img.includes('=')) return `${img}=w${width}`;
  return img;
}

// Ссылки для связи. Номер и ник чистим, чтобы в адрес не попало лишнего.
export function whatsappUrl(whatsapp, text) {
  const digits = String(whatsapp).replace(/\D/g, '');
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function telegramUrl(nick) {
  return `https://t.me/${String(nick).replace(/[^A-Za-z0-9_]/g, '')}`;
}

// Прямые ссылки на приложения: на телефоне открывают WhatsApp и Telegram сразу, без страницы-посредника в браузере
// (обычные wa.me и t.me сначала грузят страницу, предлагают скачать приложение и только потом открывают его).
export function whatsappAppUrl(whatsapp, text) {
  const digits = String(whatsapp).replace(/\D/g, '');
  return `whatsapp://send?phone=${digits}${text ? `&text=${encodeURIComponent(text)}` : ''}`;
}

export function telegramAppUrl(nick) {
  return `tg://resolve?domain=${String(nick).replace(/[^A-Za-z0-9_]/g, '')}`;
}

// Донги: 300000 → «300.000 ₫» (точка между тысячами, как принято во Вьетнаме)
export function formatVnd(vnd) {
  return `${String(Math.round(vnd)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${NBSP}₫`;
}

// Доллары: 3.36 → «$3,36», 12 → «$12», 125.4 → «$125»
export function formatUsd(usd) {
  const n = Number(usd);
  const text = n < 10 ? n.toFixed(2).replace('.', ',') : String(Math.round(n));
  return `$${text}`;
}

// Вес в граммах: 200 → «200 г», 1200 → «1,2 кг»
export function formatWeight(grams) {
  if (grams >= 1000) return `${String(Math.round(grams / 100) / 10).replace('.', ',')}${NBSP}кг`;
  return `${Math.round(grams)}${NBSP}г`;
}

// «1 шт. = 200 г = 16.800 ₫» — сколько весит и стоит одна штука. Пусто, если в таблице нет «Вес 1 шт., г»
// или товар продаётся не на вес и не поштучно.
export function pieceLine(product) {
  const grams = Number(product.pw) || 0;
  const vnd = Number(product.vnd) || 0;
  if (grams <= 0 || vnd <= 0) return '';
  const unit = String(product.unit).trim().toLowerCase();
  let pieceVnd = 0;
  if (unit === 'кг') pieceVnd = Math.round((vnd * grams) / 1000 / 100) * 100;
  else if (unit === 'шт' || unit === 'шт.') pieceVnd = vnd;
  if (pieceVnd <= 0) return '';
  return `1${NBSP}шт. = ${formatWeight(grams)} = ${formatVnd(pieceVnd)}`;
}

// Цены в долларах и донгах для карточки товара: «$3,36 · 84.000 ₫ / кг»
export function formatAltPrices(product) {
  const parts = [];
  if (Number(product.usd) > 0) parts.push(formatUsd(product.usd));
  if (Number(product.vnd) > 0) parts.push(formatVnd(product.vnd));
  return parts.length ? `${parts.join(' · ')} / ${product.unit}` : '';
}
