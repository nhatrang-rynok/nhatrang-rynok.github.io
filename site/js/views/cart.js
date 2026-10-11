import { el } from '../dom.js';
import { FALLBACK_CONTACTS } from '../../config.js';
import { catalogGate, contactButtons, productImage, qtyControl, strip } from '../components.js';
import { productMap } from '../catalog.js';
import { formatItemsCount, formatPrice, formatUnitPrice } from '../format.js';
import { splitCart } from '../order.js';
import { suggestForCart } from '../recommend.js';
import { getCart, removeItem } from '../store.js';

export const title = 'Корзина';

export function render(root, ctx) {
  if (catalogGate(root, ctx)) return;
  const products = productMap(ctx.catalog);
  const settings = { ...FALLBACK_CONTACTS, ...ctx.catalog.settings };

  let signature = '';
  let offs = [];
  let sumEls = new Map();
  let totalEl = null;

  // Подписки элементов текущей сборки: при пересборке старые снимаются
  const buildCtx = { ...ctx, subscribe: fn => { offs.push(ctx.subscribe(fn)); } };

  function lineView({ product, qty, sum }) {
    const sumEl = el('p', { class: 'cart-line__sum', text: formatPrice(sum) });
    sumEls.set(product.id, sumEl);
    return el('li', { class: 'cart-line' },
      productImage(product, 200),
      el('div', { class: 'cart-line__body' },
        el('h2', { class: 'cart-line__title' }, el('a', { href: `#/p/${product.id}`, text: product.name })),
        el('p', { class: 'cart-line__price', text: formatUnitPrice(product.price, product.unit) }),
        el('div', { class: 'cart-line__row' }, qtyControl(product, buildCtx), sumEl),
        el('button', {
          class: 'link-btn',
          type: 'button',
          'aria-label': `Удалить из корзины: ${product.name}`,
          text: 'Удалить',
          onclick: () => removeItem(product.id),
        })));
  }

  function build() {
    for (const off of offs) off();
    offs = [];
    sumEls = new Map();
    root.replaceChildren();

    const cart = getCart();
    const { available, unavailable, total } = splitCart(cart, products);
    signature = Object.keys(cart).join(',');

    root.append(el('h1', { text: 'Корзина' }));

    if (Object.keys(cart).length === 0) {
      root.append(
        el('p', { text: 'Корзина пуста. Выберите что-нибудь в каталоге.' }),
        el('a', { class: 'btn btn--primary btn--block', href: '#/', text: 'В каталог' }));
      return;
    }

    if (unavailable.length) {
      const named = unavailable.filter(u => u.product).map(u => u.product.name);
      const gone = unavailable.length - named.length;
      const names = [...named, gone ? `${formatItemsCount(gone)} (больше нет в каталоге)` : ''].filter(Boolean).join(', ');
      root.append(el('div', { class: 'notice', role: 'status' },
        el('p', {}, el('strong', { text: 'Эти товары сейчас недоступны: ' }), `${names}.`),
        el('p', { class: 'notice__note', text: 'В заказ они не попадут.' }),
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Убрать недоступные',
          onclick: () => unavailable.forEach(u => removeItem(u.id)),
        })));
    }

    if (available.length) {
      root.append(el('ul', { class: 'cart-lines' }, available.map(lineView)));
      totalEl = el('p', { class: 'total__sum', text: formatPrice(total) });
      root.append(el('div', { class: 'total' },
        el('p', { class: 'total__label', text: 'Итого' }),
        totalEl,
        el('p', { class: 'muted total__note', text: 'Цены ориентировочные. Точную сумму оператор подтвердит при связи.' })));
    }

    const suggestions = suggestForCart(cart, ctx.catalog);
    if (suggestions.length) root.append(strip('Возможно, будет интересно', suggestions, buildCtx));

    root.append(el('div', { class: 'section' }, actionBlock(available.length > 0)));
  }

  function actionBlock(canOrder) {
    if (ctx.catalog.settings.orders_enabled === false) {
      return el('div', { class: 'notice notice--danger' },
        el('p', { text: 'Сейчас заказы не принимаются. Напишите нам:' }),
        contactButtons(settings));
    }
    if (!canOrder) return el('p', { class: 'muted', text: 'Добавьте в корзину доступные товары, чтобы оформить заказ.' });
    return el('a', { class: 'btn btn--primary btn--block btn--big', href: '#/checkout', text: 'Оставить заказ' });
  }

  // Изменилось количество — обновляем суммы. Изменился состав — пересобираем экран.
  function onCartChange() {
    const cart = getCart();
    if (Object.keys(cart).join(',') !== signature) {
      const y = window.scrollY;
      build();
      window.scrollTo(0, y);
      const heading = root.querySelector('h1');
      if (heading && !root.contains(document.activeElement)) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
      return;
    }
    const { available, total } = splitCart(cart, products);
    for (const { product, sum } of available) {
      const sumEl = sumEls.get(product.id);
      if (sumEl) sumEl.textContent = formatPrice(sum);
    }
    if (totalEl) totalEl.textContent = formatPrice(total);
  }

  build();
  ctx.subscribe(onCartChange);
}
