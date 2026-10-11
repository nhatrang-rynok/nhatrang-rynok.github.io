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

export function telUrl(phone) {
  return `tel:${String(phone).replace(/[^\d+]/g, '')}`;
}
