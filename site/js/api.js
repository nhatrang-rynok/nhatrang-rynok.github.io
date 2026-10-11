// Загрузка каталога: сначала кэш браузера, потом сеть. Пустой API_URL — режим заглушки.
import { API_URL } from '../config.js';
import { readCatalogCache, writeCatalogCache } from './store.js';

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

// Версия и время сборки меняются сами по себе, поэтому сравниваем только содержимое.
const signature = c => JSON.stringify({ ...c, generatedAt: null });

async function fetchCatalog() {
  const url = isMockMode ? SAMPLE_URL : `${API_URL}?action=catalog`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
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

  inFlight = fetchCatalog()
    .then(fresh => {
      changed = !catalogState.data || signature(fresh) !== signature(catalogState.data);
      if (changed) catalogState.data = fresh;
      catalogState.status = 'ready';
      writeCatalogCache(fresh);
    })
    .catch(() => {
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
