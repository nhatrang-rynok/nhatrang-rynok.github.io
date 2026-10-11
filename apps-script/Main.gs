/**
 * Main.gs — точки входа веб-приложения (doGet, doPost), меню таблицы и запись ошибок.
 */

// Версия кода: меняется при каждом изменении файлов в apps-script/. Видна в ответе ?action=ping и в окне authorize,
// чтобы сразу понять, какой код сейчас работает.
const SCRIPT_VERSION_ = '2026-10-12.4';

const ERROR_LOG_KEEP_ = 500;     // сколько последних строк хранить в листе «Ошибки»
const ERROR_LOG_TRIM_AT_ = 600;  // когда строк станет больше, старые удаляются

// GET: ?action=ping — проверка, что развертывание живо; ?action=catalog — каталог для сайта
function doGet(e) {
  return withFlush_(function () {
    try {
      const action = e && e.parameter ? e.parameter.action : '';
      if (action === 'ping') {
        logEvent_('info', 'Проверка связи (ping)', 'версия кода ' + SCRIPT_VERSION_);
        return jsonOut_({ ok: true, time: new Date().toISOString(), version: SCRIPT_VERSION_ });
      }
      if (action === 'catalog') {
        const catalog = getCatalog_(false);
        logEvent_('info', 'Запрос каталога', 'отдан ' + catalogSource_ + ', товаров ' + (catalog.products ? catalog.products.length : 0));
        return jsonOut_(catalog);
      }
      if (action === 'orderStatus') return jsonOut_(handleOrderStatus_(e.parameter.id));
      logEvent_('warn', 'Неизвестный запрос', 'GET, action=' + cleanText_(action, 40));
      return jsonOut_({ ok: false, error: 'UNKNOWN_ACTION', message: 'Неизвестное действие' });
    } catch (err) {
      logError_('doGet', errorText_(err));
      return jsonOut_({ ok: false, error: 'SERVER', message: 'Ошибка сервера' });
    }
  });
}

const MAX_POST_BYTES_ = 30000;

// POST: заказ или пакет событий журнала с сайта. Тело — JSON в text/plain (так браузер не шлёт предварительный запрос).
function doPost(e) {
  return withFlush_(function () {
    try {
      const raw = e && e.postData ? String(e.postData.contents || '') : '';
      if (raw.length === 0 || raw.length > MAX_POST_BYTES_) {
        logEvent_('warn', 'Неверный запрос', 'POST: пустой или слишком большой (' + raw.length + ' знаков)');
        return jsonOut_({ ok: false, error: 'VALIDATION', message: 'Неверный запрос', fields: {}, items: [] });
      }
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch (err) { /* не JSON */ }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        logEvent_('warn', 'Неверный запрос', 'POST: не JSON');
        return jsonOut_({ ok: false, error: 'VALIDATION', message: 'Неверный запрос', fields: {}, items: [] });
      }
      if (body.action === 'log') return jsonOut_(handleLogBatch_(body));
      if (body.action !== 'order') {
        logEvent_('warn', 'Неизвестный запрос', 'POST, action=' + cleanText_(body.action, 40));
        return jsonOut_({ ok: false, error: 'UNKNOWN_ACTION', message: 'Неизвестное действие' });
      }
      return jsonOut_(handleOrder_(body));
    } catch (err) {
      logError_('doPost', errorText_(err));
      return jsonOut_({ ok: false, error: 'SERVER', message: 'Ошибка сервера' });
    }
  });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorText_(err) {
  return err && err.message ? String(err.message) : String(err);
}

// Меню в таблице (на телефоне меню Apps Script недоступно: всё нужное Сане работает само)
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🛒 Рынок')
    .addItem('Обновить сайт сейчас', 'menuRefreshSite')
    .addItem('Проверить таблицу', 'menuCheckSheet')
    .addSeparator()
    .addItem('Отправить тестовое уведомление', 'testNotify')
    .addItem('Найти chat_id Telegram', 'findTelegramChatIds')
    .addItem('Создать тестовый заказ', 'menuTestOrder')
    .addSeparator()
    .addItem('Проверить разрешения', 'menuCheckPermissions')
    .addItem('Первоначальная настройка', 'setup')
    .addToUi();
}

// ----- Строки листов -----

// Значения колонки (все строки листа, начиная с первой)
function columnValues_(sheet, col) {
  return sheet.getRange(1, col, sheet.getMaxRows(), 1).getValues();
}

// Последняя заполненная строка колонки. Вместо getLastRow(): флажки в пустых строках хранят FALSE,
// и getLastRow() возвращал бы последнюю строку листа.
function lastRowInColumn_(sheet, col) {
  return col ? lastFilledRow_(columnValues_(sheet, col)) : 0;
}

// Если дописывать некуда, лист растёт (иначе запись за пределами листа падает с ошибкой)
function ensureRows_(sheet, lastRow) {
  const max = sheet.getMaxRows();
  if (lastRow > max) sheet.insertRowsAfter(max, lastRow - max + 100);
}

// ----- Лист «Ошибки» -----

function logError_(where, message) {
  logErrors_([[where, message]]);
}

// rows — [[где, что], ...]. Любая ошибка при записи не должна ломать вызывающий код.
// Время пишется с секундами, ошибки дублируются в лист «Журнал».
function logErrors_(rows) {
  if (!rows || !rows.length) return;
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES_.errors);
    if (!sheet) return;
    const now = new Date();
    const secrets = [PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN')];
    const values = rows.map(function (r) {
      return [now, sanitizeCell_(scrubSecrets_(String(r[0]), secrets).slice(0, 200)), sanitizeCell_(scrubSecrets_(String(r[1]), secrets).slice(0, 500))];
    });
    const first = lastRowInColumn_(sheet, columnOf_(sheet, 'Когда') || 1) + 1;
    ensureRows_(sheet, first + values.length - 1);
    sheet.getRange(first, 1, values.length, 3).setValues(values);
    sheet.getRange(first, 1, values.length, 1).setNumberFormat(DATE_FORMAT_);
    const last = first + values.length - 1;
    if (last > ERROR_LOG_TRIM_AT_) sheet.deleteRows(2, last - ERROR_LOG_KEEP_ - 1);
  } catch (err) {
    console.error('Не удалось записать в лист «Ошибки»: ' + errorText_(err));
  }
  rows.forEach(function (r) { logEvent_('error', String(r[0]).slice(0, 100), String(r[1]).slice(0, 400)); });
}
