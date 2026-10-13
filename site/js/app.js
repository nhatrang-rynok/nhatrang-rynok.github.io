// Точка входа: hash-роутер, шапка, нижняя панель корзины. Экраны лежат в js/views/*.js.
// Карточка товара (#/p/…) открывается поверх текущего экрана, а не заменяет его: под ней остаётся магазин.
import { SITE_TITLE } from '../config.js';
import { catalogState, loadCatalog, subscribeCatalog } from './api.js';
import { cartSummary, getCart, isActiveOrder, readOrders, subscribe as subscribeCart, subscribeOrders } from './store.js';
import { productMap } from './catalog.js';
import { formatItemsCount, formatPrice } from './format.js';
import { el } from './dom.js';
import { diffCart, initTelemetry, setTelemetryEnabled, track, trackView } from './telemetry.js';
import { initAppLinks } from './links.js';
import { takeReplaceFlag } from './nav.js';
import * as home from './views/home.js';
import * as category from './views/category.js';
import * as product from './views/product.js';
import * as cart from './views/cart.js';
import * as checkout from './views/checkout.js';
import * as done from './views/done.js';
import * as orders from './views/orders.js';

const ROUTES = [
  { name: 'home', re: /^\/$/, view: home },
  { name: 'category', re: /^\/c\/([a-z0-9-]+)$/, view: category },
  { name: 'product', re: /^\/p\/([a-z0-9-]+)$/, view: product },
  { name: 'cart', re: /^\/cart$/, view: cart },
  { name: 'checkout', re: /^\/checkout$/, view: checkout },
  { name: 'done', re: /^\/done\/([A-Za-z0-9-]+)$/, view: done },
  { name: 'orders', re: /^\/orders$/, view: orders },
];
const ROUTES_WITHOUT_CART_BAR = new Set(['cart', 'checkout', 'done', 'orders']);

const root = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const header = document.getElementById('app-header');
const cartCount = document.getElementById('cart-count');
const cartLink = document.getElementById('cart-link');
const ordersCount = document.getElementById('orders-count');
const ordersLink = document.getElementById('orders-link');
const cartBar = document.getElementById('cart-bar');
const cartBarLink = document.getElementById('cart-bar-link');
const modalEl = document.getElementById('modal');
const modalCard = modalEl.querySelector('.modal__card');
const modalBody = document.getElementById('modal-body');
const modalClose = document.getElementById('modal-close');

// Пройденные адреса: по ним понимаем, есть ли куда возвращаться, и восстанавливаем прокрутку.
const stack = [];
const scrollByHash = new Map();

let baseMatch = null;      // экран под карточкой (или просто текущий экран, если карточки нет)
let baseAuto = false;      // экран под карточкой выбран сами: товар открыли по прямой ссылке
let baseCleanups = [];
let modalCleanups = [];
let modalOpener = null;    // что было в фокусе до открытия карточки

const isProductPath = path => /^\/p\//.test(path);
const isModalOpen = () => !modalEl.hidden;

function currentPath() {
  const path = location.hash.replace(/^#/, '');
  return path === '' ? '/' : path;
}

function resolve(path) {
  for (const route of ROUTES) {
    const m = route.re.exec(path);
    if (m) return { route, params: m.slice(1), path };
  }
  return null;
}

function runAll(list) {
  for (const fn of list.splice(0)) fn();
}

// Шапка и нижняя панель зависят от корзины, каталога и текущего экрана
function updateChrome() {
  const catalog = catalogState.data;
  const siteTitle = catalog?.settings?.site_title || SITE_TITLE;
  headerTitle.textContent = siteTitle;

  const summary = cartSummary(getCart(), productMap(catalog));
  cartCount.textContent = String(summary.lines);
  cartCount.hidden = summary.lines === 0;
  cartLink.setAttribute('aria-label', summary.lines ? `Корзина, ${formatItemsCount(summary.lines)}` : 'Корзина');

  const activeOrders = readOrders().filter(isActiveOrder).length;
  ordersCount.textContent = String(activeOrders);
  ordersCount.hidden = activeOrders === 0;
  ordersLink.setAttribute('aria-label', activeOrders ? `Мои заказы, активных: ${activeOrders}` : 'Мои заказы');

  const showBar = summary.lines > 0 && baseMatch && !ROUTES_WITHOUT_CART_BAR.has(baseMatch.route.name);
  cartBar.hidden = !showBar;
  root.classList.toggle('has-cart-bar', Boolean(showBar));
  if (showBar) {
    const parts = ['Корзина', formatItemsCount(summary.lines)];
    if (summary.priced && summary.total > 0) parts.push(formatPrice(summary.total));
    cartBarLink.textContent = `${parts.join(' · ')} →`;
  }
}

function makeCtx(match, navigated, cleanups) {
  return {
    params: match.params,
    catalog: catalogState.data,
    status: catalogState.status,
    navigated, // true — пришли на экран, false — тот же экран перерисован (обновился каталог)
    subscribe: fn => {
      const off = subscribeCart(fn);
      cleanups.push(off);
      return off;
    },
    onCleanup: fn => {
      cleanups.push(fn);
      return fn;
    },
  };
}

const siteTitleNow = () => catalogState.data?.settings?.site_title || SITE_TITLE;

let baseTitle = '';

// Рисует основной экран. Вызывается и при переходе, и при обновлении каталога.
function drawBase(match, navigated) {
  runAll(baseCleanups);
  baseMatch = match;
  const ctx = makeCtx(match, navigated, baseCleanups);
  root.replaceChildren();
  const dynamicTitle = match.route.view.render(root, ctx);
  if (catalogState.stale) {
    root.prepend(el('p', { class: 'notice', role: 'status', text: 'Загружаем актуальные цены…' }));
  }
  const pageTitle = dynamicTitle || match.route.view.title;
  baseTitle = pageTitle ? `${pageTitle} — ${siteTitleNow()}` : siteTitleNow();
  document.title = baseTitle;
  backBtn.hidden = match.path === '/';
  updateChrome();
}

// Рисует карточку товара поверх основного экрана
function drawModal(match, navigated) {
  runAll(modalCleanups);
  const ctx = makeCtx(match, navigated, modalCleanups);
  const keep = modalCard.scrollTop;
  modalBody.replaceChildren();
  const dynamicTitle = match.route.view.render(modalBody, ctx);
  if (!isModalOpen()) {
    modalOpener = document.activeElement;
    modalEl.hidden = false;
    document.documentElement.classList.add('modal-open');
    setBackgroundInert(true);
  }
  modalCard.scrollTop = navigated ? 0 : keep;
  document.title = dynamicTitle ? `${dynamicTitle} — ${siteTitleNow()}` : baseTitle;
  if (navigated) modalClose.focus({ preventScroll: true });
}

function closeModalView() {
  if (!isModalOpen()) return false;
  runAll(modalCleanups);
  modalBody.replaceChildren();
  modalEl.hidden = true;
  document.documentElement.classList.remove('modal-open');
  setBackgroundInert(false);
  const opener = modalOpener;
  modalOpener = null;
  if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  document.title = baseTitle;
  return true;
}

// Пока карточка открыта, до экрана под ней нельзя добраться ни Tab-ом, ни скринридером
function setBackgroundInert(on) {
  for (const node of [root, header, cartBar]) node.inert = on;
}

// Пользователь закрыл карточку (крестик, фон, Esc): возвращаемся на экран под ней
function closeModal() {
  if (!isModalOpen()) return;
  let k = 0;
  while (k < stack.length && isProductPath(stack[stack.length - 1 - k])) k++;
  if (stack.length > k) {
    history.go(-k);
    return;
  }
  // Карточку открыли по прямой ссылке: под ней в истории ничего нет
  const base = baseMatch?.path || '/';
  stack.length = 0;
  location.replace(`#${base}`);
}

modalClose.addEventListener('click', closeModal);
modalEl.addEventListener('click', e => {
  if (e.target === modalEl) closeModal(); // нажатие вне карточки
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isModalOpen()) closeModal();
});

// Индекс записи стека, в которую возвращаемся (кнопка «Назад»), или -1
function backIndex(path) {
  if (stack.length >= 2 && stack[stack.length - 2] === path) return stack.length - 2;
  // Закрытие стопки карточек: возвращаемся сразу к экрану под ними
  let j = stack.length - 1;
  while (j >= 0 && isProductPath(stack[j])) j--;
  return j >= 0 && j < stack.length - 1 && stack[j] === path ? j : -1;
}

// Экран под карточкой, если товар открыли по прямой ссылке: категория товара или главная
function pickBase(productMatch) {
  const item = productMap(catalogState.data)?.get(productMatch.params[0]);
  return resolve(item ? `/c/${item.cat}` : '/');
}

function navigate() {
  const path = currentPath();
  const match = resolve(path);
  if (!match) {
    location.replace('#/');
    return;
  }

  const replacing = takeReplaceFlag();
  const prev = stack[stack.length - 1];
  if (prev !== undefined && !isProductPath(prev)) scrollByHash.set(prev, window.scrollY);

  // После оформления заказа возвращаться к форме нельзя: «Назад» ведёт на главную
  if (match.route.name === 'done') stack.length = 0;

  const backTo = backIndex(path);
  if (replacing && stack.length) stack[stack.length - 1] = path;
  else if (backTo !== -1) stack.length = backTo + 1;
  else if (prev !== path || stack.length === 0) stack.push(path);

  if (match.route.name === 'product') {
    if (!baseMatch) {
      baseAuto = true;
      drawBase(pickBase(match), true);
      window.scrollTo(0, 0);
    }
    drawModal(match, true);
    trackView(match.route.name, path, document.title);
    return;
  }

  const wasModal = closeModalView();
  baseAuto = false;
  if (wasModal && baseMatch && baseMatch.path === path) {
    // Вернулись с карточки на тот же экран: он не менялся, прокрутка на месте
    trackView(match.route.name, path, document.title);
    updateChrome();
    return;
  }

  drawBase(match, true);
  trackView(match.route.name, path, document.title);

  window.scrollTo(0, backTo !== -1 ? scrollByHash.get(path) || 0 : 0);
  const heading = root.querySelector('h1');
  if (heading) {
    heading.classList.add('page-title');
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

// Журнал посещений ведётся, пока в «Настройках» не снята галочка log_events
function syncTelemetry() {
  setTelemetryEnabled(catalogState.data?.settings?.log_events !== false);
}

// Каталог обновился: перерисовываем тот же экран на том же месте
function onCatalogChange() {
  syncTelemetry();
  const y = window.scrollY;
  if (baseMatch) {
    // Товар открыли по прямой ссылке, пока каталога не было: теперь известно, под какую категорию его положить
    let target = baseMatch;
    if (baseAuto && isModalOpen()) {
      const open = resolve(currentPath());
      if (open?.route.name === 'product') target = pickBase(open) || baseMatch;
    }
    drawBase(target, false);
    window.scrollTo(0, y);
  }
  if (isModalOpen()) {
    const open = resolve(currentPath());
    if (open?.route.name === 'product') drawModal(open, false);
  }
  updateChrome();
}

backBtn.addEventListener('click', () => {
  if (stack.length > 1) history.back();
  else location.hash = '#/';
});

initTelemetry();
initAppLinks();
loadCatalog(); // кэш подхватывается сразу, до первой отрисовки
syncTelemetry();
subscribeCatalog(onCatalogChange);
subscribeCart(updateChrome);
subscribeOrders(updateChrome);

let previousCart = getCart();
subscribeCart(() => {
  const next = getCart();
  const products = productMap(catalogState.data);
  for (const line of diffCart(previousCart, next, id => products?.get(id)?.name)) track('cart', line);
  previousCart = next;
});

window.addEventListener('hashchange', navigate);
navigate();
