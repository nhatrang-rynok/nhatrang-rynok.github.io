/**
 * Notify.gs — уведомления оператору: Telegram-бот, запасной канал — письмо.
 * Токен бота и chat_id хранятся только в свойствах скрипта (⚙️ → «Свойства скрипта»).
 */

const TELEGRAM_API_ = 'https://api.telegram.org/bot';
const PROP_TELEGRAM_TOKEN_ = 'TELEGRAM_BOT_TOKEN';
const PROP_TELEGRAM_CHATS_ = 'TELEGRAM_CHAT_IDS';
const PROP_ALERT_EMAIL_ = 'ALERT_EMAIL';

function getNotifyConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    token: String(props.getProperty(PROP_TELEGRAM_TOKEN_) || '').trim(),
    chatIds: parseChatIds_(props.getProperty(PROP_TELEGRAM_CHATS_)),
    email: String(props.getProperty(PROP_ALERT_EMAIL_) || '').trim(),
  };
}

function safeSheetUrl_() {
  try {
    return getSpreadsheet_().getUrl();
  } catch (err) {
    return '';
  }
}

// Один запрос sendMessage. Возвращает { ok, error }; исключения и токен наружу не выпускает.
function sendTelegram_(token, payload) {
  try {
    const response = UrlFetchApp.fetch(TELEGRAM_API_ + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    let data = null;
    try {
      data = JSON.parse(response.getContentText());
    } catch (err) { /* ответ не JSON */ }
    if (data && data.ok === true) return { ok: true, error: '' };
    return { ok: false, error: scrubSecrets_((data && data.description) || 'HTTP ' + response.getResponseCode(), [token]) };
  } catch (err) {
    const text = errorText_(err);
    return { ok: false, error: scrubSecrets_(text, [token]) + permissionHint_(text) };
  }
}

function sendMailFallback_(to, subject, body) {
  try {
    MailApp.sendEmail(to, subject, body);
    return { ok: true, error: '' };
  } catch (err) {
    const text = errorText_(err);
    return { ok: false, error: text + permissionHint_(text) };
  }
}

// Сообщает оператору о заказе. Возвращает текст для колонки «Уведомление».
// Сначала Telegram (всем chat_id), если ни одно сообщение не дошло — письмо на ALERT_EMAIL.
function notifyOrder_(order, orderNo) {
  const config = getNotifyConfig_();
  const sheetUrl = safeSheetUrl_();
  const telegramConfigured = Boolean(config.token && config.chatIds.length);

  const results = telegramConfigured ? config.chatIds.map(function (chatId) {
    const r = sendTelegram_(config.token, telegramPayload_(order, orderNo, chatId, sheetUrl));
    return { chatId: chatId, ok: r.ok, error: r.error };
  }) : [];
  results.filter(function (r) { return !r.ok; }).forEach(function (r) {
    logError_('Telegram, заказ ' + orderNo, 'chat_id ' + r.chatId + ': ' + r.error);
  });

  let email = null;
  if (!results.some(function (r) { return r.ok; })) {
    if (config.email) {
      const text = buildOrderText_(order, orderNo, false) + (sheetUrl ? '\n\nТаблица: ' + sheetUrl : '');
      const sent = sendMailFallback_(config.email, 'Заказ ' + orderNo + ': Telegram не сработал', text);
      email = { attempted: true, ok: sent.ok, error: sent.error };
      if (!sent.ok) logError_('Письмо, заказ ' + orderNo, sent.error);
    } else {
      email = { attempted: false };
      if (!telegramConfigured) logError_('Уведомления', 'Заказ ' + orderNo + ': не настроены ни Telegram, ни почта. Задайте свойства скрипта TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS, ALERT_EMAIL.');
    }
  }
  return buildNotifyStatus_({ telegramConfigured: telegramConfigured, results: results, email: email });
}

// ===== Пункты меню =====

function showAlert_(title, lines) {
  const ui = SpreadsheetApp.getUi();
  ui.alert(title, lines.join('\n'), ui.ButtonSet.OK);
}

// «🛒 Рынок → Отправить тестовое уведомление»
function testNotify() {
  const config = getNotifyConfig_();
  if (!config.token) {
    showAlert_('Тестовое уведомление', ['Не задан токен бота.', '', 'Откройте Расширения → Apps Script → ⚙️ «Настройки проекта» → «Свойства скрипта» и добавьте TELEGRAM_BOT_TOKEN.']);
    return;
  }
  if (!config.chatIds.length) {
    showAlert_('Тестовое уведомление', ['Не задан TELEGRAM_CHAT_IDS.', '', 'Пусть получатель откроет бота в Telegram и нажмёт «Старт», затем выберите «🛒 Рынок → Найти chat_id Telegram».']);
    return;
  }
  const lines = config.chatIds.map(function (chatId) {
    const r = sendTelegram_(config.token, { chat_id: chatId, text: '✅ Проверка связи: уведомления о заказах работают.', disable_web_page_preview: true });
    return (r.ok ? '✅ ' : '❌ ') + chatId + (r.ok ? ': сообщение отправлено' : ': ' + r.error);
  });
  if (config.email) lines.push('', 'Запасная почта: ' + config.email);
  showAlert_('Тестовое уведомление', lines);
}

// «🛒 Рынок → Найти chat_id Telegram»: показывает, кто писал боту, и может сразу записать их id в настройки.
function findTelegramChatIds() {
  const config = getNotifyConfig_();
  if (!config.token) {
    showAlert_('chat_id Telegram', ['Не задан токен бота.', '', 'Добавьте TELEGRAM_BOT_TOKEN в «Свойства скрипта».']);
    return;
  }
  let data = null;
  let failure = '';
  try {
    const response = UrlFetchApp.fetch(TELEGRAM_API_ + config.token + '/getUpdates', { muteHttpExceptions: true });
    data = JSON.parse(response.getContentText());
    if (!data.ok) failure = data.description || 'HTTP ' + response.getResponseCode();
  } catch (err) {
    const text = errorText_(err);
    failure = scrubSecrets_(text, [config.token]) + permissionHint_(text);
  }
  if (failure) {
    showAlert_('chat_id Telegram', ['Telegram не ответил: ' + failure]);
    return;
  }
  const chats = extractChatsFromUpdates_(data);
  if (!chats.length) {
    showAlert_('chat_id Telegram', ['Бот пока никого не видит.', '', 'Пусть получатель откроет бота в Telegram, нажмёт «Старт» (или напишет любое сообщение) и затем повторите. Telegram хранит такие сообщения около суток.']);
    return;
  }
  const lines = ['Боту писали:'];
  chats.forEach(function (c) { lines.push('• ' + c.label + ' — ' + c.id); });
  lines.push('', 'Записать все эти chat_id в TELEGRAM_CHAT_IDS? Тогда заказы будут приходить всем перечисленным.');
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert('chat_id Telegram', lines.join('\n'), ui.ButtonSet.YES_NO);
  if (answer === ui.Button.YES) {
    PropertiesService.getScriptProperties().setProperty(PROP_TELEGRAM_CHATS_, chats.map(function (c) { return c.id; }).join(','));
    getSpreadsheet_().toast('Сохранено. Проверьте: «🛒 Рынок → Отправить тестовое уведомление».', 'Готово', 8);
  }
}

// ===== Разрешения =====

// Запускается вручную из редактора (выбрать функцию → «Выполнить»). При первом запуске после обновления
// манифеста Google показывает окно с разрешениями; меню таблицы и веб-приложение такое окно не показывают.
// Затем функция проверяет, что всё работает, и пишет итог в журнал и (если таблица открыта) окном.
function authorize() {
  const lines = ['Версия кода: ' + SCRIPT_VERSION_];
  const check = function (label, fn) {
    try {
      lines.push('✅ ' + label + ': ' + fn());
    } catch (err) {
      lines.push('❌ ' + label + ': ' + errorText_(err));
    }
  };
  check('Таблица', function () { return getSpreadsheet_().getName(); });
  check('Запросы в интернет (Telegram)', function () {
    return 'HTTP ' + UrlFetchApp.fetch('https://api.telegram.org/', { muteHttpExceptions: true }).getResponseCode();
  });
  check('Почта', function () { return 'можно отправить ещё ' + MailApp.getRemainingDailyQuota() + ' писем сегодня'; });
  check('Триггеры', function () { return 'установлено ' + ScriptApp.getProjectTriggers().length; });
  const config = getNotifyConfig_();
  lines.push((config.token ? '✅' : '❌') + ' Свойство TELEGRAM_BOT_TOKEN: ' + (config.token ? 'задано' : 'не задано'));
  lines.push((config.chatIds.length ? '✅' : '❌') + ' Свойство TELEGRAM_CHAT_IDS: ' + (config.chatIds.length ? 'получателей ' + config.chatIds.length : 'пусто (найдите через «🛒 Рынок → Найти chat_id Telegram»)'));
  lines.push((config.email ? '✅' : '❌') + ' Свойство ALERT_EMAIL: ' + (config.email ? 'задано' : 'не задано'));
  console.log(lines.join('\n'));
  try {
    showAlert_('Проверка разрешений', lines);
  } catch (err) { /* таблица не открыта: итог остался в журнале */ }
  return lines;
}
