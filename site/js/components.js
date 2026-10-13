// Общие кусочки интерфейса: карточки, кнопка «В корзину» со степпером, кнопки связи.
import { el } from './dom.js';
import { FALLBACK_CONTACTS } from '../config.js';
import { formatUnitPrice, formatQty, imageSrc, pieceLine, whatsappUrl, whatsappAppUrl, telegramUrl, telegramAppUrl } from './format.js';
import { replaceHash } from './nav.js';
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
      pieceLine(product) && el('p', { class: 'card__piece', text: pieceLine(product) }),
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
    pieceLine(product) && el('p', { class: 'card__piece', text: pieceLine(product) }),
    qtyControl(product, ctx, { compact: true }));
}

export function strip(title, products, ctx) {
  return el('section', { class: 'section' },
    el('h2', { text: title }),
    el('div', { class: 'strip' }, products.map(p => stripCard(p, ctx))));
}

// WhatsApp и Telegram. settings — публичные настройки каталога или запасные контакты. Ссылки с data-app на телефоне
// открывают приложение сразу (links.js), на компьютере работает обычный адрес.
export function contactButtons(settings = FALLBACK_CONTACTS, whatsappText = '') {
  return el('div', { class: 'contacts' },
    whatsappButton(settings.whatsapp, whatsappText, 'Написать в WhatsApp'),
    el('a', { class: 'btn', href: telegramUrl(settings.telegram), 'data-app': telegramAppUrl(settings.telegram), target: '_blank', rel: 'noopener', text: 'Написать в Telegram' }));
}

export function whatsappButton(number, text, label, primary = false) {
  return el('a', { class: `btn${primary ? ' btn--primary' : ''}`, href: whatsappUrl(number, text), 'data-app': whatsappAppUrl(number, text), target: '_blank', rel: 'noopener', text: label });
}

// Ряд значков категорий над списком товаров: переключение между категориями без возврата на главную.
// Без названий (у каждого значка есть подпись для скринридера). Текущая категория выделена.
export function categoryBar(categories, currentId) {
  const bar = el('nav', { class: 'catbar', 'aria-label': 'Категории' },
    categories.map(c => el('a', {
      class: `catbar__item${c.id === currentId ? ' is-current' : ''}`,
      href: `#/c/${c.id}`,
      'aria-label': c.name,
      'aria-current': c.id === currentId ? 'page' : null,
      title: c.name,
      text: c.icon,
      // Меняем адрес без новой записи в истории: «Назад» по-прежнему ведёт туда, откуда пришли
      onclick: e => {
        if (c.id === currentId) { e.preventDefault(); return; }
        e.preventDefault();
        replaceHash(`/c/${c.id}`);
      },
    })));
  queueMicrotask(() => bar.querySelector('.is-current')?.scrollIntoView?.({ inline: 'center', block: 'nearest' }));
  return bar;
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
