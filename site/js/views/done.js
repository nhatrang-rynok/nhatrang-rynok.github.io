import { el } from '../dom.js';
import { FALLBACK_CONTACTS } from '../../config.js';
import { contactButtons } from '../components.js';

export const title = 'Заказ принят';

const DEFAULT_DONE_TEXT = 'С вами свяжутся по поводу заказа на оставленный контактный телефон. Ожидайте.';

export function render(root, ctx) {
  const [orderNo] = ctx.params;
  const settings = { ...FALLBACK_CONTACTS, ...ctx.catalog?.settings };
  root.append(el('div', { class: 'done' },
    el('div', { class: 'done__icon', 'aria-hidden': 'true', text: '✓' }),
    el('h1', { text: `Заказ № ${orderNo} принят` }),
    el('p', { class: 'done__text', text: settings.done_text || DEFAULT_DONE_TEXT }),
    el('p', { class: 'muted', text: 'Если захотите что-то уточнить, напишите нам:' }),
    contactButtons(settings),
    el('a', { class: 'btn btn--primary btn--block btn--big done__back', href: '#/', text: 'Вернуться в каталог' })));
}
