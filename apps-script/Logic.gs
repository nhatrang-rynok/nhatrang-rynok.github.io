/**
 * Logic.gs — чистая логика без обращения к сервисам Google (SpreadsheetApp, CacheService и т. д.).
 * Благодаря этому её можно проверять тестами на Node (tests/logic.test.js).
 *
 * Все .gs файлы проекта делят одну глобальную область видимости: имена здесь не должны
 * повторяться в других файлах. Имена с «_» на конце не видны в списке запуска и в меню.
 */

// ===== Схема таблицы (docs/04-google-sheet.md) =====

const SHEET_NAMES_ = {
  products: 'Товары',
  categories: 'Категории',
  settings: 'Настройки',
  orders: 'Заказы',
  orderItems: 'Позиции заказов',
  errors: 'Ошибки',
};

// Заголовки колонок. Сервер ищет колонки по тексту заголовка, а не по номеру,
// поэтому колонки можно переставлять и добавлять свои, но нельзя переименовывать эти.
const HEADERS_ = {
  products: ['ID', 'Показывать', 'Категория', 'Название', 'Коротко', 'Описание', 'Цена ₫', 'Цена ₽', 'Единица', 'Шаг', 'Минимум', 'Фото', 'Предупреждения', 'Где куплено', '18+', 'Хит', 'Похожие', 'Наличие', 'Порядок', 'Обновлено'],
  categories: ['ID', 'Показывать', 'Название', 'Иконка', 'Подпись', 'Порядок'],
  settings: ['Ключ', 'Значение', 'Публично', 'Пояснение'],
  orders: ['Номер', 'Создан', 'Статус', 'Телефон', 'Связь', 'Имя', 'Комната', 'Комментарий', 'Состав', 'Сумма ₽', '18+ подтверждено', 'Уведомление', 'ID клиента', 'Заметки'],
  orderItems: ['Номер заказа', 'Создан', 'ID товара', 'Название', 'Кол-во', 'Цена ₽', 'Сумма ₽', 'Отменён'],
  errors: ['Когда', 'Где', 'Что'],
};

const ORDER_STATUSES_ = ['Новый', 'Связались', 'Закуплено', 'Доставлено', 'Отменён'];
const STOCK_LABELS_ = ['В наличии', 'Под заказ', 'Сезон закончился'];
const MESSENGER_LABELS_ = { whatsapp: 'WhatsApp', telegram: 'Telegram', call: 'Звонок' };

// Настройки, которые уходят на сайт. Остальные (курс, округление и т. д.) остаются на сервере.
const PUBLIC_SETTING_KEYS_ = ['site_title', 'phone', 'whatsapp', 'telegram', 'orders_enabled', 'announcement', 'terms', 'done_text'];

const DEFAULT_SETTINGS_ = {
  site_title: 'Рынок у отеля',
  phone: '+84 000 000 000',
  whatsapp: '84000000000',
  telegram: 'primer_operator',
  orders_enabled: true,
  announcement: '',
  terms: '',
  done_text: 'С вами свяжутся по поводу заказа на оставленный контактный телефон. Ожидайте.',
  rate_vnd_per_rub: 300,
  rub_rounding: 10,
  popular_days: 30,
  popular_count: 8,
};

const LIMITS_ = {
  name: 50, room: 10, comment: 500,
  productName: 60, short: 80, desc: 600, category: 40, note: 200,
  items: 50, maxQty: 100,
};

const ID_RE_ = /^[a-z0-9-]{2,20}$/;
const CLIENT_ORDER_ID_RE_ = /^[A-Za-z0-9_-]{8,64}$/;
const LATE_SORT_ = 1000000; // товары без «Порядка» идут в конец

// ===== Начальные данные листов (их записывает setup(), если листы пустые) =====

// [ID, Показывать, Название, Иконка, Подпись, Порядок]
const INITIAL_CATEGORY_ROWS_ = [
  ['fruits', true, 'Фрукты', '🥭', 'Свежие фрукты с рынка. Цены за килограмм или за штуку указаны рядом с товаром.', 1],
  ['alcohol', true, 'Ром и алкоголь', '🥃', 'Только для совершеннолетних.', 2],
  ['sweets', false, 'Сладости', '🍬', '', 3],
  ['coffee', false, 'Кофе', '☕', '', 4],
  ['souvenirs', false, 'Сувениры', '🎁', '', 5],
  ['pharmacy', false, 'Аптека', '💊', 'Обычные безрецептурные товары из аптеки. Перед применением прочитайте инструкцию.', 6],
];

// Пояснения для Сани в листе «Настройки»
const SETTING_HINTS_ = {
  site_title: 'Название в шапке сайта',
  phone: 'Телефон для звонка',
  whatsapp: 'Номер WhatsApp, только цифры, с кодом страны',
  telegram: 'Ник в Telegram без @',
  orders_enabled: 'Галочка: принимаем заказы. Снять, если вы заняты или уехали: на сайте появится «Сейчас заказы не принимаются»',
  announcement: 'Объявление на главной странице. Пусто — объявления нет',
  terms: 'Условия (доставка, оплата). Пусто — блок скрыт',
  done_text: 'Текст, который гость видит после заказа',
  rate_vnd_per_rub: 'Курс: сколько донгов в одном рубле. По нему считаются рублёвые цены из «Цена ₫»',
  rub_rounding: 'Рублёвая цена из донгов округляется вверх до этого числа (10 → 290, 300, 310…)',
  popular_days: 'За сколько последних дней считать «Самое популярное»',
  popular_count: 'Сколько товаров показывать в «Самом популярном»',
};

// [Ключ, Значение, Публично («да» — уходит на сайт; справочная колонка), Пояснение]
function initialSettingRows_() {
  return Object.keys(DEFAULT_SETTINGS_).map(function (key) {
    return [key, DEFAULT_SETTINGS_[key], PUBLIC_SETTING_KEYS_.indexOf(key) === -1 ? 'нет' : 'да', SETTING_HINTS_[key] || ''];
  });
}

// ===== Мелкие помощники =====

// Словарь без прототипа: ID вроде «constructor» не должен совпасть со свойством объекта
function newMap_() {
  return Object.create(null);
}

function normalizeHeader_(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Убирает управляющие символы. multiline = true оставляет переносы строк.
function cleanText_(value, maxLength, multiline) {
  let s = value == null ? '' : String(value);
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]+/g, ' ')
    : s.replace(/[\u0000-\u001F\u007F]+/g, ' ');
  s = s.replace(/[ \t]+/g, ' ').trim();
  return maxLength ? s.slice(0, maxLength).trim() : s;
}

// 85 000 / «1,5» / 1.5 → число; всё остальное → null
function parseNumber_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (value == null) return null;
  const s = String(value).replace(/[\s ]/g, '').replace(',', '.');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

// Флажок таблицы: true / TRUE / да / 1. Пустое значение — defaultValue.
function parseBool_(value, defaultValue) {
  if (typeof value === 'boolean') return value;
  if (value == null || String(value).trim() === '') return Boolean(defaultValue);
  const s = String(value).trim().toLowerCase();
  if (['true', 'да', 'yes', '1', 'вкл', '✓', '✔'].indexOf(s) !== -1) return true;
  if (['false', 'нет', 'no', '0', 'выкл'].indexOf(s) !== -1) return false;
  return Boolean(defaultValue);
}

function round3_(n) {
  return Math.round(n * 1000) / 1000;
}

// Дата из ячейки (Date, число или строка) → миллисекунды; не получилось → null
function toMs_(value) {
  if (value == null || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    const t = value.getTime();
    return isNaN(t) ? null : t;
  }
  if (typeof value === 'number') return isFinite(value) ? value : null;
  const t = Date.parse(String(value));
  return isNaN(t) ? null : t;
}

// ===== Защита от вставки опасного текста =====

// Экранирование для Telegram parse_mode: "HTML"
function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Текст, начинающийся с = + - @ (или табуляции), таблица принимает за формулу.
// Добавляем «'», чтобы значение осталось обычным текстом. Числа не трогаем.
function sanitizeCell_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

// ===== Телефон =====

// «8 (999) 000-00-00» → «+79990000000»; «+84 90 000 00 00» → «+84900000000»; «0084 …» → «+84…»
function normalizePhone_(raw) {
  const text = String(raw == null ? '' : raw).trim();
  const hasPlus = text.charAt(0) === '+';
  let digits = text.replace(/\D/g, '');
  if (!hasPlus && digits.indexOf('00') === 0) {
    digits = digits.slice(2);
  } else if (!hasPlus && digits.length === 11 && digits.charAt(0) === '8') {
    digits = '7' + digits.slice(1);
  }
  return digits ? '+' + digits : '';
}

// Правила те же, что на сайте (site/js/order.js): 9–15 цифр с кодом страны;
// 10 цифр на 9 без «+» — это российский номер без кода страны, такой не принимаем.
function checkPhone_(raw) {
  const phone = normalizePhone_(raw);
  if (!phone) return { ok: false, phone: '', error: 'Введите номер телефона' };
  const digits = phone.slice(1);
  if (String(raw).trim().charAt(0) !== '+' && digits.length === 10 && digits.charAt(0) === '9') {
    return { ok: false, phone: phone, error: 'Добавьте код страны, например +7' };
  }
  if (!/^\+\d{9,15}$/.test(phone)) {
    return { ok: false, phone: phone, error: 'Проверьте номер: с кодом страны, например +7 999 000-00-00' };
  }
  return { ok: true, phone: phone, error: '' };
}

// ===== Цены =====

// Рублёвая цена товара. «Цена ₽» главнее; иначе донги / курс, округлённые вверх до rounding.
// Пример: 85 000 ₫ при курсе 300 и округлении 10 → ceil(283,3 / 10) × 10 = 290 ₽.
function computeRubPrice_(rub, vnd, rate, rounding) {
  const r = parseNumber_(rub);
  if (r !== null && r > 0) return Math.round(r * 100) / 100;
  const d = parseNumber_(vnd);
  const k = parseNumber_(rate);
  if (d === null || d <= 0 || k === null || k <= 0) return null;
  let step = parseNumber_(rounding);
  if (step === null || step <= 0) step = 1;
  return Math.ceil(d / k / step - 1e-9) * step;
}

// ===== Связанные товары =====

// «fr-002, sw-005;  FR-003» → ['fr-002', 'sw-005', 'fr-003'] без дублей, самого товара и неизвестных ID
function parseRelated_(value, knownIds, selfId) {
  const known = knownIds || newMap_();
  const out = [];
  String(value == null ? '' : value).split(/[\s,;]+/).forEach(function (part) {
    const id = part.trim().toLowerCase();
    if (id && id !== selfId && Object.prototype.hasOwnProperty.call(known, id) && known[id] && out.indexOf(id) === -1) out.push(id);
  });
  return out;
}

// ===== Фото =====

// ID файла Диска из ссылки или «голого» ID; для любой другой https-ссылки — сама ссылка; иначе ''
function extractDriveId_(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  let m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{25,}$/.test(s)) return s;
  return '';
}

// Адрес картинки для сайта. Размер (=w400) сайт добавляет сам.
function photoUrl_(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  const id = extractDriveId_(s);
  if (id) return 'https://lh3.googleusercontent.com/d/' + id;
  return /^https:\/\/[^\s]+$/.test(s) ? s : '';
}

// ===== Таблица → объекты =====

// values — двумерный массив из getValues(), первая строка — заголовки
function tableFromValues_(values) {
  const table = { headers: [], index: Object.create(null), rows: [] };
  if (!values || !values.length) return table;
  table.headers = values[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  table.headers.forEach(function (h, i) {
    const key = normalizeHeader_(h);
    if (key && !(key in table.index)) table.index[key] = i;
  });
  table.rows = values.slice(1);
  return table;
}

function cell_(table, row, header) {
  const i = table.index[normalizeHeader_(header)];
  return i === undefined ? '' : row[i];
}

function hasHeader_(table, header) {
  return normalizeHeader_(header) in table.index;
}

function missingHeaders_(table, required) {
  return required.filter(function (h) { return !hasHeader_(table, h); });
}

function isBlankRow_(row) {
  return row.every(function (v) { return v === '' || v == null; });
}

// Строка без «ключевых» значений считается пустой. Остальные ячейки в пустых строках не пусты:
// в колонках с флажками лежит FALSE, а колонку «Обновлено» заполняет скрипт, поэтому isBlankRow_ здесь не подходит.
function isBlankRecord_(table, row, headers) {
  return headers.every(function (h) {
    const v = cell_(table, row, h);
    return v === '' || v == null || String(v).trim() === '';
  });
}

// Номер последней заполненной строки колонки (с 1) или 0. values — [[ячейка], ...] начиная с первой строки.
// Нужна вместо getLastRow(): флажки в пустых строках хранят FALSE и растягивают «последнюю строку» до конца листа.
function lastFilledRow_(values) {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i][0];
    if (v !== '' && v != null) return i + 1;
  }
  return 0;
}

// ===== Настройки =====

// Возвращает { public: {...для сайта}, rate, rounding, popularDays, popularCount }
function parseSettings_(table) {
  const raw = newMap_();
  table.rows.forEach(function (row) {
    const key = String(cell_(table, row, 'Ключ')).trim();
    if (key) raw[key] = cell_(table, row, 'Значение');
  });
  const get = function (key) { return key in raw && raw[key] !== '' ? raw[key] : DEFAULT_SETTINGS_[key]; };
  const text = function (key, max) {
    const v = key in raw ? raw[key] : DEFAULT_SETTINGS_[key];
    return cleanText_(v, max, true);
  };
  const pub = {
    site_title: cleanText_(get('site_title'), 60) || DEFAULT_SETTINGS_.site_title,
    phone: cleanText_(get('phone'), 30),
    whatsapp: String(get('whatsapp')).replace(/\D/g, ''),
    telegram: String(get('telegram')).replace(/[^A-Za-z0-9_]/g, ''),
    orders_enabled: parseBool_(raw.orders_enabled, DEFAULT_SETTINGS_.orders_enabled),
    announcement: text('announcement', 300),
    terms: text('terms', 600),
    done_text: cleanText_(get('done_text'), 300, true),
  };
  const num = function (key, min) {
    const v = parseNumber_(raw[key]);
    return v !== null && v >= min ? v : DEFAULT_SETTINGS_[key];
  };
  return {
    public: pub,
    rate: num('rate_vnd_per_rub', 0.0001),
    rounding: num('rub_rounding', 1),
    popularDays: num('popular_days', 1),
    popularCount: Math.floor(num('popular_count', 1)),
  };
}

// ===== Категории =====

// allIds — сюда складываются ID всех категорий таблицы, в том числе выключенных
function buildCategories_(table, errors, allIds) {
  const list = [];
  const seen = allIds || newMap_();
  table.rows.forEach(function (row, i) {
    if (isBlankRecord_(table, row, ['ID', 'Название'])) return;
    const rowNo = i + 2;
    const id = String(cell_(table, row, 'ID')).trim().toLowerCase();
    if (!id) { errors.push({ where: SHEET_NAMES_.categories, row: rowNo, message: 'У категории «' + cleanText_(cell_(table, row, 'Название'), 30) + '» пустой ID' }); return; }
    if (!ID_RE_.test(id)) { errors.push({ where: SHEET_NAMES_.categories, row: rowNo, message: 'Неверный ID «' + cleanText_(id, 30) + '»: только маленькие латинские буквы, цифры и дефис' }); return; }
    if (seen[id]) { errors.push({ where: SHEET_NAMES_.categories, row: rowNo, message: 'ID «' + id + '» уже есть выше, строка пропущена' }); return; }
    seen[id] = true;
    if (!parseBool_(cell_(table, row, 'Показывать'), false)) return;
    const name = cleanText_(cell_(table, row, 'Название'), LIMITS_.category);
    if (!name) { errors.push({ where: SHEET_NAMES_.categories, row: rowNo, message: 'У категории «' + id + '» нет названия' }); return; }
    const sort = parseNumber_(cell_(table, row, 'Порядок'));
    list.push({
      id: id,
      name: name,
      icon: cleanText_(cell_(table, row, 'Иконка'), 8),
      note: cleanText_(cell_(table, row, 'Подпись'), LIMITS_.note),
      sort: sort === null ? LATE_SORT_ : sort,
    });
  });
  list.sort(function (a, b) { return (a.sort - b.sort) || a.name.localeCompare(b.name, 'ru'); });
  return list;
}

// ===== Товары =====

const STOCK_FROM_LABEL_ = {
  'в наличии': 'in', 'in': 'in', 'есть': 'in',
  'под заказ': 'preorder', 'preorder': 'preorder',
  'сезон закончился': 'out', 'out': 'out', 'нет': 'out', 'нет в наличии': 'out',
};

function stockFromLabel_(value) {
  return STOCK_FROM_LABEL_[String(value == null ? '' : value).trim().toLowerCase()] || 'in';
}

// Возвращает { products: [публичные товары], hits: { id: true } }
// allCategoryIds — ID всех категорий таблицы: товар выключенной категории скрыт без ошибки
function buildProducts_(table, categories, allCategoryIds, settings, errors) {
  const catIds = newMap_();
  categories.forEach(function (c) { catIds[c.id] = true; });
  const products = [];
  const related = newMap_();
  const hits = newMap_();
  const seen = newMap_();

  table.rows.forEach(function (row, i) {
    if (isBlankRecord_(table, row, ['ID', 'Название', 'Категория'])) return;
    const rowNo = i + 2;
    const where = SHEET_NAMES_.products;
    const rawId = String(cell_(table, row, 'ID')).trim().toLowerCase();
    if (!rawId) { errors.push({ where: where, row: rowNo, message: 'Пустой ID' }); return; }
    if (!ID_RE_.test(rawId)) { errors.push({ where: where, row: rowNo, message: 'Неверный ID «' + cleanText_(rawId, 30) + '»: только маленькие латинские буквы, цифры и дефис, 2–20 знаков' }); return; }
    if (seen[rawId]) { errors.push({ where: where, row: rowNo, message: 'ID «' + rawId + '» уже есть выше, строка пропущена' }); return; }
    seen[rawId] = true;
    if (!parseBool_(cell_(table, row, 'Показывать'), false)) return;

    const name = cleanText_(cell_(table, row, 'Название'), LIMITS_.productName);
    if (!name) { errors.push({ where: where, row: rowNo, message: 'У товара «' + rawId + '» нет названия' }); return; }

    const cat = String(cell_(table, row, 'Категория')).trim().toLowerCase();
    if (!cat) { errors.push({ where: where, row: rowNo, message: 'У товара «' + rawId + '» не выбрана категория' }); return; }
    if (!catIds[cat]) {
      if (!allCategoryIds[cat]) errors.push({ where: where, row: rowNo, message: 'Категория «' + cleanText_(cat, 30) + '» не найдена (товар «' + rawId + '» не показан)' });
      return; // категория выключена: товары скрыты вместе с ней
    }

    const price = computeRubPrice_(cell_(table, row, 'Цена ₽'), cell_(table, row, 'Цена ₫'), settings.rate, settings.rounding);
    if (price === null) { errors.push({ where: where, row: rowNo, message: 'У товара «' + rawId + '» нет цены (заполните «Цена ₽» или «Цена ₫»)' }); return; }

    let step = parseNumber_(cell_(table, row, 'Шаг'));
    step = step !== null && step > 0 ? round3_(step) : 1;
    let min = parseNumber_(cell_(table, row, 'Минимум'));
    min = min !== null && min > 0 ? round3_(min) : step;
    if (min < step) min = step;
    const sort = parseNumber_(cell_(table, row, 'Порядок'));

    products.push({
      id: rawId,
      cat: cat,
      name: name,
      short: cleanText_(cell_(table, row, 'Коротко'), LIMITS_.short),
      desc: cleanText_(cell_(table, row, 'Описание'), LIMITS_.desc, true),
      price: price,
      unit: cleanText_(cell_(table, row, 'Единица'), 20) || 'шт',
      step: step,
      min: min,
      img: photoUrl_(cell_(table, row, 'Фото')),
      warn: cleanText_(cell_(table, row, 'Предупреждения'), 400, true),
      src: cleanText_(cell_(table, row, 'Где куплено'), 80),
      adult: parseBool_(cell_(table, row, '18+'), false),
      stock: stockFromLabel_(cell_(table, row, 'Наличие')),
      rel: [],
      sort: sort === null ? LATE_SORT_ : sort,
    });
    related[rawId] = cell_(table, row, 'Похожие');
    if (parseBool_(cell_(table, row, 'Хит'), false)) hits[rawId] = true;
  });

  // «Похожие» разбираем, когда известны все опубликованные ID
  const known = newMap_();
  products.forEach(function (p) { known[p.id] = true; });
  products.forEach(function (p) { p.rel = parseRelated_(related[p.id], known, p.id); });
  return { products: products, hits: hits };
}

// ===== «Самое популярное» =====

// Строки листа «Позиции заказов» → [{ productId, ms, cancelled }]
function parseOrderLines_(values) {
  const table = tableFromValues_(values);
  const lines = [];
  table.rows.forEach(function (row) {
    const productId = String(cell_(table, row, 'ID товара')).trim().toLowerCase();
    const ms = toMs_(cell_(table, row, 'Создан'));
    if (!productId || ms === null) return;
    lines.push({ productId: productId, ms: ms, cancelled: parseBool_(cell_(table, row, 'Отменён'), false) });
  });
  return lines;
}

// Сначала «Хит» (по порядку в каталоге), потом по числу заказов за последние days дней.
// Отменённые заказы и товары «сезон закончился» не учитываются. Результат — не больше count ID.
function computePopular_(products, hits, lines, nowMs, days, count) {
  const byId = newMap_();
  products.forEach(function (p) { byId[p.id] = p; });
  const since = nowMs - days * 24 * 3600 * 1000;
  const counts = newMap_();
  (lines || []).forEach(function (l) {
    if (l.cancelled || l.ms < since || l.ms > nowMs + 24 * 3600 * 1000) return;
    counts[l.productId] = (counts[l.productId] || 0) + 1;
  });
  const order = function (a, b) { return (a.sort - b.sort) || a.name.localeCompare(b.name, 'ru'); };
  const available = products.filter(function (p) { return p.stock !== 'out'; });
  const hitList = available.filter(function (p) { return hits && hits[p.id]; }).sort(order);
  const stat = available.filter(function (p) { return !(hits && hits[p.id]) && counts[p.id] > 0; })
    .sort(function (a, b) { return (counts[b.id] - counts[a.id]) || order(a, b); });
  return hitList.concat(stat).slice(0, count).map(function (p) { return p.id; });
}

// ===== Сборка каталога =====

// input: { categoryValues, productValues, settingValues, orderItemValues, nowMs }
// Возвращает { catalog: {settings, categories, products, popular}, errors: [{where,row,message}], fatal: bool }
// fatal — в таблице нет обязательных колонок: каталог пустой, вместо него лучше отдать прошлый.
function assembleCatalog_(input) {
  const errors = [];
  const settingsTable = tableFromValues_(input.settingValues);
  const settings = parseSettings_(settingsTable);
  const catTable = tableFromValues_(input.categoryValues);
  const prodTable = tableFromValues_(input.productValues);
  let fatal = false;

  const missingCat = missingHeaders_(catTable, ['ID', 'Показывать', 'Название']);
  const missingProd = missingHeaders_(prodTable, ['ID', 'Показывать', 'Категория', 'Название']);
  if (!hasHeader_(prodTable, 'Цена ₽') && !hasHeader_(prodTable, 'Цена ₫')) missingProd.push('Цена ₽ / Цена ₫');
  if (missingCat.length) {
    fatal = true;
    errors.push({ where: SHEET_NAMES_.categories, row: 1, message: 'Нет обязательных колонок: ' + missingCat.join(', ') + '. Не переименовывайте заголовки.' });
  }
  if (missingProd.length) {
    fatal = true;
    errors.push({ where: SHEET_NAMES_.products, row: 1, message: 'Нет обязательных колонок: ' + missingProd.join(', ') + '. Не переименовывайте заголовки.' });
  }

  let categories = [];
  let products = [];
  let hits = newMap_();
  if (!fatal) {
    const allCategoryIds = newMap_();
    categories = buildCategories_(catTable, errors, allCategoryIds);
    const built = buildProducts_(prodTable, categories, allCategoryIds, settings, errors);
    products = built.products;
    hits = built.hits;
  }
  // Категории без товаров на сайте не нужны, но отдаём все включённые: сайт сам скрывает пустые
  const popular = computePopular_(products, hits, parseOrderLines_(input.orderItemValues), input.nowMs, settings.popularDays, settings.popularCount);
  return {
    catalog: { settings: settings.public, categories: categories, products: products, popular: popular },
    errors: errors,
    fatal: fatal,
  };
}

// Подпись набора ошибок: чтобы не записывать в лист «Ошибки» одно и то же при каждой пересборке каталога
function errorsSignature_(errors) {
  return errors.map(function (e) { return e.where + '#' + e.row + '#' + e.message; }).join('\n');
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) { return ('0' + ((b < 0 ? b + 256 : b)).toString(16)).slice(-2); }).join('');
}

// Строку делим на куски: в кэше значение не может быть больше 100 КБ
function splitIntoChunks_(text, size) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks.length ? chunks : [''];
}

// ===== Заказ: проверка =====

// Индекс товаров каталога для проверки заказа: { id: товар }
function indexProducts_(catalog) {
  const index = newMap_();
  (catalog.products || []).forEach(function (p) { index[p.id] = p; });
  return index;
}

function stepIsMultiple_(qty, step) {
  const ratio = qty / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

// body — тело POST-запроса, index — indexProducts_(каталог).
// Успех: { ok: true, order: {...} }. Ошибка: { ok: false, error, message, fields, items }.
function validateOrder_(body, index) {
  const fields = {};
  const b = body && typeof body === 'object' ? body : {};

  const clientOrderId = typeof b.clientOrderId === 'string' ? b.clientOrderId : '';
  if (!CLIENT_ORDER_ID_RE_.test(clientOrderId)) fields.clientOrderId = 'Неверный номер запроса';

  const phone = checkPhone_(b.phone);
  if (!phone.ok) fields.phone = phone.error;

  let messenger = 'whatsapp';
  if (b.messenger != null && b.messenger !== '') {
    if (MESSENGER_LABELS_[b.messenger] && typeof b.messenger === 'string') messenger = b.messenger;
    else fields.messenger = 'Выберите способ связи';
  }

  const limits = [['name', LIMITS_.name, false], ['room', LIMITS_.room, false], ['comment', LIMITS_.comment, true]];
  const text = {};
  limits.forEach(function (l) {
    const raw = b[l[0]] == null ? '' : String(b[l[0]]);
    const value = cleanText_(raw, 0, l[2]);
    if (value.length > l[1]) fields[l[0]] = 'Слишком длинно: не больше ' + l[1] + ' символов';
    text[l[0]] = value;
  });

  // Состав: дубли ID складываются
  const items = [];
  const rawItems = Array.isArray(b.items) ? b.items : null;
  if (!rawItems || rawItems.length === 0) {
    fields.items = 'Корзина пуста';
  } else if (rawItems.length > LIMITS_.items) {
    fields.items = 'Слишком много позиций: не больше ' + LIMITS_.items;
  } else {
    const byId = newMap_();
    rawItems.forEach(function (it) {
      const id = it && typeof it.id === 'string' ? it.id.trim().toLowerCase() : '';
      const qty = it ? parseNumber_(it.qty) : null;
      if (!id || qty === null || qty <= 0 || qty > LIMITS_.maxQty * 2) { fields.items = 'Неверное количество товара'; return; }
      if (byId[id]) byId[id].qty = round3_(byId[id].qty + qty);
      else { byId[id] = { id: id, qty: round3_(qty) }; items.push(byId[id]); }
    });
  }

  if (Object.keys(fields).length) {
    return { ok: false, error: 'VALIDATION', message: 'Проверьте введённые данные', fields: fields, items: [] };
  }

  const unavailable = items.filter(function (it) {
    const p = index[it.id];
    return !p || p.stock === 'out';
  }).map(function (it) { return it.id; });
  if (unavailable.length) {
    return { ok: false, error: 'ITEM_UNAVAILABLE', message: 'Некоторые товары сейчас недоступны', fields: {}, items: unavailable };
  }

  const lines = [];
  let total = 0;
  let hasAdult = false;
  items.forEach(function (it) {
    const p = index[it.id];
    const step = p.step > 0 ? p.step : 1;
    const min = Math.max(p.min > 0 ? p.min : 0, step);
    if (it.qty > LIMITS_.maxQty || it.qty < min - 1e-9 || !stepIsMultiple_(it.qty, step)) {
      fields.items = 'Неверное количество: «' + p.name + '»';
      return;
    }
    const sum = Math.round(p.price * it.qty * 100) / 100;
    total += p.price * it.qty;
    if (p.adult) hasAdult = true;
    lines.push({ id: p.id, name: p.name, unit: p.unit, price: p.price, qty: it.qty, sum: sum, adult: Boolean(p.adult) });
  });
  if (hasAdult && b.adultConfirmed !== true) fields.adult = 'Подтвердите, что вам есть 18 лет';
  if (Object.keys(fields).length) {
    return { ok: false, error: 'VALIDATION', message: 'Проверьте введённые данные', fields: fields, items: [] };
  }

  return {
    ok: true,
    order: {
      clientOrderId: clientOrderId,
      phone: phone.phone,
      messenger: messenger,
      name: text.name,
      room: text.room,
      comment: text.comment,
      adultConfirmed: b.adultConfirmed === true,
      hasAdult: hasAdult,
      items: lines,
      total: Math.round(total),
    },
  };
}

// ===== Заказ: тексты =====

function formatNumberRu_(n) {
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

function formatRub_(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}

// N-0042; после 9999 цифр просто больше
function formatOrderNo_(seq) {
  return 'N-' + ('0000' + seq).slice(-Math.max(4, String(seq).length));
}

// «Манго — 2 кг × 280 ₽ = 560 ₽; Ром — 1 бут. 0,7 л × 750 ₽ = 750 ₽» для колонки «Состав»
function buildOrderComposition_(order) {
  return order.items.map(function (l) {
    return l.name + ' — ' + formatNumberRu_(l.qty) + ' ' + l.unit + ' × ' + formatRub_(l.price) + ' = ' + formatRub_(l.sum);
  }).join('; ');
}

// Сообщение оператору. asHtml = true — для Telegram (parse_mode HTML), иначе обычный текст для письма.
function buildOrderText_(order, orderNo, asHtml) {
  const esc = asHtml ? escapeHtml_ : function (s) { return String(s); };
  const bold = function (s) { return asHtml ? '<b>' + s + '</b>' : s; };
  const prefers = { whatsapp: 'предпочитает WhatsApp', telegram: 'предпочитает Telegram', call: 'просит позвонить' };
  const rows = [];
  rows.push('🛒 ' + bold('Новый заказ ' + esc(orderNo)));
  rows.push('📞 ' + esc(order.phone) + ' — ' + prefers[order.messenger]);
  const who = [];
  if (order.name) who.push(esc(order.name));
  if (order.room) who.push('комн. ' + esc(order.room));
  if (who.length) rows.push('👤 ' + who.join(', '));
  rows.push('');
  order.items.forEach(function (l) {
    rows.push('• ' + esc(l.name) + ' — ' + formatNumberRu_(l.qty) + ' ' + esc(l.unit) + ' × ' + formatRub_(l.price) + ' = ' + formatRub_(l.sum));
  });
  rows.push(bold('Итого ≈ ' + formatRub_(order.total)));
  if (order.hasAdult) rows.push('🔞 Возраст подтверждён');
  if (order.comment) {
    rows.push('');
    rows.push('💬 ' + esc(order.comment));
  }
  return rows.join('\n');
}

// Кнопки-ссылки под сообщением в Telegram
function buildOrderButtons_(order, sheetUrl) {
  const digits = order.phone.replace(/\D/g, '');
  const keyboard = [[
    { text: 'Написать в WhatsApp', url: 'https://wa.me/' + digits },
    { text: 'Написать в Telegram', url: 'https://t.me/+' + digits },
  ]];
  if (sheetUrl) keyboard.push([{ text: 'Открыть таблицу', url: sheetUrl }]);
  return { inline_keyboard: keyboard };
}

// ===== Лимиты частоты заказов =====

const RATE_PHONE_LIMIT_ = 3;                        // заказов с одного телефона…
const RATE_PHONE_WINDOW_MS_ = 10 * 60 * 1000;       // …за 10 минут
const RATE_GLOBAL_LIMIT_ = 60;                      // заказов всего…
const RATE_GLOBAL_WINDOW_MS_ = 60 * 60 * 1000;      // …за час

// Счётчик хранится в кэше строкой «число|время начала окна». Окно закончилось или записи нет — начинаем с нуля.
function parseRateState_(raw, nowMs, windowMs) {
  const m = /^(\d+)\|(\d+)$/.exec(String(raw == null ? '' : raw));
  if (m) {
    const t0 = Number(m[2]);
    if (nowMs >= t0 && nowMs - t0 < windowMs) return { n: Number(m[1]), t0: t0 };
  }
  return { n: 0, t0: nowMs };
}

function serializeRateState_(state) {
  return state.n + '|' + state.t0;
}

// Сколько секунд хранить счётчик (не меньше секунды и не больше 6 часов — предел кэша)
function rateTtlSeconds_(state, nowMs, windowMs) {
  return Math.max(1, Math.min(21600, Math.ceil((state.t0 + windowMs - nowMs) / 1000)));
}

// ===== Строки для листов «Заказы» и «Позиции заказов» =====

// Значения собираются по заголовкам листа (колонки можно переставлять); текст проходит sanitizeCell_
function alignRow_(headers, obj) {
  const byKey = newMap_();
  Object.keys(obj).forEach(function (k) { byKey[normalizeHeader_(k)] = obj[k]; });
  return headers.map(function (h) {
    const key = normalizeHeader_(h);
    return key in byKey ? sanitizeCell_(byKey[key]) : '';
  });
}

function orderRowObject_(order, orderNo, nowMs, notifyStatus) {
  return {
    'Номер': orderNo,
    'Создан': new Date(nowMs),
    'Статус': ORDER_STATUSES_[0],
    'Телефон': order.phone,
    'Связь': MESSENGER_LABELS_[order.messenger],
    'Имя': order.name,
    'Комната': order.room,
    'Комментарий': order.comment,
    'Состав': buildOrderComposition_(order),
    'Сумма ₽': order.total,
    '18+ подтверждено': order.hasAdult ? order.adultConfirmed : '',
    'Уведомление': notifyStatus,
    'ID клиента': order.clientOrderId,
    'Заметки': '',
  };
}

function orderItemRowObjects_(order, orderNo, nowMs) {
  return order.items.map(function (l) {
    return {
      'Номер заказа': orderNo,
      'Создан': new Date(nowMs),
      'ID товара': l.id,
      'Название': l.name,
      'Кол-во': l.qty,
      'Цена ₽': l.price,
      'Сумма ₽': l.sum,
      'Отменён': false,
    };
  });
}

// Самый большой номер заказа в колонке «Номер» («N-0042» → 42). Нужен, чтобы номера не повторялись,
// даже если служебный счётчик пропал.
function maxOrderSeq_(values) {
  let max = 0;
  (values || []).forEach(function (row) {
    const m = /^N-(\d+)$/.exec(String(row[0]).trim());
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max;
}

// ===== Telegram =====

const TELEGRAM_TEXT_LIMIT_ = 3900; // у Telegram предел 4096 знаков; запас на всякий случай

// chat_id через запятую, пробел или «;». Для групп id отрицательный.
function parseChatIds_(raw) {
  const out = [];
  String(raw == null ? '' : raw).split(/[\s,;]+/).forEach(function (part) {
    if (/^-?\d{5,20}$/.test(part) && out.indexOf(part) === -1) out.push(part);
  });
  return out;
}

// Тело запроса sendMessage. Очень длинный заказ отправляется простым текстом без разметки,
// чтобы обрезка не сломала HTML-теги.
function telegramPayload_(order, orderNo, chatId, sheetUrl) {
  const html = buildOrderText_(order, orderNo, true);
  const markup = buildOrderButtons_(order, sheetUrl);
  if (html.length <= TELEGRAM_TEXT_LIMIT_) {
    return { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup };
  }
  let text = buildOrderText_(order, orderNo, false);
  if (text.length > TELEGRAM_TEXT_LIMIT_) text = text.slice(0, TELEGRAM_TEXT_LIMIT_ - 10) + '\n…';
  return { chat_id: chatId, text: text, disable_web_page_preview: true, reply_markup: markup };
}

function chatLabel_(chat) {
  if (chat.type === 'private') {
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || 'без имени';
    return name + (chat.username ? ' (@' + chat.username + ')' : '');
  }
  return (chat.title || 'чат') + ' (' + (chat.type === 'channel' ? 'канал' : 'группа') + ')';
}

// Чаты, которые писали боту: ответ getUpdates → [{id, label}]
function extractChatsFromUpdates_(json) {
  const out = [];
  const seen = newMap_();
  const updates = json && Array.isArray(json.result) ? json.result : [];
  updates.forEach(function (u) {
    const sources = [u.message, u.edited_message, u.channel_post, u.edited_channel_post, u.my_chat_member, u.callback_query && u.callback_query.message];
    sources.forEach(function (x) {
      const chat = x && x.chat;
      if (!chat || chat.id == null) return;
      const id = String(chat.id);
      if (seen[id]) return;
      seen[id] = true;
      out.push({ id: id, label: chatLabel_(chat) });
    });
  });
  return out;
}

// Токен бота не должен попасть ни в лист «Ошибки», ни в логи
function scrubSecrets_(text, secrets) {
  let s = String(text == null ? '' : text);
  (secrets || []).forEach(function (secret) {
    if (secret && String(secret).length >= 6) s = s.split(String(secret)).join('***');
  });
  return s.replace(/bot\d{6,}:[A-Za-z0-9_-]{20,}/g, 'bot***');
}

// Итог отправки уведомления для колонки «Уведомление».
// input: { telegramConfigured, results: [{chatId, ok, error}], email: null | {attempted, ok, error} }
function buildNotifyStatus_(input) {
  if (!input.telegramConfigured) {
    const noTelegram = 'Telegram не настроен (нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_IDS)';
    return noTelegram + '; ' + emailStatusText_(input.email);
  }
  const failed = input.results.filter(function (r) { return !r.ok; });
  if (failed.length === 0) return 'ok';
  if (failed.length < input.results.length) {
    return 'ok, но не всем: ' + failed.map(function (r) { return r.chatId + ' — ' + r.error; }).join('; ');
  }
  return 'ошибка Telegram: ' + failed.map(function (r) { return r.error; }).join('; ') + '; ' + emailStatusText_(input.email);
}

function emailStatusText_(email) {
  if (!email || !email.attempted) return 'почта (ALERT_EMAIL) не задана';
  return email.ok ? 'письмо отправлено' : 'письмо не отправлено: ' + email.error;
}
