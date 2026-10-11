// Общие кусочки интерфейса: карточки, кнопка «В корзину» со степпером, кнопки связи.
import { el } from './dom.js';
import { FALLBACK_CONTACTS } from '../config.js';
import { formatUnitPrice, formatQty, imageSrc, whatsappUrl, telegramUrl, telUrl } from './format.js';
import { getQty, changeQty } from './store.js';
import { retryCatalog } from './api.js';

const PLACEHOLDER = 'img/placeholder.svg';

export function productImage(product, width, alt = '') {
  const img = el('img', { src: imageSrc(product.img, width), alt, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => {
    if (img.getAttribute('src') !== PLACEHOLDER) img.setAttribute('src', PLACEHOLDER);
  });
  return el('div', { class: 'photo' }, img);
}

// Кнопка «В корзину», после нажатия превращается в степпер «− 1 кг +».
export function qtyControl(product, ctx, { compact = false, large = false } = {}) {
  const box = el('div', { class: `qty${compact ? ' qty--compact' : ''}${large ? ' qty--large' : ''}` });
  if (product.stock === 'out') {
    box.append(el('span', { class: 'qty__out', text: 'Сезон закончился' }));
    return box;
  }

  let shownQty = -1;
  const button = (role, text, label, dir) => el('button', {
    class: role === 'add' ? 'btn btn--primary qty__add' : 'qty__btn',
    type: 'button',
    'data-role': role,
    'aria-label': label,
    text,
    onclick: () => changeQty(product, dir),
  });

  function draw() {
    const qty = getQty(product.id);
    const focusedRole = box.contains(document.activeElement) ? document.activeElement.dataset.role : null;
    shownQty = qty;
    box.replaceChildren(...(qty === 0
      ? [button('add', 'В корзину', `Добавить в корзину: ${product.name}`, 1)]
      : [
          button('minus', '−', `Уменьшить количество: ${product.name}`, -1),
          el('span', { class: 'qty__value', 'aria-live': 'polite', text: formatQty(qty, product.unit) }),
          button('plus', '+', `Увеличить количество: ${product.name}`, 1),
        ]));
    if (focusedRole) {
      const target = qty === 0 ? 'add' : focusedRole === 'minus' ? 'minus' : 'plus';
      box.querySelector(`[data-role="${target}"]`)?.focus();
    }
  }

  draw();
  ctx.subscribe(() => {
    if (getQty(product.id) !== shownQty) draw();
  });
  return box;
}

function badges(product) {
  const items = [];
  if (product.adult) items.push(el('span', { class: 'badge-adult', text: '18+' }));
  if (product.stock === 'preorder') items.push(el('span', { class: 'badge-info', text: 'Под заказ' }));
  return items.length ? el('div', { class: 'badges' }, items) : null;
}

// Карточка в списке категории: фото слева, справа название, цена и кнопка.
export function productCard(product, ctx, heading = 'h2') {
  return el('article', { class: `card${product.stock === 'out' ? ' card--out' : ''}` },
    productImage(product, 400),
    el('div', { class: 'card__body' },
      el(heading, { class: 'card__title' }, el('a', { class: 'card__link', href: `#/p/${product.id}`, text: product.name })),
      product.short && el('p', { class: 'card__short', text: product.short }),
      el('p', { class: 'card__price', text: formatUnitPrice(product.price, product.unit) }),
      badges(product),
      qtyControl(product, ctx)));
}

// Компактная карточка для горизонтальной ленты. Плашки лежат на фото, чтобы карточки были одной высоты.
export function stripCard(product, ctx) {
  const overlay = badges(product);
  overlay?.classList.add('badges--overlay');
  return el('article', { class: `card card--strip${product.stock === 'out' ? ' card--out' : ''}` },
    el('div', { class: 'card__media' }, productImage(product, 400), overlay),
    el('h3', { class: 'card__title' }, el('a', { class: 'card__link', href: `#/p/${product.id}`, text: product.name })),
    el('p', { class: 'card__price', text: formatUnitPrice(product.price, product.unit) }),
    qtyControl(product, ctx, { compact: true }));
}

export function strip(title, products, ctx) {
  return el('section', { class: 'section' },
    el('h2', { text: title }),
    el('div', { class: 'strip' }, products.map(p => stripCard(p, ctx))));
}

// WhatsApp, Telegram, звонок. settings — публичные настройки каталога или запасные контакты.
export function contactButtons(settings = FALLBACK_CONTACTS) {
  return el('div', { class: 'contacts' },
    el('a', { class: 'btn', href: whatsappUrl(settings.whatsapp), target: '_blank', rel: 'noopener', text: 'Написать в WhatsApp' }),
    el('a', { class: 'btn', href: telegramUrl(settings.telegram), target: '_blank', rel: 'noopener', text: 'Написать в Telegram' }),
    el('a', { class: 'btn', href: telUrl(settings.phone), text: 'Позвонить' }));
}

// Если каталога ещё нет, рисует «Загружаем…» или экран ошибки и возвращает true.
export function catalogGate(root, ctx) {
  if (ctx.catalog) return false;
  if (ctx.status === 'error') {
    root.append(
      el('h1', { text: 'Не удалось загрузить каталог' }),
      el('p', { text: 'Проверьте интернет и попробуйте ещё раз. Если не получается, напишите нам: оформим заказ в мессенджере.' }),
      el('button', { class: 'btn btn--primary btn--block', type: 'button', text: 'Повторить', onclick: () => retryCatalog() }),
      el('div', { class: 'section' }, contactButtons(FALLBACK_CONTACTS)));
  } else {
    root.append(
      el('h1', { text: 'Загружаем каталог…' }),
      el('p', { class: 'loading', role: 'status', text: 'Это займёт пару секунд.' }));
  }
  return true;
}

export function notFound(root, what) {
  root.append(
    el('h1', { text: `${what} не найден${what === 'Товар' ? '' : 'а'}` }),
    el('p', { text: 'Возможно, его убрали из каталога.' }),
    el('a', { class: 'btn btn--primary btn--block', href: '#/', text: 'Вернуться в каталог' }));
}
