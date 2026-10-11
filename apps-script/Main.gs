/**
 * Main.gs — точки входа веб-приложения (doGet, doPost), меню таблицы и запись ошибок.
 */

const ERROR_LOG_KEEP_ = 500;     // сколько последних строк хранить в листе «Ошибки»
const ERROR_LOG_TRIM_AT_ = 600;  // когда строк станет больше, старые удаляются

// GET: ?action=ping — проверка, что развертывание живо; ?action=catalog — каталог для сайта
function doGet(e) {
  try {
    const action = e && e.parameter ? e.parameter.action : '';
    if (action === 'ping') return jsonOut_({ ok: true, time: new Date().toISOString() });
    if (action === 'catalog') return jsonOut_(getCatalog_(false));
    return jsonOut_({ ok: false, error: 'UNKNOWN_ACTION', message: 'Неизвестное действие' });
  } catch (err) {
    logError_('doGet', errorText_(err));
    return jsonOut_({ ok: false, error: 'SERVER', message: 'Ошибка сервера' });
  }
}

// POST: приём заказов появится в задаче T2.4. Пока честно отвечаем, что заказы не принимаются.
function doPost(e) {
  return jsonOut_({ ok: false, error: 'SERVER', message: 'Приём заказов ещё не подключён' });
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
    .addItem('Первоначальная настройка', 'setup')
    .addToUi();
}

// ----- Лист «Ошибки» -----

function logError_(where, message) {
  logErrors_([[where, message]]);
}

// rows — [[где, что], ...]. Любая ошибка при записи не должна ломать вызывающий код.
function logErrors_(rows) {
  if (!rows || !rows.length) return;
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEET_NAMES_.errors);
    if (!sheet) return;
    const now = new Date();
    const values = rows.map(function (r) {
      return [now, sanitizeCell_(String(r[0]).slice(0, 200)), sanitizeCell_(String(r[1]).slice(0, 500))];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, 3).setValues(values);
    const last = sheet.getLastRow();
    if (last > ERROR_LOG_TRIM_AT_) sheet.deleteRows(2, last - ERROR_LOG_KEEP_ - 1);
  } catch (err) {
    console.error('Не удалось записать в лист «Ошибки»: ' + errorText_(err));
  }
}
