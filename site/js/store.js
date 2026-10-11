// Корзина и кэш в localStorage. Любое обращение к хранилищу обёрнуто в try/catch:
// в приватном режиме или при заблокированных данных сайт продолжает работать, храня всё в памяти.

const CART_KEY = 'cart.v1';
const MAX_QTY = 100;

// Если localStorage недоступен или переполнен, значение живёт в памяти (до закрытия вкладки).
const memory = new Map();

function storageGet(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem(key, value);
      memory.delete(key);
      return;
    }
  } catch { /* хранилище недоступно или переполнено */ }
  memory.set(key, value);
}

export function readJson(key) {
  try {
    const raw = storageGet(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeJson(key, value) {
  storageSet(key, JSON.stringify(value));
}

// --- Количество ---

const round3 = n => Math.round(n * 1000) / 1000;

export function stepOf(product) {
  return product.step > 0 ? product.step : 1;
}

export function minOf(product) {
  return Math.max(product.min > 0 ? product.min : 0, stepOf(product));
}

// Следующее количество при нажатии «+» (dir = 1) или «−» (dir = -1). 0 — товар убран.
export function nextQty(product, current, dir) {
  const step = stepOf(product);
  const min = minOf(product);
  if (dir > 0) return current <= 0 ? min : Math.min(MAX_QTY, round3(current + step));
  const lower = round3(current - step);
  return lower < min ? 0 : lower;
}

// --- Корзина ---

let cart = null;
const listeners = new Set();

function loadCart() {
  const stored = readJson(CART_KEY);
  const clean = {};
  if (stored && typeof stored === 'object') {
    for (const [id, qty] of Object.entries(stored)) {
      if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0 && qty <= MAX_QTY) clean[id] = qty;
    }
  }
  return clean;
}

function current() {
  if (cart === null) cart = loadCart();
  return cart;
}

function commit(next) {
  cart = next;
  writeJson(CART_KEY, cart);
  for (const fn of [...listeners]) fn();
}

export function getCart() {
  return { ...current() };
}

export function getQty(id) {
  return current()[id] || 0;
}

export function setQty(id, qty) {
  const next = { ...current() };
  const value = Math.min(MAX_QTY, round3(qty));
  if (value > 0) next[id] = value;
  else delete next[id];
  commit(next);
}

// Нажатие «+» / «−» для товара; возвращает новое количество.
export function changeQty(product, dir) {
  const qty = nextQty(product, getQty(product.id), dir);
  setQty(product.id, qty);
  return qty;
}

export function removeItem(id) {
  setQty(id, 0);
}

export function clearCart() {
  commit({});
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Другая вкладка изменила корзину
globalThis.addEventListener?.('storage', e => {
  if (e.key === CART_KEY) {
    memory.delete(CART_KEY);
    cart = null;
    for (const fn of [...listeners]) fn();
  }
});

// Для тестов: сбросить состояние в памяти
export function _resetForTests() {
  cart = null;
  memory.clear();
  listeners.clear();
}

// Сводка по корзине. Недоступные товары (нет в каталоге или «сезон закончился»)
// в сумму не входят. products — Map id → товар или null, пока каталог не загружен.
export function cartSummary(cartItems, products) {
  const ids = Object.keys(cartItems);
  let total = 0;
  const unavailable = [];
  for (const id of ids) {
    const p = products?.get(id);
    if (!p || p.stock === 'out') {
      unavailable.push(id);
      continue;
    }
    total += p.price * cartItems[id];
  }
  return { lines: ids.length, total: Math.round(total), unavailable, priced: Boolean(products) };
}

// Каталог в кэше браузера
const CATALOG_KEY = 'catalog.v1';
const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function readCatalogCache(now = Date.now()) {
  const stored = readJson(CATALOG_KEY);
  if (!stored || !stored.data || !Array.isArray(stored.data.products) || typeof stored.savedAt !== 'number') return null;
  return { data: stored.data, savedAt: stored.savedAt, stale: now - stored.savedAt > CATALOG_TTL_MS };
}

export function writeCatalogCache(data, now = Date.now()) {
  writeJson(CATALOG_KEY, { savedAt: now, data });
}
