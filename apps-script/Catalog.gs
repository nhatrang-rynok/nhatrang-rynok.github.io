/**
 * Catalog.gs — чтение таблицы, сборка каталога для сайта и кэш.
 * Правила разбора строк лежат в Logic.gs (assembleCatalog_), здесь только работа с сервисами Google.
 */

const CACHE_PREFIX_ = 'cat_v1';           // свежий каталог, живёт 5 минут
const CACHE_GOOD_PREFIX_ = 'cat_v1_good'; // «последний хороший» каталог, живёт 6 часов
const CACHE_TTL_S_ = 300;
const CACHE_GOOD_TTL_S_ = 21600;          // максимум для CacheService
// В кэше значение не больше 100 КБ, а кириллица в UTF-8 занимает 2–3 байта на символ: куски по 30 000 знаков с запасом.
const CACHE_CHUNK_SIZE_ = 30000;
const PROP_CATALOG_ERRORS_SIG_ = 'CATALOG_ERRORS_SIG';
const MAX_LOGGED_CATALOG_ERRORS_ = 30;

// Таблица, к которой привязан скрипт. В веб-приложении getActiveSpreadsheet() работает для привязанного скрипта.
function getSpreadsheet_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('Не найдена таблица: запустите «🛒 Рынок → Первоначальная настройка» из самой таблицы');
}

function readSheetValues_(ss, name) {
  const sheet = ss.getSheetByName(name);
  return sheet ? sheet.getDataRange().getValues() : [];
}

// ----- Кэш -----

function readCatalogCache_(prefix) {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(prefix + '_meta');
  if (!meta) return null;
  let parts;
  try {
    parts = JSON.parse(meta).parts;
  } catch (err) {
    return null;
  }
  if (!(parts > 0)) return null;
  const keys = [];
  for (let i = 0; i < parts; i++) keys.push(prefix + '_' + i);
  const got = cache.getAll(keys);
  let json = '';
  for (let i = 0; i < keys.length; i++) {
    if (got[keys[i]] == null) return null; // какого-то куска нет — кэш считаем пустым
    json += got[keys[i]];
  }
  return json;
}

function writeCatalogCache_(prefix, json, ttlSeconds) {
  const chunks = splitIntoChunks_(json, CACHE_CHUNK_SIZE_);
  const entries = {};
  chunks.forEach(function (chunk, i) { entries[prefix + '_' + i] = chunk; });
  entries[prefix + '_meta'] = JSON.stringify({ parts: chunks.length });
  CacheService.getScriptCache().putAll(entries, ttlSeconds);
}

// Сбрасывает свежий каталог: следующий запрос с сайта пересоберёт его из таблицы.
// Вызывается из меню, из handleEdit и после правок в таблице.
function clearCatalogCache() {
  CacheService.getScriptCache().removeAll([CACHE_PREFIX_ + '_meta']);
}

// ----- Сборка -----

// Каталог для сайта (объект по контракту docs/05-api.md). Берётся из кэша, если он есть.
function getCatalog_(forceRebuild) {
  if (!forceRebuild) {
    const cached = readCatalogCache_(CACHE_PREFIX_);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (err) { /* битый кэш — пересоберём */ }
    }
  }
  return rebuildCatalog_();
}

function rebuildCatalog_() {
  const ss = getSpreadsheet_();
  const nowMs = Date.now();
  const result = assembleCatalog_({
    categoryValues: readSheetValues_(ss, SHEET_NAMES_.categories),
    productValues: readSheetValues_(ss, SHEET_NAMES_.products),
    settingValues: readSheetValues_(ss, SHEET_NAMES_.settings),
    orderItemValues: readSheetValues_(ss, SHEET_NAMES_.orderItems),
    nowMs: nowMs,
  });
  reportCatalogErrors_(result.errors);

  // В таблице сломаны заголовки: лучше отдать прошлый хороший каталог, чем пустой
  if (result.fatal) {
    const good = readCatalogCache_(CACHE_GOOD_PREFIX_);
    if (good) {
      try {
        return JSON.parse(good);
      } catch (err) { /* битый — отдадим пустой */ }
    }
  }

  const content = JSON.stringify(result.catalog);
  const hash = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, content, Utilities.Charset.UTF_8)).slice(0, 6);
  const iso = new Date(nowMs).toISOString();
  const full = {
    ok: true,
    version: iso + '#' + hash,
    generatedAt: iso,
    settings: result.catalog.settings,
    categories: result.catalog.categories,
    products: result.catalog.products,
    popular: result.catalog.popular,
  };
  const json = JSON.stringify(full);
  writeCatalogCache_(CACHE_PREFIX_, json, CACHE_TTL_S_);
  if (!result.fatal) writeCatalogCache_(CACHE_GOOD_PREFIX_, json, CACHE_GOOD_TTL_S_);
  return full;
}

// Пишет проблемы таблицы в лист «Ошибки», но только когда набор проблем изменился:
// каталог пересобирается каждые 5 минут, и одно и то же сообщение не должно повторяться.
function reportCatalogErrors_(errors) {
  const props = PropertiesService.getScriptProperties();
  // В свойствах значение не больше 9 КБ, поэтому храним не весь список, а его отпечаток
  const signature = errors.length
    ? bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, errorsSignature_(errors), Utilities.Charset.UTF_8))
    : '';
  if (signature === (props.getProperty(PROP_CATALOG_ERRORS_SIG_) || '')) return;
  props.setProperty(PROP_CATALOG_ERRORS_SIG_, signature);
  const rows = errors.slice(0, MAX_LOGGED_CATALOG_ERRORS_).map(function (e) {
    return [e.where + ', строка ' + e.row, e.message];
  });
  if (errors.length > MAX_LOGGED_CATALOG_ERRORS_) {
    rows.push(['Каталог', '…и ещё проблем: ' + (errors.length - MAX_LOGGED_CATALOG_ERRORS_) + '. Исправьте первые, остальные появятся после этого.']);
  }
  logErrors_(rows);
}
