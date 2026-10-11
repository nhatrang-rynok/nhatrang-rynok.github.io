// Подставные сервисы Google для тестов .gs-файлов: таблица в памяти, кэш, свойства, триггеры и т. д.
// Реализованы только те методы, которыми пользуется код проекта; незнакомый метод — понятная ошибка.
import crypto from 'node:crypto';

const MAX_ROWS = 1000;

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getLastRow() { return this.row + this.rows - 1; }
  getLastColumn() { return this.col + this.cols - 1; }
  getValues() {
    this.sheet.ss.reads++;
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) line.push(this.sheet.get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getValue() { return this.sheet.get(this.row, this.col); }
  setValues(values) {
    if (values.length !== this.rows || values.some(v => v.length !== this.cols)) {
      throw new Error(`setValues: размеры не совпадают (диапазон ${this.rows}×${this.cols}, данные ${values.length}×${values[0]?.length})`);
    }
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  setFontWeight() { return this; }
  setFontColor() { return this; }
  setBackground() { return this; }
  setNumberFormat(format) { this.sheet.formats.push({ col: this.col, format }); return this; }
  // Как в настоящей таблице: проверка на тот же диапазон заменяет прежнюю
  setDataValidation(rule) {
    const same = v => v.row === this.row && v.col === this.col && v.rows === this.rows;
    this.sheet.validations = this.sheet.validations.filter(v => !same(v));
    this.sheet.validations.push({ row: this.row, col: this.col, rows: this.rows, rule });
    return this;
  }
  protect() {
    const protection = {
      range: this, description: '', warningOnly: false,
      setDescription(d) { this.description = d; return this; },
      getDescription() { return this.description; },
      setWarningOnly(v) { this.warningOnly = v; return this; },
      remove: () => { this.sheet.protections = this.sheet.protections.filter(p => p !== protection); },
    };
    this.sheet.protections.push(protection);
    return protection;
  }
}

class FakeSheet {
  constructor(ss, name) {
    Object.assign(this, { ss, name, grid: [], validations: [], formats: [], protections: [], rules: [], widths: {}, frozen: 0 });
  }
  getName() { return this.name; }
  get(r, c) { return this.grid[r - 1]?.[c - 1] ?? ''; }
  set(r, c, v) {
    while (this.grid.length < r) this.grid.push([]);
    const line = this.grid[r - 1];
    while (line.length < c) line.push('');
    line[c - 1] = v;
  }
  getLastRow() {
    for (let r = this.grid.length; r > 0; r--) if (this.grid[r - 1].some(v => v !== '' && v != null)) return r;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.grid.forEach(line => line.forEach((v, i) => { if (v !== '' && v != null) max = Math.max(max, i + 1); }));
    return max;
  }
  getMaxRows() { return MAX_ROWS; }
  getRange(row, col, rows = 1, cols = 1) { return new FakeRange(this, row, col, rows, cols); }
  getDataRange() {
    const rows = this.getLastRow();
    const cols = this.getLastColumn();
    return new FakeRange(this, 1, 1, Math.max(rows, 1), Math.max(cols, 1));
  }
  appendRow(values) { this.getRange(this.getLastRow() + 1, 1, 1, values.length).setValues([values]); }
  deleteRows(start, count) { this.grid.splice(start - 1, count); }
  setFrozenRows(n) { this.frozen = n; }
  setColumnWidth(col, px) { this.widths[col] = px; }
  getProtections() { return [...this.protections]; }
  setConditionalFormatRules(rules) { this.rules = rules; }
  // Удобство для тестов: значения листа без хвоста пустых строк
  values() { return this.grid.slice(0, this.getLastRow()).map(line => [...line]); }
}

class FakeSpreadsheet {
  constructor(sheetNames = ['Лист1']) {
    this.sheets = [];
    this.reads = 0;
    this.timeZone = '';
    this.toasts = [];
    this.active = null;
    sheetNames.forEach(n => this.insertSheet(n));
  }
  getId() { return 'FAKE_SPREADSHEET_ID'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/FAKE_SPREADSHEET_ID/edit'; }
  getSheets() { return [...this.sheets]; }
  getSheetByName(name) { return this.sheets.find(s => s.name === name) ?? null; }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error(`Лист с названием «${name}» уже существует`);
    const sheet = new FakeSheet(this, name);
    this.sheets.push(sheet);
    return sheet;
  }
  deleteSheet(sheet) { this.sheets = this.sheets.filter(s => s !== sheet); }
  setActiveSheet(sheet) { this.active = sheet; return sheet; }
  moveActiveSheet(position) {
    this.sheets = this.sheets.filter(s => s !== this.active);
    this.sheets.splice(position - 1, 0, this.active);
  }
  setSpreadsheetTimeZone(tz) { this.timeZone = tz; }
  toast(message, title) { this.toasts.push({ message, title }); }
  names() { return this.sheets.map(s => s.name); }
}

// Цепочка вызовов, которая просто запоминает, что у неё спрашивали (для data validation и условного форматирования)
function recorder(kind) {
  const calls = [];
  const proxy = new Proxy({}, {
    get(_, prop) {
      if (prop === 'build') return () => ({ kind, calls });
      return (...args) => { calls.push([prop, ...args]); return proxy; };
    },
  });
  return proxy;
}

export function createGoogle({ sheetNames } = {}) {
  const ss = new FakeSpreadsheet(sheetNames);
  const store = new Map();
  const props = new Map();
  const triggers = [];
  const alerts = [];
  const menus = [];
  const fetches = [];
  const mails = [];
  const state = {
    cachePuts: [], failCache: false, lockFails: false, locks: 0, mailFails: false, alertAnswer: 'OK',
    updates: { ok: true, result: [] },
    // По умолчанию Telegram отвечает «ок»; тест может подменить поведение: (url, options) => ответ
    fetchHandler: null,
  };
  const reply = (code, obj) => ({ getResponseCode: () => code, getContentText: () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) });

  const cache = {
    get: k => store.get(k) ?? null,
    getAll: keys => Object.fromEntries(keys.filter(k => store.has(k)).map(k => [k, store.get(k)])),
    putAll: (entries, ttl) => {
      for (const [k, v] of Object.entries(entries)) {
        if (Buffer.byteLength(v, 'utf8') > 100 * 1024) throw new Error(`Значение «${k}» больше 100 КБ`);
        store.set(k, v);
      }
      state.cachePuts.push({ keys: Object.keys(entries), ttl });
    },
    put: (key, value, ttl) => cache.putAll({ [key]: value }, ttl),
    removeAll: keys => keys.forEach(k => store.delete(k)),
  };

  const globals = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
      newDataValidation: () => recorder('validation'),
      newConditionalFormatRule: () => recorder('rule'),
      getUi: () => ({
        ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' },
        Button: { YES: 'YES', NO: 'NO', OK: 'OK' },
        alert: (title, message, buttons) => { alerts.push({ title, message, buttons }); return state.alertAnswer; },
        createMenu: title => {
          const menu = { title, items: [] };
          menus.push(menu);
          const chain = { addItem(label, fn) { menu.items.push([label, fn]); return chain; }, addSeparator() { menu.items.push(['---']); return chain; }, addToUi() { return chain; } };
          return chain;
        },
      }),
    },
    CacheService: { getScriptCache: () => cache },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { if (state.lockFails) throw new Error('Lock timeout'); state.locks++; },
        releaseLock: () => { state.locks--; },
      }),
    },
    UrlFetchApp: {
      fetch: (url, options = {}) => {
        fetches.push({ url, options, payload: options.payload ? JSON.parse(options.payload) : null });
        if (state.fetchHandler) return state.fetchHandler(url, options, reply);
        if (url.endsWith('/getUpdates')) return reply(200, state.updates);
        return reply(200, { ok: true, result: { message_id: 1 } });
      },
    },
    MailApp: {
      sendEmail: (to, subject, body) => {
        if (state.mailFails) throw new Error('Превышена суточная квота писем');
        mails.push({ to, subject, body });
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => props.get(k) ?? null,
        setProperty: (k, v) => props.set(k, String(v)),
        deleteProperty: k => props.delete(k),
      }),
    },
    ScriptApp: {
      getProjectTriggers: () => [...triggers],
      deleteTrigger: t => { const i = triggers.indexOf(t); if (i !== -1) triggers.splice(i, 1); },
      newTrigger: fn => {
        const spec = { fn };
        const chain = {
          forSpreadsheet() { return chain; },
          onEdit() { spec.event = 'onEdit'; return chain; },
          create() { const t = { getHandlerFunction: () => fn, spec }; triggers.push(t); return t; },
        };
        return chain;
      },
    },
    Utilities: {
      DigestAlgorithm: { MD5: 'MD5' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, text) => [...crypto.createHash('md5').update(text, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: text => ({ content: text, setMimeType(m) { this.mime = m; return this; }, getContent() { return this.content; } }),
    },
  };
  return { globals, ss, store, props, triggers, alerts, menus, state, fetches, mails, reply };
}
