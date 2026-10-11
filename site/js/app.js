// Точка входа: hash-роутер, шапка. Экраны лежат в js/views/*.js.
import { SITE_TITLE } from '../config.js';
import * as home from './views/home.js';
import * as category from './views/category.js';
import * as product from './views/product.js';
import * as cart from './views/cart.js';
import * as checkout from './views/checkout.js';
import * as done from './views/done.js';

const ROUTES = [
  { re: /^\/$/, view: home },
  { re: /^\/c\/([a-z0-9-]+)$/, view: category },
  { re: /^\/p\/([a-z0-9-]+)$/, view: product },
  { re: /^\/cart$/, view: cart },
  { re: /^\/checkout$/, view: checkout },
  { re: /^\/done\/([A-Za-z0-9-]+)$/, view: done },
];

const root = document.getElementById('app');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const cartCount = document.getElementById('cart-count');

headerTitle.textContent = SITE_TITLE;

// Пройденные адреса: по ним понимаем, есть ли куда возвращаться, и восстанавливаем прокрутку.
const stack = [];
const scrollByHash = new Map();

function currentPath() {
  const path = location.hash.replace(/^#/, '');
  return path === '' ? '/' : path;
}

function resolve(path) {
  for (const route of ROUTES) {
    const m = route.re.exec(path);
    if (m) return { view: route.view, params: m.slice(1) };
  }
  return null;
}

// Число товаров в значке корзины. Вызывается из store.js, когда он появится (T1.3).
export function setCartCount(n) {
  cartCount.textContent = String(n);
  cartCount.hidden = !(n > 0);
}

function render() {
  const path = currentPath();
  const match = resolve(path);
  if (!match) {
    location.replace('#/');
    return;
  }

  const prev = stack[stack.length - 1];
  if (prev !== undefined) scrollByHash.set(prev, window.scrollY);

  const wentBack = stack.length > 1 && stack[stack.length - 2] === path;
  if (wentBack) stack.pop();
  else if (prev !== path) stack.push(path);

  root.replaceChildren();
  root.classList.remove('has-cart-bar');
  const { view, params } = match;
  view.render(root, { params });

  document.title = view.title ? `${view.title} — ${SITE_TITLE}` : SITE_TITLE;
  backBtn.hidden = path === '/';

  window.scrollTo(0, wentBack ? scrollByHash.get(path) || 0 : 0);
  const heading = root.querySelector('h1');
  if (heading) {
    heading.classList.add('page-title');
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

backBtn.addEventListener('click', () => {
  if (stack.length > 1) history.back();
  else location.hash = '#/';
});

window.addEventListener('hashchange', render);
render();
