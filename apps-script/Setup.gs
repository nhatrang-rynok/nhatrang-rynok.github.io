/**
 * Setup.gs — первоначальная настройка таблицы (листы, заголовки, списки, флажки, триггеры)
 * и реакция на правки таблицы. Все действия можно запускать повторно: ничего не дублируется,
 * введённые данные не стираются, колонки можно переставлять.
 */

const HEADER_COLOR_ = '#E3F1E8';
const TABLE_TIMEZONE_ = 'Asia/Ho_Chi_Minh';
const DATE_FORMAT_ = 'yyyy-mm-dd hh:mm:ss';
const CATEGORY_RANGE_ROWS_ = 100;
const HEADER_PROTECTION_NOTE_ = 'Заголовки колонок (не переименовывать)';

// Порядок листов в таблице
const SHEET_ORDER_ = ['products', 'categories', 'settings', 'orders', 'orderItems', 'errors', 'log'];

// Свойства скрипта, которые владелец задаёт сам (значения здесь не хранятся)
const OWNER_PROPERTIES_ = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_IDS', 'ALERT_EMAIL'];

// ===== Первоначальная настройка =====

function setup() {
  logNow_('info', 'Меню: первоначальная настройка', '');
  const ss = getSpreadsheet_();
  const report = { created: [], addedColumns: [], filled: [], removed: [] };

  ss.setSpreadsheetTimeZone(TABLE_TIMEZONE_);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  const sheets = {};
  SHEET_ORDER_.forEach(function (key, i) {
    sheets[key] = ensureSheet_(ss, SHEET_NAMES_[key], HEADERS_[key], report);
    ss.setActiveSheet(sheets[key]);
    ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(sheets.products);
  removeEmptyDefaultSheets_(ss, report);

  fillCategories_(sheets.categories, report);
  fillSettings_(sheets.settings, report);

  applyProductsFormat_(ss, sheets.products);
  applyCategoriesFormat_(sheets.categories);
  applySettingsFormat_(sheets.settings);
  applyOrdersFormat_(sheets.orders);
  applyOrderItemsFormat_(sheets.orderItems);
  applyErrorsFormat_(sheets.errors);
  applyLogFormat_(sheets.log);
  SHEET_ORDER_.forEach(function (key) { protectHeader_(sheets[key]); });

  installTriggers_(ss);
  clearCatalogCache();

  logNow_('info', 'Настройка завершена', 'создано листов ' + report.created.length + ', добавлено колонок ' + report.addedColumns.length);
  showSetupSummary_(report);
  return report;
}

// Находит лист или создаёт его; дописывает недостающие заголовки в конец (существующие колонки не трогает).
function ensureSheet_(ss, name, headers, report) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    report.created.push(name);
  }
  const existing = readHeaderRow_(sheet);
  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const have = {};
    existing.forEach(function (h) { have[normalizeHeader_(h)] = true; });
    const missing = headers.filter(function (h) { return !have[normalizeHeader_(h)]; });
    if (missing.length) {
      sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      report.addedColumns.push(name + ': ' + missing.join(', '));
    }
  }
  const lastColumn = Math.max(sheet.getLastColumn(), headers.length);
  sheet.getRange(1, 1, 1, lastColumn).setFontWeight('bold').setBackground(HEADER_COLOR_);
  sheet.setFrozenRows(1);
  return sheet;
}

// Заголовки первой строки без хвоста пустых ячеек
function readHeaderRow_(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) return [];
  const row = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  let n = row.length;
  while (n > 0 && row[n - 1] === '') n--;
  return row.slice(0, n);
}

// Номер колонки по заголовку (с 1) или 0
function columnOf_(sheet, header) {
  const key = normalizeHeader_(header);
  const row = readHeaderRow_(sheet);
  for (let i = 0; i < row.length; i++) {
    if (normalizeHeader_(row[i]) === key) return i + 1;
  }
  return 0;
}

// Пустой лист по умолчанию («Лист1», «Sheet1») после создания своих листов не нужен
function removeEmptyDefaultSheets_(ss, report) {
  ['Лист1', 'Sheet1'].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (sheet && ss.getSheets().length > 1 && sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
      ss.deleteSheet(sheet);
      report.removed.push(name);
    }
  });
}

// ----- Начальные данные -----

function fillCategories_(sheet, report) {
  if (lastRowInColumn_(sheet, columnOf_(sheet, 'ID')) > 1) return; // уже есть данные — не трогаем
  const headers = readHeaderRow_(sheet);
  const source = HEADERS_.categories;
  const rows = INITIAL_CATEGORY_ROWS_.map(function (row) {
    return headers.map(function (h) {
      const i = source.map(normalizeHeader_).indexOf(normalizeHeader_(h));
      return i === -1 ? '' : row[i];
    });
  });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  report.filled.push(SHEET_NAMES_.categories + ': ' + rows.length + ' категорий (включены «Фрукты» и «Ром и алкоголь»)');
}

// Добавляет только недостающие настройки; значения, которые уже есть, не перезаписываются
function fillSettings_(sheet, report) {
  const headers = readHeaderRow_(sheet);
  const keyCol = columnOf_(sheet, 'Ключ');
  const have = {};
  const lastKeyRow = lastRowInColumn_(sheet, keyCol);
  if (lastKeyRow > 1) {
    sheet.getRange(2, keyCol, lastKeyRow - 1, 1).getValues().forEach(function (r) {
      have[String(r[0]).trim()] = true;
    });
  }
  const source = HEADERS_.settings.map(normalizeHeader_);
  const rows = initialSettingRows_().filter(function (r) { return !have[r[0]]; }).map(function (row) {
    return headers.map(function (h) {
      const i = source.indexOf(normalizeHeader_(h));
      return i === -1 ? '' : row[i];
    });
  });
  if (!rows.length) return;
  sheet.getRange(Math.max(lastKeyRow, 1) + 1, 1, rows.length, headers.length).setValues(rows);
  report.filled.push(SHEET_NAMES_.settings + ': добавлено настроек — ' + rows.length);
}

// ----- Оформление и проверки -----

// Колонка целиком (кроме заголовка) по названию заголовка; null, если такой колонки нет
function dataRange_(sheet, header) {
  const col = columnOf_(sheet, header);
  if (!col) return null;
  return sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1);
}

function setCheckboxes_(sheet, header) {
  const range = dataRange_(sheet, header);
  if (range) range.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
}

function setDropdown_(sheet, header, values) {
  const range = dataRange_(sheet, header);
  if (range) {
    range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build());
  }
}

// Формат даты с секундами. Если колонке задан тип данных (например, превращена в «таблицу»), Google запрещает менять
// формат: тогда оставляем как есть, а настройка идёт дальше.
function setDateFormat_(sheet, header) {
  const range = dataRange_(sheet, header);
  if (!range) return;
  try {
    range.setNumberFormat(DATE_FORMAT_);
    SpreadsheetApp.flush();
  } catch (err) {
    console.warn('Формат даты не применён к «' + sheet.getName() + ' / ' + header + '»: ' + errorText_(err));
  }
}

function setWidth_(sheet, header, pixels) {
  const col = columnOf_(sheet, header);
  if (col) sheet.setColumnWidth(col, pixels);
}

function applyProductsFormat_(ss, sheet) {
  ['Показывать', '18+', 'Хит'].forEach(function (h) { setCheckboxes_(sheet, h); });
  const categories = ss.getSheetByName(SHEET_NAMES_.categories);
  const idCol = columnOf_(categories, 'ID');
  const catRange = dataRange_(sheet, 'Категория');
  if (catRange && idCol) {
    const source = categories.getRange(2, idCol, CATEGORY_RANGE_ROWS_, 1);
    catRange.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(source, true).setAllowInvalid(false).build());
  }
  setDropdown_(sheet, 'Наличие', STOCK_LABELS_);
  setDateFormat_(sheet, 'Обновлено');
  setWidth_(sheet, 'ID', 80);
  setWidth_(sheet, 'Название', 200);
  setWidth_(sheet, 'Описание', 300);
  setWidth_(sheet, 'Предупреждения', 240);
}

function applyCategoriesFormat_(sheet) {
  setCheckboxes_(sheet, 'Показывать');
  setWidth_(sheet, 'Название', 180);
  setWidth_(sheet, 'Подпись', 320);
}

function applySettingsFormat_(sheet) {
  // Флажки «Принимаем заказы» и «Вести журнал» вместо слова TRUE
  const keyCol = columnOf_(sheet, 'Ключ');
  const valueCol = columnOf_(sheet, 'Значение');
  const lastKeyRow = lastRowInColumn_(sheet, keyCol);
  if (keyCol && valueCol && lastKeyRow > 1) {
    const keys = sheet.getRange(2, keyCol, lastKeyRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      const key = String(keys[i][0]).trim();
      if (key === 'orders_enabled' || key === 'log_events') {
        sheet.getRange(i + 2, valueCol).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
      }
    }
  }
  setWidth_(sheet, 'Ключ', 170);
  setWidth_(sheet, 'Значение', 260);
  setWidth_(sheet, 'Пояснение', 420);
}

function applyOrdersFormat_(sheet) {
  setDropdown_(sheet, 'Статус', ORDER_STATUSES_);
  setDropdown_(sheet, 'Связь', Object.keys(MESSENGER_LABELS_).map(function (k) { return MESSENGER_LABELS_[k]; }));
  setCheckboxes_(sheet, '18+ подтверждено');
  setDateFormat_(sheet, 'Создан');
  setWidth_(sheet, 'Состав', 360);
  setWidth_(sheet, 'Комментарий', 240);

  // Цвет строки зависит от статуса. Правила каждый раз заменяются целиком, поэтому не копятся.
  const statusCol = columnOf_(sheet, 'Статус');
  if (!statusCol) return;
  const letter = columnLetter_(statusCol);
  const area = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), Math.max(sheet.getLastColumn(), 1));
  const colors = { 'Новый': '#FFF4D6', 'Связались': '#DCEBFA', 'Закуплено': '#FCE4D0', 'Доставлено': '#DDF1E3' };
  const rules = Object.keys(colors).map(function (status) {
    return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + letter + '2="' + status + '"').setBackground(colors[status]).setRanges([area]).build();
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + letter + '2="Отменён"').setBackground('#EEEEEE').setFontColor('#777777').setStrikethrough(true).setRanges([area]).build());
  sheet.setConditionalFormatRules(rules);
}

function applyOrderItemsFormat_(sheet) {
  setCheckboxes_(sheet, 'Отменён');
  setDateFormat_(sheet, 'Создан');
}

function applyErrorsFormat_(sheet) {
  setDateFormat_(sheet, 'Когда');
  setWidth_(sheet, 'Когда', 150);
  setWidth_(sheet, 'Где', 220);
  setWidth_(sheet, 'Что', 520);
}

function applyLogFormat_(sheet) {
  setDateFormat_(sheet, 'Время');
  setWidth_(sheet, 'Время', 150);
  setWidth_(sheet, 'Уровень', 80);
  setWidth_(sheet, 'Источник', 80);
  setWidth_(sheet, 'Событие', 200);
  setWidth_(sheet, 'Подробности', 420);
  setWidth_(sheet, 'Экран', 110);
  setWidth_(sheet, 'Посетитель', 90);
  setWidth_(sheet, 'Заказ', 80);
  setWidth_(sheet, 'Устройство', 220);

  // Ошибки и предупреждения подсвечиваются. Правила каждый раз заменяются целиком.
  const levelCol = columnOf_(sheet, 'Уровень');
  if (!levelCol) return;
  const letter = columnLetter_(levelCol);
  const area = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), Math.max(sheet.getLastColumn(), 1));
  const rules = [
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + letter + '2="' + LOG_LEVELS_.error + '"').setBackground('#F8D7D3').setRanges([area]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + letter + '2="' + LOG_LEVELS_.warn + '"').setBackground('#FFF4D6').setRanges([area]).build(),
  ];
  sheet.setConditionalFormatRules(rules);
}

// 1 → A, 27 → AA
function columnLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Предупреждение при правке заголовков (но не запрет: владелец всё равно сможет)
function protectHeader_(sheet) {
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) {
    if (p.getDescription() === HEADER_PROTECTION_NOTE_) p.remove();
  });
  const protection = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).protect();
  protection.setDescription(HEADER_PROTECTION_NOTE_);
  protection.setWarningOnly(true);
}

// ----- Триггеры -----

// Устанавливаемый триггер на правки таблицы. Функция называется handleEdit, а не onEdit:
// иначе она запускалась бы дважды (и как простой, и как установленный триггер).
function installTriggers_(ss) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'handleEdit') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();
}

// Правка «Товаров», «Категорий» или «Настроек» → сбросить кэш каталога, чтобы сайт показал изменение сразу.
// На «Товарах» дополнительно проставляется дата в колонке «Обновлено».
function handleEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const name = sheet.getName();
    if (name === SHEET_NAMES_.log || name === SHEET_NAMES_.errors) return; // записи самого журнала не логируем
    const where = 'лист «' + name + '», ' + e.range.getA1Notation();
    if (name !== SHEET_NAMES_.products && name !== SHEET_NAMES_.categories && name !== SHEET_NAMES_.settings) {
      if (name === SHEET_NAMES_.orders) logEvent_('info', 'Правка таблицы', where + ' (заказы)');
      return;
    }
    clearCatalogCache();
    logEvent_('info', 'Правка таблицы', where + ': кэш каталога сброшен');
    if (name === SHEET_NAMES_.products) stampUpdated_(sheet, e.range);
  } catch (err) {
    logError_('handleEdit', errorText_(err));
  } finally {
    flushLog_();
  }
}

function stampUpdated_(sheet, range) {
  const col = columnOf_(sheet, 'Обновлено');
  const idCol = columnOf_(sheet, 'ID');
  if (!col || !idCol) return;
  if (range.getColumn() === col && range.getLastColumn() === col) return; // правили саму дату — не штампуем
  const first = Math.max(range.getRow(), 2);
  const last = Math.min(range.getLastRow(), sheet.getMaxRows());
  if (last < first) return;
  const count = last - first + 1;
  // Дата только у строк, где есть ID: пустые строки (например, после вставки диапазона) не штампуем
  const ids = sheet.getRange(first, idCol, count, 1).getValues();
  const stamps = sheet.getRange(first, col, count, 1).getValues();
  const now = new Date();
  const values = stamps.map(function (old, i) {
    return [String(ids[i][0]).trim() !== '' ? now : old[0]];
  });
  sheet.getRange(first, col, count, 1).setValues(values);
}

// ===== Пункты меню =====

function menuRefreshSite() {
  logNow_('info', 'Меню: обновить сайт', 'кэш каталога сброшен');
  clearCatalogCache();
  getSpreadsheet_().toast('Сайт покажет свежие данные при следующем открытии.', 'Готово', 5);
}

// Прогоняет те же проверки, что и сайт, и показывает проблемы таблицы
function menuCheckSheet() {
  logNow_('info', 'Меню: проверить таблицу', '');
  const ss = getSpreadsheet_();
  const result = assembleCatalog_({
    categoryValues: readSheetValues_(ss, SHEET_NAMES_.categories),
    productValues: readSheetValues_(ss, SHEET_NAMES_.products),
    settingValues: readSheetValues_(ss, SHEET_NAMES_.settings),
    orderItemValues: readSheetValues_(ss, SHEET_NAMES_.orderItems),
    nowMs: Date.now(),
  });
  const lines = [];
  if (result.errors.length === 0) {
    lines.push('Проблем не найдено.');
  } else {
    lines.push('Найдено проблем: ' + result.errors.length + '.');
    result.errors.slice(0, 20).forEach(function (e) { lines.push('• ' + e.where + ', строка ' + e.row + ': ' + e.message); });
    if (result.errors.length > 20) lines.push('…и ещё ' + (result.errors.length - 20));
  }
  lines.push('');
  lines.push('На сайте сейчас: товаров — ' + result.catalog.products.length + ', категорий — ' + result.catalog.categories.length + ', в «Самом популярном» — ' + result.catalog.popular.length + '.');
  SpreadsheetApp.getUi().alert('Проверка таблицы', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

// ===== Итог настройки =====

function showSetupSummary_(report) {
  const props = PropertiesService.getScriptProperties();
  const missing = OWNER_PROPERTIES_.filter(function (key) { return !props.getProperty(key); });
  const lines = [];
  lines.push(report.created.length ? 'Созданы листы: ' + report.created.join(', ') + '.' : 'Все листы уже были на месте.');
  if (report.removed.length) lines.push('Удалены пустые листы: ' + report.removed.join(', ') + '.');
  if (report.addedColumns.length) lines.push('Добавлены колонки: ' + report.addedColumns.join('; ') + '.');
  report.filled.forEach(function (text) { lines.push(text + '.'); });
  lines.push('Выпадающие списки, флажки и защита заголовков настроены. Триггер на правки таблицы установлен.');
  lines.push('');
  lines.push(missing.length
    ? 'Ещё не заданы свойства скрипта (понадобятся для уведомлений о заказах): ' + missing.join(', ') + '.'
    : 'Все свойства скрипта для уведомлений заданы.');
  try {
    SpreadsheetApp.getUi().alert('Настройка завершена', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    console.log(lines.join('\n')); // запуск не из таблицы: окна нет
  }
}
