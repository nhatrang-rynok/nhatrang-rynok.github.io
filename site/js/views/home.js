import { el } from '../dom.js';
import { FALLBACK_CONTACTS } from '../../config.js';
import { catalogGate, contactButtons, strip } from '../components.js';
import { popularProducts, visibleCategories } from '../catalog.js';

export const title = 'Главная';

export function render(root, ctx) {
  if (catalogGate(root, ctx)) return;
  const { settings } = ctx.catalog;
  const contacts = { ...FALLBACK_CONTACTS, ...settings };

  root.append(el('h1', { class: 'visually-hidden', text: settings.site_title || 'Рынок' }));

  if (settings.announcement) root.append(el('p', { class: 'notice', text: settings.announcement }));
  if (settings.orders_enabled === false) {
    root.append(el('div', { class: 'notice notice--danger' },
      el('p', { text: 'Сейчас заказы не принимаются. Напишите нам:' }),
      contactButtons(contacts)));
  }

  const categories = visibleCategories(ctx.catalog);
  if (categories.length === 0) {
    root.append(el('p', { text: 'Каталог пока пуст. Загляните позже.' }));
  } else {
    root.append(el('nav', { class: 'tiles', 'aria-label': 'Категории' },
      categories.map(c => el('a', { class: 'tile', href: `#/c/${c.id}` },
        el('span', { class: 'tile__icon', 'aria-hidden': 'true', text: c.icon }),
        el('span', { class: 'tile__name', text: c.name })))));
  }

  const popular = popularProducts(ctx.catalog);
  if (popular.length) root.append(strip('Самое популярное', popular, ctx));

  root.append(el('section', { class: 'section' },
    el('h2', { text: 'Как это работает' }),
    el('ol', { class: 'how' },
      el('li', { text: 'Выберите товары и добавьте их в корзину.' }),
      el('li', { text: 'Оставьте телефон: имя и пожелания по желанию.' }),
      el('li', { text: 'Мы напишем вам, купим всё и привезём в отель.' }))));

  if (settings.terms) root.append(el('section', { class: 'section' }, el('h2', { text: 'Условия' }), el('p', { class: 'pre', text: settings.terms })));

  root.append(el('section', { class: 'section' }, el('h2', { text: 'Связаться с нами' }), contactButtons(contacts)));
}
