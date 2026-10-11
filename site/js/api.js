// Загрузка каталога: сначала кэш браузера, потом сеть. Пустой API_URL — режим заглушки.
import { API_URL } from '../config.js';
import { readCatalogCache, writeCatalogCache } from './store.js';
import { getVisitorId, track } from './telemetry.js';

const FETCH_TIMEOUT_MS = 15000;
const SAMPLE_URL = 'data/catalog.sample.json';

export const isMockMode = !API_URL;

// status: 'loading' (данных ещё нет) | 'ready' | 'error' (данных нет и загрузить не вышло)
// stale — показан кэш старше 7 дней, свежие данные ещё грузятся.
export const catalogState = { status: 'loading', data: null, stale: false, refreshing: false };

const listeners = new Set();

export function subscribeCatalog(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of [...listeners]) fn();
}

function isValidCatalog(c) {
  return Boolean(c) && c.ok === true && Array.isArray(c.products) && Array.isArray(c.categories)
    && c.settings != null && typeof c.settings === 'object';
}

// В «version» и «generatedAt» есть время сборки, они меняются при каждой пересборке на сервере
// (раз в 5 минут), даже если данные те же. Поэтому сравниваем только содержимое.
const signature = c => JSON.stringify({ ...c, generatedAt: null, version: null });

async function fetchCatalog() {
  const url = isMockMode ? SAMPLE_URL : `${API_URL}?action=catalog`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // К настоящему серверу запрос без лишних параметров: служебные заголовки кэша могли бы вызвать
    // предварительный CORS-запрос, а Apps Script на него не отвечает. Файл заглушки перечитываем всегда.
    const options = isMockMode ? { signal: controller.signal, cache: 'no-cache' } : { signal: controller.signal };
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!isValidCatalog(data)) throw new Error('Неверный ответ сервера');
    return normalizeCatalog(data);
  } finally {
    clearTimeout(timer);
  }
}

// Страхуемся от пропущенных полей: сайт не должен падать из-за одной кривой строки.
function normalizeCatalog(c) {
  return {
    ...c,
    popular: Array.isArray(c.popular) ? c.popular : [],
    products: c.products.map(p => ({
      short: '', desc: '', img: '', warn: '', src: '', adult: false, stock: 'in', rel: [], sort: 0, step: 1, min: 0,
      ...p,
      rel: Array.isArray(p.rel) ? p.rel : [],
    })),
  };
}

let inFlight = null;

export function loadCatalog() {
  if (inFlight) return inFlight;
  const cached = catalogState.data ? null : readCatalogCache();
  if (cached) {
    catalogState.data = normalizeCatalog(cached.data);
    catalogState.status = 'ready';
    catalogState.stale = cached.stale;
  }
  catalogState.refreshing = true;
  notify();

  // Перерисовываем экран только если что-то реально изменилось, чтобы страница не мигала.
  const wasStale = catalogState.stale;
  const statusBefore = catalogState.status;
  let changed = false;

  const started = Date.now();
  inFlight = fetchCatalog()
    .then(fresh => {
      track('catalog', `загружен за ${Date.now() - started} мс, товаров ${fresh.products.length}${cached ? ', до этого показан кэш' : ''}`);
      changed = !catalogState.data || signature(fresh) !== signature(catalogState.data);
      if (changed) catalogState.data = fresh;
      catalogState.status = 'ready';
      writeCatalogCache(fresh);
    })
    .catch(err => {
      track('catalog', `не загрузился: ${err?.name === 'AbortError' ? 'таймаут' : err?.message || 'ошибка'}; ${catalogState.data ? 'показан кэш' : 'кэша нет'}`);
      // Есть кэш — продолжаем на нём. Нет — показываем экран ошибки.
      if (!catalogState.data) catalogState.status = 'error';
    })
    .then(() => {
      catalogState.stale = false;
      catalogState.refreshing = false;
      inFlight = null;
      if (changed || wasStale || catalogState.status !== statusBefore) notify();
    });
  return inFlight;
}

export function retryCatalog() {
  if (catalogState.status === 'error') catalogState.status = 'loading';
  return loadCatalog();
}

// --- Отправка заказа ---
// Ответ всегда объект {ok: true, orderNo, ...} или {ok: false, error, message?, fields?, items?}.
// Сетевая ошибка и таймаут — {ok: false, error: 'SERVER', network: true}.

const ORDER_TIMEOUT_MS = 15000;

export async function sendOrder(payload) {
  if (isMockMode) return mockSendOrder(payload);
  track('order', `отправка заказа: позиций ${payload.items.length}, сумма ≈ ${payload.clientTotal} ₽`);
  const started = Date.now();
  let result = await postOrder(payload);
  if (!result.ok && result.network) {
    // На некоторых телефонах ответ Apps Script не доходит до страницы, хотя заказ уже записан: спрашиваем у сервера отдельно
    track('order', `ответ не получен (${result.reason}) через ${Date.now() - started} мс; ${connectionInfo()}; проверяю, принят ли заказ`);
    const recovered = await checkOrderStatus(payload.clientOrderId);
    if (recovered) result = recovered;
  }
  track('order', result.ok ? `заказ принят${result.duplicate ? ' (повтор, дубль не создан)' : ''}${result.recovered ? ' (подтверждён отдельной проверкой)' : ''}` : `заказ не принят: ${result.error}${result.network ? ' (нет связи)' : ''}`,
    result.ok ? String(result.orderNo || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 12) : '');
  return result;
}

function connectionInfo() {
  const c = globalThis.navigator?.connection;
  return `онлайн: ${globalThis.navigator?.onLine}${c ? `, сеть: ${c.effectiveType || '?'}${c.saveData ? ', экономия трафика' : ''}` : ''}`;
}

async function postOrder(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORDER_TIMEOUT_MS);
  try {
    // text/plain, а не application/json: так браузер не шлёт предварительный запрос, который Apps Script не принимает
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, visitorId: getVisitorId() }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (data && typeof data.ok === 'boolean') return data;
    return { ok: false, error: 'SERVER' };
  } catch (err) {
    return { ok: false, error: 'SERVER', network: true, reason: `${err?.name || 'Error'}: ${String(err?.message || '').slice(0, 60)}` };
  } finally {
    clearTimeout(timer);
  }
}

// Два вопроса с паузой: сервер мог ещё не закончить запись. Возвращает ответ «принят» или null.
const STATUS_DELAYS_MS = [0, 2000];

async function checkOrderStatus(clientOrderId) {
  for (const delay of STATUS_DELAYS_MS) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${API_URL}?action=orderStatus&id=${encodeURIComponent(clientOrderId)}`, { signal: controller.signal });
      const data = await res.json();
      if (data?.ok === true && data.found === true && data.orderNo) return { ok: true, orderNo: data.orderNo, total: data.total, duplicate: false, recovered: true };
    } catch { /* связи нет и для этого вопроса */ } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// Режим заглушки: заказ никуда не уходит. Сценарии ошибок включаются адресом: ?mock=error|paused|rate|unavailable|validation
async function mockSendOrder(payload) {
  await new Promise(resolve => setTimeout(resolve, 700));
  const scenario = new URLSearchParams(globalThis.location?.search).get('mock');
  switch (scenario) {
    case 'error': return { ok: false, error: 'SERVER', network: true };
    case 'paused': return { ok: false, error: 'ORDERS_PAUSED', message: 'Заказы сейчас не принимаются' };
    case 'rate': return { ok: false, error: 'RATE_LIMIT', message: 'Слишком много заказов' };
    case 'unavailable': return { ok: false, error: 'ITEM_UNAVAILABLE', message: 'Некоторые товары сейчас недоступны', items: [payload.items[0]?.id] };
    case 'validation': return { ok: false, error: 'VALIDATION', message: 'Проверьте данные', fields: { phone: 'Проверьте номер' } };
    default: return { ok: true, orderNo: 'TEST-0001', total: payload.clientTotal, duplicate: false };
  }
}
