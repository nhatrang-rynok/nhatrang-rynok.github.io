// Журнал посещений: заходы, экраны, нажатия, корзина, заказ, ошибки. События копятся и уходят на сервер пачкой
// в лист «Журнал». Имя, телефон, комната и комментарий гостя сюда не попадают. Выключается галочкой log_events
// в «Настройках». В режиме заглушки (пустой API_URL) ничего не отправляется.
import { API_URL } from '../config.js';
import { readJson, writeJson } from './store.js';

const VISITOR_KEY = 'visitor.v1';
const SEND_DELAY_MS = 5000;   // сервер принимает до 15 пачек в минуту с одного посетителя
const MAX_QUEUE = 45;         // сервер принимает до 50 событий в пачке
const MAX_ERRORS = 5;         // ошибок за визит

export function randomId() {
  const bytes = new Uint8Array(12);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'v' + [...bytes].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

const qtyText = n => String(Math.round(n * 1000) / 1000).replace('.', ',');

// Что изменилось в корзине: массив коротких описаний. nameOf(id) — название товара (или пусто).
export function diffCart(prev, next, nameOf = () => '') {
  const label = id => nameOf(id) || id;
  const out = [];
  const removed = Object.keys(prev).filter(id => !(id in next));
  if (removed.length > 1 && Object.keys(next).length === 0) return [`корзина очищена (позиций: ${removed.length})`];
  for (const id of Object.keys(next)) {
    if (!(id in prev)) out.push(`добавлен ${label(id)}: ${qtyText(next[id])}`);
    else if (prev[id] !== next[id]) out.push(`${label(id)}: ${qtyText(prev[id])} → ${qtyText(next[id])}`);
  }
  for (const id of removed) out.push(`убран ${label(id)}`);
  return out;
}

// Короткая подпись нажатой кнопки или ссылки. Телефоны и ссылки в мессенджеры не записываем: только вид действия.
export function describeClick(node) {
  const target = node?.closest?.('button, a, summary, [role="button"]');
  if (!target) return null;
  const tag = target.tagName === 'A' ? 'ссылка' : 'кнопка';
  const label = (target.getAttribute('aria-label') || target.textContent || '').replace(/\+?\d[\d\s().-]{7,}\d/g, '[номер]').replace(/\s+/g, ' ').trim().slice(0, 60);
  let where = '';
  const href = target.getAttribute?.('href') || '';
  if (href.startsWith('#')) where = ` → ${href}`;
  else if (/^tel:/i.test(href)) where = ' → звонок';
  else if (/^https?:/i.test(href)) {
    try { where = ` → ${new URL(href).hostname}`; } catch { where = ' → внешняя ссылка'; }
  }
  return `${tag} «${label || target.id || '?'}»${where}`;
}

export function createTracker({ url, post, now = () => Date.now(), visitorId, device = () => ({}), schedule = setTimeout, cancel = clearTimeout }) {
  let queue = [];
  let timer = null;
  let enabled = Boolean(url);
  let screen = '';
  let errors = 0;

  function flush(keepalive = false) {
    cancel(timer);
    timer = null;
    if (!enabled || queue.length === 0) { queue = []; return; }
    const events = queue.splice(0, queue.length);
    post(url, JSON.stringify({ action: 'log', visitorId, now: now(), device: device(), events }), keepalive);
  }

  function track(kind, detail = '', order = '') {
    if (!enabled) return;
    if (kind === 'error' && ++errors > MAX_ERRORS) return;
    queue.push({ t: now(), k: kind, d: String(detail).slice(0, 200), s: screen, ...(order ? { o: order } : {}) });
    if (queue.length >= MAX_QUEUE) flush();
    else if (timer === null) timer = schedule(() => flush(), SEND_DELAY_MS);
  }

  return {
    track,
    flush,
    setScreen: name => { screen = name; },
    setEnabled: flag => { enabled = Boolean(url) && flag !== false; if (!enabled) queue = []; },
    isEnabled: () => enabled,
    get visitorId() { return visitorId; },
  };
}

// ----- Подключение к браузеру -----

function loadVisitorId() {
  const saved = readJson(VISITOR_KEY);
  if (typeof saved === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return { id: saved, returning: true };
  const id = randomId();
  writeJson(VISITOR_KEY, id);
  return { id, returning: false };
}

const visitor = loadVisitorId();

const tracker = createTracker({
  url: API_URL,
  visitorId: visitor.id,
  post: (url, body, keepalive) => {
    try {
      // text/plain, как и у заказа: так браузер не шлёт предварительный запрос, который Apps Script не принимает
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, keepalive }).catch(() => {});
    } catch { /* журнал не важнее сайта */ }
  },
  device: () => ({ ua: navigator.userAgent, w: window.innerWidth, h: window.innerHeight, lang: navigator.language }),
});

export const track = tracker.track;
export const setScreen = tracker.setScreen;
export const setTelemetryEnabled = tracker.setEnabled;
export const getVisitorId = () => tracker.visitorId;

let views = 0;

// Открыт экран: name — имя маршрута (home, category, product…), path — адрес после #, title — заголовок страницы
export function trackView(name, path, title) {
  views++;
  tracker.setScreen(name);
  tracker.track('view', title ? `${path} — ${title}` : path);
}

// Включает автоматический сбор: вход, нажатия, выбор, ошибки, выход. Вызывается один раз из app.js.
export function initTelemetry() {
  const ref = (() => {
    try { return document.referrer ? new URL(document.referrer).hostname : ''; } catch { return ''; }
  })();
  tracker.track('visit', `${visitor.returning ? 'повторный' : 'новый'} посетитель${ref && ref !== location.hostname ? `, из ${ref}` : ''}`);

  document.addEventListener('click', e => {
    const text = describeClick(e.target);
    if (text) tracker.track('click', text);
  }, { capture: true, passive: true });

  document.addEventListener('change', e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
    if (t instanceof HTMLInputElement && t.type !== 'radio' && t.type !== 'checkbox') return; // текст гостя не записываем
    const value = t instanceof HTMLInputElement && t.type === 'checkbox' ? (t.checked ? 'вкл' : 'выкл') : t.value;
    tracker.track('change', `${t.name || t.id || 'поле'}: ${value}`);
  }, { capture: true, passive: true });

  window.addEventListener('error', e => tracker.track('error', `${e.message || 'ошибка'} (${(e.filename || '').split('/').pop()}:${e.lineno || 0})`));
  window.addEventListener('unhandledrejection', e => tracker.track('error', `promise: ${String(e.reason?.message || e.reason || '').slice(0, 150)}`));

  let shownAt = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const sec = Math.round((Date.now() - shownAt) / 1000);
      tracker.track('session', `ушёл или свернул через ${sec} с, экранов открыто ${views}`);
      tracker.flush(true);
    } else {
      shownAt = Date.now();
      views = 0;
    }
  });
  window.addEventListener('pagehide', () => tracker.flush(true));
}
