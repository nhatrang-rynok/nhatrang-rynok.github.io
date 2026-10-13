// Вкладка «Заказы»: заказы, оформленные с этого устройства. Активные сверху, завершённые ниже, у завершённых — «Повторить».
import { el } from '../dom.js';
import { fetchOrderStatuses } from '../api.js';
import { productMap } from '../catalog.js';
import { formatItemsCount, formatPrice, formatQty } from '../format.js';
import { isActiveOrder, readOrders, repeatOrder, subscribeOrders, updateOrderStatuses } from '../store.js';

export const title = 'Мои заказы';

// Что видит гость вместо служебных статусов таблицы
export const STATUS_TEXT = {
  'Новый': 'Принят, скоро свяжемся',
  'Связались': 'Мы с вами связались',
  'Закуплено': 'Куплено, везём',
  'Доставлено': 'Доставлен',
  'Отменён': 'Отменён',
};
const STATUS_CLASS = { 'Новый': 'new', 'Связались': 'talk', 'Закуплено': 'buy', 'Доставлено': 'done', 'Отменён': 'off' };

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function render(root, ctx) {
  let message = null;
  const products = ctx.catalog ? productMap(ctx.catalog) : null;

  function card(order) {
    const active = isActiveOrder(order);
    return el('li', { class: `order order--${STATUS_CLASS[order.status] || 'new'}` },
      el('div', { class: 'order__head' },
        el('h3', { class: 'order__no', text: `Заказ № ${order.no}` }),
        el('span', { class: `status status--${STATUS_CLASS[order.status] || 'new'}`, text: STATUS_TEXT[order.status] || STATUS_TEXT['Новый'] })),
      el('p', { class: 'order__date muted', text: formatDate(order.ts) }),
      el('ul', { class: 'order__items' }, order.items.map(i => el('li', { text: `${i.name} — ${formatQty(i.qty, i.unit)}` }))),
      el('p', { class: 'order__total', text: `${formatItemsCount(order.items.length)}, ${formatPrice(order.total)}` }),
      !active && el('button', {
        class: 'btn btn--primary btn--block',
        type: 'button',
        'data-repeat': order.id,
        disabled: products ? null : true,
        text: 'Повторить заказ',
        onclick: () => repeat(order),
      }));
  }

  function repeat(order) {
    const { added, skipped } = repeatOrder(order, products);
    if (added && !skipped.length) {
      location.hash = '#/cart';
      return;
    }
    message = added
      ? { tone: 'warn', text: `Добавили в корзину: ${formatItemsCount(added)}. Сейчас недоступно: ${skipped.join(', ')}.`, cart: true }
      : { tone: 'danger', text: `Ничего не добавили: сейчас недоступно — ${skipped.join(', ')}.` };
    build();
    window.scrollTo(0, 0);
  }

  function build() {
    root.replaceChildren();
    const orders = readOrders();
    root.append(el('h1', { text: 'Мои заказы' }));
    if (message) {
      root.append(el('div', { class: `notice${message.tone === 'danger' ? ' notice--danger' : ''}`, role: 'status' },
        el('p', { text: message.text }),
        message.cart && el('a', { class: 'btn btn--primary', href: '#/cart', text: 'Открыть корзину' })));
    }
    if (orders.length === 0) {
      root.append(
        el('p', { text: 'Здесь появятся заказы, которые вы оформите с этого телефона: можно будет посмотреть, на каком этапе заказ, и повторить его.' }),
        el('a', { class: 'btn btn--primary btn--block', href: '#/', text: 'В каталог' }));
      return;
    }
    const active = orders.filter(isActiveOrder);
    const finished = orders.filter(o => !isActiveOrder(o));
    if (active.length) root.append(el('section', { class: 'section' }, el('h2', { text: 'Активные' }), el('ul', { class: 'orders' }, active.map(card))));
    if (finished.length) root.append(el('section', { class: 'section' }, el('h2', { text: 'Завершённые' }), el('ul', { class: 'orders' }, finished.map(card))));
    root.append(el('p', { class: 'muted section', text: 'Заказы хранятся только на этом устройстве. Если очистить данные браузера, список исчезнет.' }));
  }

  build();
  ctx.onCleanup(subscribeOrders(build));

  // Статусы подтягиваем из таблицы: оператор меняет их там. Завершённые не спрашиваем.
  const pending = readOrders().filter(isActiveOrder).map(o => o.id);
  if (pending.length) {
    fetchOrderStatuses(pending).then(list => {
      if (!list) return;
      const updates = {};
      for (const o of list) if (o.found && o.status) updates[o.id] = o.status;
      updateOrderStatuses(updates);
    });
  }
}
