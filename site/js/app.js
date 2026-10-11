// Точка входа: hash-роутер, шапка, нижняя панель корзины. Экраны лежат в js/views/*.js.
import { SITE_TITLE } from '../config.js';
import { catalogState, loadCatalog, subscribeCatalog } from './api.js';
import { cartSummary, getCart, subscribe as subscribeCart } from './store.js';
import { productMap } from './catalog.js';
import { formatItemsCount, formatPrice } from './format.js';
import { el } from './dom.js';
import * as home from './views/home.js';
import * as category from './views/category.js';
import * as product from './views/product.js';
import * as cart from './views/cart.js';
import * as checkout from './views/checkout.js';
import * as done from './views/done.js';

const ROUTES = [
  { name: 'home', re: /^\/$/, view: home },
  { name: 'category', re: /^\/c\/([a-z0-9-]+)$/, view: category },
  { name: 'product', re: /^\/p\/([a-z0-9-]+)$/, view: product },
  { name: 'cart', re: /^\/cart$/, view: cart },
  { name: 'checkout', re: /^\/checkout$/, view: checkout },
  { name: 'done', re: /^\/done\/([A-Za-z0-9-]+)$/, view: done },
];
const ROUTES_WITHOUT_CART_BAR = new Set(['cart', 'checkout', 'done']);

const root = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const cartCount = document.getElementById('cart-count');
const cartLink = document.getElementById('cart-link');
const cartBar = document.getElementById('cart-bar');
const cartBarLink = document.getElementById('cart-bar-link');

// Пройденные адреса: по ним понимаем, есть ли куда возвращаться, и восстанавливаем прокрутку.
const stack = [];
const scrollByHash = new Map();

let currentRoute = null;
let cleanups = [];

function currentPath() {
  const path = location.hash.replace(/^#/, '');
  return path === '' ? '/' : path;
}

function resolve(path) {
  for (const route of ROUTES) {
    const m = route.re.exec(path);
    if (m) return { route, params: m.slice(1) };
  }
  return null;
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

  const showBar = summary.lines > 0 && currentRoute && !ROUTES_WITHOUT_CART_BAR.has(currentRoute.name);
  cartBar.hidden = !showBar;
  root.classList.toggle('has-cart-bar', Boolean(showBar));
  if (showBar) {
    const parts = ['Корзина', formatItemsCount(summary.lines)];
    if (summary.priced && summary.total > 0) parts.push(formatPrice(summary.total));
    cartBarLink.textContent = `${parts.join(' · ')} →`;
  }
}

// Рисует текущий экран. Вызывается и при переходе, и при обновлении каталога.
function draw(match, navigated) {
  for (const fn of cleanups) fn();
  cleanups = [];

  const ctx = {
    params: match.params,
    catalog: catalogState.data,
    status: catalogState.status,
    navigated, // true — пришли на экран, false — тот же экран перерисован (обновился каталог)
    subscribe: fn => {
      const off = subscribeCart(fn);
      cleanups.push(off);
      return off;
    },
  };

  root.replaceChildren();
  currentRoute = match.route;
  const view = match.route.view;
  const dynamicTitle = view.render(root, ctx);
  if (catalogState.stale) {
    root.prepend(el('p', { class: 'notice', role: 'status', text: 'Загружаем актуальные цены…' }));
  }

  const pageTitle = dynamicTitle || view.title;
  const siteTitle = catalogState.data?.settings?.site_title || SITE_TITLE;
  document.title = pageTitle ? `${pageTitle} — ${siteTitle}` : siteTitle;
  updateChrome();
}

function navigate() {
  const path = currentPath();
  const match = resolve(path);
  if (!match) {
    location.replace('#/');
    return;
  }

  const prev = stack[stack.length - 1];
  if (prev !== undefined) scrollByHash.set(prev, window.scrollY);

  // После оформления заказа возвращаться к форме нельзя: «Назад» ведёт на главную
  if (match.route.name === 'done') stack.length = 0;

  const wentBack = stack.length > 1 && stack[stack.length - 2] === path;
  if (wentBack) stack.pop();
  else if (prev !== path || stack.length === 0) stack.push(path);

  draw(match, true);
  backBtn.hidden = path === '/';

  window.scrollTo(0, wentBack ? scrollByHash.get(path) || 0 : 0);
  const heading = root.querySelector('h1');
  if (heading) {
    heading.classList.add('page-title');
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

// Каталог обновился: перерисовываем тот же экран на том же месте
function onCatalogChange() {
  const match = resolve(currentPath());
  if (!match) return;
  const y = window.scrollY;
  draw(match, false);
  window.scrollTo(0, y);
}

backBtn.addEventListener('click', () => {
  if (stack.length > 1) history.back();
  else location.hash = '#/';
});

loadCatalog(); // кэш подхватывается сразу, до первой отрисовки
subscribeCatalog(onCatalogChange);
subscribeCart(updateChrome);
window.addEventListener('hashchange', navigate);
navigate();
