/**
 * Orders.gs — приём заказа с сайта: проверка, защита от дублей и перегрузки, запись в таблицу.
 * Правила проверки лежат в Logic.gs (validateOrder_), здесь только сервисы Google.
 */

const ORDER_LOCK_WAIT_MS_ = 20000;
const IDEMPOTENCY_TTL_S_ = 21600;        // повтор того же заказа в течение 6 часов не создаёт дубль
const PROP_ORDER_SEQ_ = 'ORDER_SEQ';
const PENDING_NOTIFY_ = 'отправляется…';
// Без этих колонок заказ записать нельзя, иначе он потеряется или попадёт не туда
const ORDERS_REQUIRED_HEADERS_ = ['Номер', 'Создан', 'Телефон', 'Состав', 'Сумма ₽'];

function orderError_(error, message) {
  return { ok: false, error: error, message: message, fields: {}, items: [] };
}

// Обрабатывает заказ из POST. Возвращает объект ответа по контракту docs/05-api.md.
function handleOrder_(body) {
  // 1. Ловушка для ботов: притворяемся, что всё хорошо, и ничего не пишем
  if (body && typeof body.website === 'string' && body.website.trim() !== '') {
    logEvent_('warn', 'Заказ: сработала ловушка для ботов', 'заказ не записан', { visitor: cleanVisitorId_(body.visitorId) });
    return { ok: true, orderNo: 'N-0000', total: 0, duplicate: false };
  }

  // 2–3. Приём включён? Заказ допустимый? Цены берём из каталога (кэш до 5 минут)
  let catalog = getCatalog_(false);
  if (catalog.settings && catalog.settings.orders_enabled === false) {
    logEvent_('warn', 'Заказ отклонён', 'приём заказов выключен в «Настройках»', { visitor: cleanVisitorId_(body && body.visitorId) });
    return orderError_('ORDERS_PAUSED', 'Сейчас заказы не принимаются');
  }
  let checked = validateOrder_(body, indexProducts_(catalog));
  if (!checked.ok && checked.error === 'ITEM_UNAVAILABLE') {
    // Кэш мог устареть: перед отказом перечитываем таблицу
    catalog = getCatalog_(true);
    if (catalog.settings && catalog.settings.orders_enabled === false) {
      logEvent_('warn', 'Заказ отклонён', 'приём заказов выключен в «Настройках»', { visitor: cleanVisitorId_(body && body.visitorId) });
      return orderError_('ORDERS_PAUSED', 'Сейчас заказы не принимаются');
    }
    checked = validateOrder_(body, indexProducts_(catalog));
  }
  if (!checked.ok) {
    logEvent_('warn', 'Заказ отклонён', checked.error + (checked.items && checked.items.length ? ', товары: ' + checked.items.join(', ') : '')
      + (Object.keys(checked.fields || {}).length ? ', поля: ' + Object.keys(checked.fields).join(', ') : ''),
      { visitor: cleanVisitorId_(body && body.visitorId) });
    return checked;
  }
  const order = checked.order;
  logEvent_('info', 'Заказ получен', 'позиций ' + order.items.length + ', сумма ' + order.total + ' ₽, связь: ' + (MESSENGER_LABELS_[order.messenger] || order.messenger)
    + (order.hasAdult ? ', есть 18+' : ''), { visitor: order.visitor });

  // 4. Запись под блокировкой: два заказа одновременно не получат один номер
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(ORDER_LOCK_WAIT_MS_);
  } catch (err) {
    logEvent_('error', 'Заказ не записан', 'сервер занят: не получена блокировка за ' + ORDER_LOCK_WAIT_MS_ / 1000 + ' с', { visitor: order.visitor });
    return orderError_('SERVER', 'Сервер занят, повторите через несколько секунд');
  }
  let saved;
  try {
    saved = saveOrder_(order);
  } finally {
    lock.releaseLock();
  }
  if (saved.reply) {
    const r = saved.reply;
    if (r.ok) logEvent_('info', 'Повтор заказа', 'тот же заказ отправлен ещё раз, дубль не создан', { visitor: order.visitor, order: r.orderNo });
    else logEvent_('warn', 'Заказ отклонён', r.error + ': ' + r.message, { visitor: order.visitor });
    return saved.reply;
  }
  logEvent_('info', 'Заказ записан в таблицу', 'лист «' + SHEET_NAMES_.orders + '», строка ' + saved.row + '; ' + orderItemsShort_(order), { visitor: order.visitor, order: saved.orderNo });

  // 6. Уведомление не может отменить заказ: заказ уже в таблице
  let status;
  try {
    status = notifyOrder_(order, saved.orderNo);
  } catch (err) {
    status = 'ошибка уведомления: ' + scrubSecrets_(errorText_(err), []);
    logError_('Уведомление о заказе ' + saved.orderNo, status);
  }
  logEvent_(status === 'ok' ? 'info' : 'warn', 'Уведомление о заказе', status, { visitor: order.visitor, order: saved.orderNo });
  try {
    if (saved.notifyColumn) saved.sheet.getRange(saved.row, saved.notifyColumn).setValue(sanitizeCell_(status));
  } catch (err) {
    logError_('Заказ ' + saved.orderNo, 'Не удалось записать итог уведомления: ' + errorText_(err));
  }
  return { ok: true, orderNo: saved.orderNo, total: order.total, duplicate: false };
}

// GET ?action=orderStatus&id=<clientOrderId>: принят ли заказ. Нужен сайту, когда ответ на POST не дошёл до браузера
// (на некоторых телефонах ответ Apps Script не читается, хотя заказ уже записан). Номер знает только тот, кто отправил заказ.
function handleOrderStatus_(id) {
  const clientOrderId = typeof id === 'string' ? id : '';
  if (!CLIENT_ORDER_ID_RE_.test(clientOrderId)) return { ok: false, error: 'VALIDATION', message: 'Неверный запрос', fields: {}, items: [] };
  const earlier = CacheService.getScriptCache().get('ord_' + clientOrderId);
  let found = null;
  if (earlier) {
    try {
      found = JSON.parse(earlier);
    } catch (err) { /* битая запись — считаем, что заказа нет */ }
  }
  logEvent_('info', 'Проверка заказа', found ? 'найден, ответ на отправку не дошёл до гостя' : 'не найден', { order: found ? found.orderNo : '' });
  return found ? { ok: true, found: true, orderNo: found.orderNo, total: found.total } : { ok: true, found: false };
}

// Выполняется под блокировкой. Возвращает { reply } (дубль или лимит) либо данные записанного заказа.
function saveOrder_(order) {
  const cache = CacheService.getScriptCache();
  const nowMs = Date.now();

  // Повтор того же заказа (например, «Попробовать ещё раз» после обрыва связи)
  const idemKey = 'ord_' + order.clientOrderId;
  const earlier = cache.get(idemKey);
  if (earlier) {
    try {
      const prev = JSON.parse(earlier);
      return { reply: { ok: true, orderNo: prev.orderNo, total: prev.total, duplicate: true } };
    } catch (err) { /* битая запись — считаем заказ новым */ }
  }

  // Лимиты: с одного телефона и общий
  const phoneKey = 'rl_phone_' + order.phone.replace(/\D/g, '');
  const globalKey = 'rl_global_' + Math.floor(nowMs / RATE_GLOBAL_WINDOW_MS_);
  const phoneState = parseRateState_(cache.get(phoneKey), nowMs, RATE_PHONE_WINDOW_MS_);
  const globalState = parseRateState_(cache.get(globalKey), nowMs, RATE_GLOBAL_WINDOW_MS_);
  if (phoneState.n >= RATE_PHONE_LIMIT_ || globalState.n >= RATE_GLOBAL_LIMIT_) {
    return { reply: orderError_('RATE_LIMIT', 'Слишком много заказов подряд. Напишите нам в WhatsApp') };
  }

  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_NAMES_.orders);
  if (!sheet) throw new Error('Нет листа «' + SHEET_NAMES_.orders + '»: запустите «🛒 Рынок → Первоначальная настройка»');
  const headers = readHeaderRow_(sheet);
  const missing = ORDERS_REQUIRED_HEADERS_.filter(function (h) { return headers.map(normalizeHeader_).indexOf(normalizeHeader_(h)) === -1; });
  if (missing.length) throw new Error('В листе «' + SHEET_NAMES_.orders + '» нет колонок: ' + missing.join(', ') + '. Не переименовывайте заголовки.');

  // Номер: больше и счётчика, и самого большого номера в таблице
  const props = PropertiesService.getScriptProperties();
  const numberColumn = columnOf_(sheet, 'Номер');
  const numbers = columnValues_(sheet, numberColumn);
  const seq = Math.max(Number(props.getProperty(PROP_ORDER_SEQ_)) || 0, maxOrderSeq_(numbers.slice(1))) + 1;
  props.setProperty(PROP_ORDER_SEQ_, String(seq));
  const orderNo = formatOrderNo_(seq);

  // Следующая свободная строка — по колонке «Номер»: в пустых строках колонок с флажками лежит FALSE
  const row = Math.max(lastFilledRow_(numbers), 1) + 1;
  ensureRows_(sheet, row);
  sheet.getRange(row, 1, 1, headers.length).setValues([alignRow_(headers, orderRowObject_(order, orderNo, nowMs, PENDING_NOTIFY_))]);

  // С этой минуты заказ принят: повтор вернёт тот же номер, лимиты учитывают его
  cache.put(idemKey, JSON.stringify({ orderNo: orderNo, total: order.total }), IDEMPOTENCY_TTL_S_);
  cache.put(phoneKey, serializeRateState_({ n: phoneState.n + 1, t0: phoneState.t0 }), rateTtlSeconds_(phoneState, nowMs, RATE_PHONE_WINDOW_MS_));
  cache.put(globalKey, serializeRateState_({ n: globalState.n + 1, t0: globalState.t0 }), rateTtlSeconds_(globalState, nowMs, RATE_GLOBAL_WINDOW_MS_));

  // Позиции нужны только для статистики: сбой здесь не должен ломать принятый заказ
  try {
    writeOrderItems_(ss, order, orderNo, nowMs);
  } catch (err) {
    logError_('Заказ ' + orderNo, 'Позиции не записаны в «' + SHEET_NAMES_.orderItems + '»: ' + errorText_(err));
  }

  return { sheet: sheet, row: row, notifyColumn: columnOf_(sheet, 'Уведомление'), orderNo: orderNo };
}

function writeOrderItems_(ss, order, orderNo, nowMs) {
  const sheet = ss.getSheetByName(SHEET_NAMES_.orderItems);
  if (!sheet) throw new Error('Нет листа «' + SHEET_NAMES_.orderItems + '»');
  const headers = readHeaderRow_(sheet);
  const rows = orderItemRowObjects_(order, orderNo, nowMs).map(function (o) { return alignRow_(headers, o); });
  const first = Math.max(lastRowInColumn_(sheet, columnOf_(sheet, 'Номер заказа')), 1) + 1;
  ensureRows_(sheet, first + rows.length - 1);
  sheet.getRange(first, 1, rows.length, headers.length).setValues(rows);
}

// ===== Пункт меню «Создать тестовый заказ» =====

// Находит заказ по номеру, ставит ему статус «Отменён» (и его позициям — отметку), возвращает итог уведомления.
function markOrderCancelled_(orderNo) {
  const ss = getSpreadsheet_();
  const orders = ss.getSheetByName(SHEET_NAMES_.orders);
  const numberColumn = columnOf_(orders, 'Номер');
  const statusColumn = columnOf_(orders, 'Статус');
  const notifyColumn = columnOf_(orders, 'Уведомление');
  let notify = '';
  if (numberColumn) {
    const numbers = columnValues_(orders, numberColumn);
    for (let i = 1; i < numbers.length; i++) {
      if (String(numbers[i][0]).trim() !== orderNo) continue;
      if (statusColumn) orders.getRange(i + 1, statusColumn).setValue('Отменён');
      if (notifyColumn) notify = String(orders.getRange(i + 1, notifyColumn).getValue());
      break;
    }
  }
  const items = ss.getSheetByName(SHEET_NAMES_.orderItems);
  if (items) {
    const numberCol = columnOf_(items, 'Номер заказа');
    const cancelCol = columnOf_(items, 'Отменён');
    if (numberCol && cancelCol) {
      const rows = columnValues_(items, numberCol);
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]).trim() === orderNo) items.getRange(i + 1, cancelCol).setValue(true);
      }
    }
  }
  return notify;
}

// Проверка приёма заказа и уведомлений без сайта. Заказ создаётся по-настоящему (номер, строки в таблице,
// сообщение в Telegram), потом сразу помечается «Отменён» и в «Самое популярное» не попадает.
function menuTestOrder() {
  logNow_('info', 'Меню: тестовый заказ', '');
  try {
    const catalog = getCatalog_(true);
    const product = catalog.products.filter(function (p) { return p.stock !== 'out' && !p.adult; })[0];
    if (!product) {
      showAlert_('Тестовый заказ', ['В каталоге нет доступных товаров без отметки 18+.', 'Заполните лист «Товары» и повторите.']);
      return;
    }
    const result = handleOrder_({
      action: 'order',
      clientOrderId: 'menu-test-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
      phone: '+84 000 000 000',
      messenger: 'call',
      name: 'ТЕСТ',
      room: '',
      comment: 'Тестовый заказ из меню таблицы: обрабатывать не нужно',
      adultConfirmed: false,
      items: [{ id: product.id, qty: Math.max(product.min, product.step) }],
      website: '',
    });
    if (!result.ok) {
      showAlert_('Тестовый заказ', ['Заказ не прошёл: ' + (result.message || result.error) + ' (' + result.error + ').', result.fields && Object.keys(result.fields).length ? 'Поля: ' + JSON.stringify(result.fields) : '']);
      return;
    }
    const notify = markOrderCancelled_(result.orderNo);
    showAlert_('Тестовый заказ', [
      'Заказ ' + result.orderNo + ' создан и помечен «Отменён».',
      'Товар: ' + product.name + ', сумма ' + result.total + ' ₽.',
      'Уведомление: ' + (notify || 'нет данных') + '.',
      '',
      notify === 'ok' ? 'Сообщение должно прийти в Telegram получателям.' : 'Если уведомление не «ok», откройте лист «Ошибки».',
    ]);
  } catch (err) {
    const message = scrubSecrets_(errorText_(err), [PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN')]);
    logError_('Тестовый заказ', message);
    showAlert_('Тестовый заказ', ['Не получилось: ' + message]);
  }
  flushLog_();
}
