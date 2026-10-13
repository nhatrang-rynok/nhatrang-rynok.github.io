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

// Данные гостя для следующего заказа (без комментария и подтверждения возраста)
const PROFILE_KEY = 'profile.v1';

export function readProfile() {
  const p = readJson(PROFILE_KEY);
  return p && typeof p === 'object' ? p : {};
}

export function saveProfile({ phone, messenger, name, room }) {
  writeJson(PROFILE_KEY, { phone, messenger, name, room });
}

// ID заказа для повторной отправки: пока состав и телефон те же, ID не меняется,
// поэтому нажатие «Попробовать ещё раз» не создаёт дубль на сервере.
const PENDING_KEY = 'pending-order.v1';

function newId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getClientOrderId(signature) {
  const stored = readJson(PENDING_KEY);
  if (stored && stored.signature === signature && typeof stored.id === 'string') return stored.id;
  const id = newId();
  writeJson(PENDING_KEY, { id, signature });
  return id;
}

export function clearClientOrderId() {
  writeJson(PENDING_KEY, null);
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

// --- Мои заказы ---
// Заказы, оформленные с этого устройства. Телефон и имя не храним: только номер, состав и сумму.
// status — последний известный статус из таблицы: «Новый», «Связались», «Закуплено», «Доставлено», «Отменён».

const ORDERS_KEY = 'orders.v1';
const MAX_ORDERS = 30;
export const FINAL_STATUSES = ['Доставлено', 'Отменён'];

export function readOrders() {
  const stored = readJson(ORDERS_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(o => o && typeof o.id === 'string' && typeof o.no === 'string' && Array.isArray(o.items));
}

export function isActiveOrder(order) {
  return !FINAL_STATUSES.includes(order.status);
}

// order: { id (clientOrderId), no, ts, total, items: [{ id, name, unit, qty, price }] }. Новый заказ ставится первым.
export function addOrder(order) {
  const rest = readOrders().filter(o => o.id !== order.id);
  writeJson(ORDERS_KEY, [{ status: 'Новый', ...order }, ...rest].slice(0, MAX_ORDERS));
  notifyOrders();
}

// updates: { clientOrderId: статус }; возвращает, изменилось ли что-то
export function updateOrderStatuses(updates) {
  let changed = false;
  const next = readOrders().map(o => {
    const status = updates[o.id];
    if (status && status !== o.status) {
      changed = true;
      return { ...o, status };
    }
    return o;
  });
  if (changed) {
    writeJson(ORDERS_KEY, next);
    notifyOrders();
  }
  return changed;
}

const orderListeners = new Set();

export function subscribeOrders(fn) {
  orderListeners.add(fn);
  return () => orderListeners.delete(fn);
}

function notifyOrders() {
  for (const fn of [...orderListeners]) fn();
}

// Повтор заказа: кладёт позиции в корзину. Что недоступно или убрано из каталога — возвращает в skipped.
export function repeatOrder(order, products) {
  const skipped = [];
  let added = 0;
  const next = { ...current() };
  for (const item of order.items) {
    const product = products?.get(item.id);
    if (!product || product.stock === 'out') {
      skipped.push(item.name || item.id);
      continue;
    }
    const step = stepOf(product);
    const qty = Math.min(MAX_QTY, Math.max(minOf(product), Math.round(item.qty / step) * step));
    next[item.id] = round3(Math.max(next[item.id] || 0, qty));
    added++;
  }
  if (added) commit(next);
  return { added, skipped };
}
