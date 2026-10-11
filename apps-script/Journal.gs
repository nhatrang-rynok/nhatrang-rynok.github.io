/**
 * Journal.gs — лист «Журнал»: что происходит на сайте и на сервере (заходы, нажатия, заказы, уведомления, правки таблицы).
 * События копятся в памяти и записываются в таблицу одним пакетом в конце запроса: так сайт не тормозит.
 * Правила разбора пакетов с сайта лежат в Logic.gs (sanitizeClientBatch_, buildLogRows_).
 */

const LOG_LOCK_WAIT_MS_ = 5000;
const LOG_BUFFER_ = [];  // события этого запуска, ещё не записанные в таблицу

// Добавляет событие в очередь. Любая ошибка здесь не должна ломать вызывающий код.
// level: 'info' | 'warn' | 'error'; opts: { source, screen, visitor, order, device }
function logEvent_(level, event, details, opts) {
  try {
    const o = opts || {};
    LOG_BUFFER_.push({
      ms: Date.now(),
      level: level,
      source: o.source || 'Сервер',
      event: String(event),
      details: String(details == null ? '' : details),
      screen: o.screen || '',
      visitor: o.visitor || '',
      order: o.order || '',
      device: o.device || '',
    });
  } catch (err) { /* журнал не важнее самого действия */ }
}

// Записывает накопленные события в лист «Журнал». Возвращает, сколько строк записано.
function flushLog_() {
  if (LOG_BUFFER_.length === 0) return 0;
  // События с сайта приходят с прошлым временем: в таблицу кладём по порядку времени
  const entries = LOG_BUFFER_.splice(0, LOG_BUFFER_.length).sort(function (a, b) { return a.ms - b.ms; }).slice(-LOG_MAX_PER_FLUSH_);
  let locked = false;
  const lock = LockService.getScriptLock();
  try {
    locked = Boolean(lock.tryLock(LOG_LOCK_WAIT_MS_));
    if (!locked) {
      console.warn('Журнал: не удалось получить блокировку, событий потеряно: ' + entries.length);
      return 0;
    }
    const ss = getSpreadsheet_();
    let sheet = ss.getSheetByName(SHEET_NAMES_.log);
    if (!sheet) sheet = createLogSheet_(ss);
    const headers = readHeaderRow_(sheet);
    const secrets = [PropertiesService.getScriptProperties().getProperty(PROP_TELEGRAM_TOKEN_)];
    const rows = buildLogRows_(headers, entries).map(function (row) {
      return row.map(function (cell) {
        return typeof cell === 'string' ? sanitizeCell_(scrubSecrets_(cell, secrets)) : cell;
      });
    });
    const first = Math.max(sheet.getLastRow(), 1) + 1;
    ensureRows_(sheet, first + rows.length - 1);
    sheet.getRange(first, 1, rows.length, headers.length).setValues(rows);
    const timeColumn = headers.map(normalizeHeader_).indexOf(normalizeHeader_('Время')) + 1;
    if (timeColumn) sheet.getRange(first, timeColumn, rows.length, 1).setNumberFormat(DATE_FORMAT_);
    const last = first + rows.length - 1;
    if (last > LOG_TRIM_AT_) sheet.deleteRows(2, last - LOG_KEEP_ - 1);
    return rows.length;
  } catch (err) {
    console.error('Не удалось записать в лист «Журнал»: ' + errorText_(err));
    return 0;
  } finally {
    if (locked) {
      try { lock.releaseLock(); } catch (err) { /* блокировка уже снята */ }
    }
  }
}

// Лист создаётся сам, если «Первоначальную настройку» ещё не повторяли после обновления
function createLogSheet_(ss) {
  const report = { created: [], addedColumns: [], filled: [], removed: [] };
  const sheet = ensureSheet_(ss, SHEET_NAMES_.log, HEADERS_.log, report);
  applyLogFormat_(sheet);
  return sheet;
}

// Выполняет действие и в любом случае записывает накопленный журнал (для doGet, doPost и триггеров)
function withFlush_(fn) {
  try {
    return fn();
  } finally {
    flushLog_();
  }
}

// Записывает событие сразу (пункты меню и ручные запуски, где нет «конца запроса»)
function logNow_(level, event, details, opts) {
  logEvent_(level, event, details, opts);
  flushLog_();
}

// ===== Пакет событий с сайта =====

// body: { action: 'log', visitorId, now, device, events }. Ответ не важен сайту, но возвращаем итог для проверок.
function handleLogBatch_(body) {
  const catalog = getCatalog_(false);
  if (catalog.settings && catalog.settings.log_events === false) return { ok: true, logged: 0, disabled: true };

  const nowMs = Date.now();
  const batch = sanitizeClientBatch_(body, nowMs);
  if (!batch.ok) return { ok: false, error: 'VALIDATION', message: 'Неверный запрос', fields: {}, items: [] };

  // Защита от потока мусора: пакетов в минуту с одного посетителя и всего в час
  const cache = CacheService.getScriptCache();
  const visitorKey = 'lg_v_' + batch.visitor;
  const globalKey = 'lg_g_' + Math.floor(nowMs / LOG_GLOBAL_WINDOW_MS_);
  const visitorState = parseRateState_(cache.get(visitorKey), nowMs, LOG_VISITOR_WINDOW_MS_);
  const globalState = parseRateState_(cache.get(globalKey), nowMs, LOG_GLOBAL_WINDOW_MS_);
  if (visitorState.n >= LOG_VISITOR_LIMIT_ || globalState.n >= LOG_GLOBAL_LIMIT_) {
    return { ok: true, logged: 0, limited: true };
  }
  cache.put(visitorKey, serializeRateState_({ n: visitorState.n + 1, t0: visitorState.t0 }), rateTtlSeconds_(visitorState, nowMs, LOG_VISITOR_WINDOW_MS_));
  cache.put(globalKey, serializeRateState_({ n: globalState.n + 1, t0: globalState.t0 }), rateTtlSeconds_(globalState, nowMs, LOG_GLOBAL_WINDOW_MS_));

  batch.entries.forEach(function (entry) { LOG_BUFFER_.push(entry); });
  return { ok: true, logged: batch.entries.length };
}
