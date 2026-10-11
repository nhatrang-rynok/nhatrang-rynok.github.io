// Логика заказа без обращения к DOM и сети: телефон, проверка формы, состав корзины, тексты.
import { formatPrice, formatQty } from './format.js';

export const LIMITS = { name: 50, room: 10, comment: 500 };
export const MESSENGERS = ['whatsapp', 'telegram', 'call'];

const NBSP_RE = / /g;

// «8 (999) 000-00-00» → «+79990000000»; «+84 90 000 00 00» → «+84900000000»
export function normalizePhone(raw) {
  const text = String(raw ?? '').trim();
  const hasPlus = text.startsWith('+');
  let digits = text.replace(/\D/g, '');
  if (!hasPlus && digits.startsWith('00')) {
    digits = digits.slice(2); // международный префикс «00», дальше код страны
  } else if (!hasPlus && digits.length === 11 && digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`; // российское «8 999 …»
  }
  return digits ? `+${digits}` : '';
}

// Телефон гостя. Правила сервера (docs/05-api.md) плюс подсказка про код страны: 10 цифр, начиная с 9, — это российский номер без +7.
export function checkPhone(raw) {
  const phone = normalizePhone(raw);
  if (!phone) return { ok: false, phone, error: 'Введите номер телефона' };
  const digits = phone.slice(1);
  if (!String(raw).trim().startsWith('+') && digits.length === 10 && digits.startsWith('9')) {
    return { ok: false, phone, error: 'Добавьте код страны, например +7' };
  }
  if (!/^\+\d{9,15}$/.test(phone)) {
    return { ok: false, phone, error: 'Проверьте номер: с кодом страны, например +7 999 000-00-00' };
  }
  return { ok: true, phone, error: '' };
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, max);
const cleanMultiline = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]+/g, ' ').trim().slice(0, max);

// Проверка формы. needAdult — в корзине есть товар 18+.
export function validateOrderForm(fields, { needAdult = false } = {}) {
  const errors = {};
  const phone = checkPhone(fields.phone);
  if (!phone.ok) errors.phone = phone.error;
  const messenger = MESSENGERS.includes(fields.messenger) ? fields.messenger : 'whatsapp';
  if (needAdult && !fields.adultConfirmed) errors.adult = 'Подтвердите, что вам есть 18 лет';
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    values: {
      phone: phone.phone,
      messenger,
      name: clean(fields.name, LIMITS.name),
      room: clean(fields.room, LIMITS.room),
      comment: cleanMultiline(fields.comment, LIMITS.comment),
      adultConfirmed: Boolean(fields.adultConfirmed),
    },
  };
}

// Разбор корзины по каталогу. Недоступные: нет в каталоге или «сезон закончился».
export function splitCart(cart, products) {
  const available = [];
  const unavailable = [];
  let total = 0;
  for (const [id, qty] of Object.entries(cart)) {
    const product = products?.get(id) ?? null;
    if (!product || product.stock === 'out') {
      unavailable.push({ id, product });
      continue;
    }
    const sum = Math.round(product.price * qty);
    total += product.price * qty;
    available.push({ product, qty, sum });
  }
  return { available, unavailable, total: Math.round(total), hasAdult: available.some(l => l.product.adult) };
}

// Тело POST-запроса (docs/05-api.md)
export function buildOrderPayload({ values, lines, total, clientOrderId, catalogVersion, website = '' }) {
  return {
    action: 'order',
    clientOrderId,
    phone: values.phone,
    messenger: values.messenger,
    name: values.name,
    room: values.room,
    comment: values.comment,
    adultConfirmed: values.adultConfirmed,
    items: lines.map(l => ({ id: l.product.id, qty: l.qty })),
    clientTotal: total,
    catalogVersion: catalogVersion || '',
    website,
  };
}

// Текст заказа для отправки в WhatsApp, если сайт не смог отправить его сам
export function buildOrderText({ lines, total, values }) {
  const rows = ['Здравствуйте! Хочу заказать:'];
  for (const l of lines) rows.push(`• ${l.product.name} — ${formatQty(l.qty, l.product.unit)}`);
  rows.push(`Итого ${formatPrice(total)}`);
  if (values.name) rows.push(`Имя: ${values.name}`);
  rows.push(`Телефон: ${values.phone}`);
  if (values.room) rows.push(`Комната: ${values.room}`);
  if (values.comment) rows.push(`Комментарий: ${values.comment}`);
  return rows.join('\n').replace(NBSP_RE, ' ');
}
