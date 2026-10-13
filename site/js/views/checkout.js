import { el } from '../dom.js';
import { FALLBACK_CONTACTS } from '../../config.js';
import { catalogGate, contactButtons, whatsappButton } from '../components.js';
import { productMap } from '../catalog.js';
import { formatItemsCount, formatPrice, formatQty } from '../format.js';
import { buildOrderPayload, buildOrderText, LIMITS, splitCart, validateOrderForm } from '../order.js';
import { loadCatalog, sendOrder } from '../api.js';
import { addOrder, clearCart, clearClientOrderId, getCart, getClientOrderId, readProfile, removeItem, saveProfile } from '../store.js';

export const title = 'Оформление заказа';

const MESSENGER_LABELS = { whatsapp: 'WhatsApp', telegram: 'Telegram', call: 'Звонок' };

// Состояние живёт вне render: если экран перерисуется (например, пришёл свежий каталог),
// введённое не пропадёт.
let state = null;
let current = null; // build последней отрисовки: сюда возвращается результат отправки

function freshState() {
  const profile = readProfile();
  return {
    draft: {
      phone: profile.phone || '',
      messenger: MESSENGER_LABELS[profile.messenger] ? profile.messenger : 'whatsapp',
      name: profile.name || '',
      room: profile.room || '',
      comment: '',
    },
    sending: false,
    notice: null,        // {text, tone}
    failure: null,       // {kind: 'server' | 'rate'}
    fieldErrors: {},
    paused: false,
    waText: '',
  };
}

export function render(root, ctx) {
  if (catalogGate(root, ctx)) return;
  // Введённое сохраняем при переходах (например, в корзину и обратно); сообщения сбрасываем
  if (!state) state = freshState();
  else if (ctx.navigated) Object.assign(state, { notice: null, failure: null, fieldErrors: {}, paused: false });

  const products = productMap(ctx.catalog);
  const settings = { ...FALLBACK_CONTACTS, ...ctx.catalog.settings };
  const ordersOff = () => ctx.catalog.settings.orders_enabled === false || state.paused;

  function pauseNotice() {
    return el('div', { class: 'notice notice--danger', role: 'status' },
      el('p', { text: 'Сейчас заказы не принимаются. Напишите нам:' }),
      contactButtons(settings));
  }

  function field({ name, label, hint, control, optional }) {
    const describedBy = [hint && `hint-${name}`, `err-${name}`].filter(Boolean).join(' ');
    control.setAttribute('aria-describedby', describedBy);
    return el('div', { class: 'field', 'data-field': name },
      el('label', { class: 'field__label', for: control.id },
        label, optional && el('span', { class: 'field__opt', text: ' (по желанию)' })),
      control,
      hint && el('p', { class: 'field__hint', id: `hint-${name}`, text: hint }),
      el('p', { class: 'field__error', id: `err-${name}`, role: 'alert', hidden: true }));
  }

  function showErrors(form, errors) {
    for (const node of form.querySelectorAll('[data-field]')) {
      const name = node.dataset.field;
      const message = errors[name];
      const errorEl = node.querySelector('.field__error');
      const control = node.querySelector('input, textarea');
      errorEl.textContent = message || '';
      errorEl.hidden = !message;
      if (control) control.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
  }

  function build() {
    root.replaceChildren();
    const { draft } = state;
    const { available, total } = splitCart(getCart(), products);

    root.append(el('h1', { text: 'Оформление заказа' }));

    if (state.notice) {
      root.append(el('p', { class: `notice${state.notice.tone === 'danger' ? ' notice--danger' : ''}`, role: 'alert', tabindex: '-1', id: 'notice', text: state.notice.text }));
    }
    if (available.length === 0) {
      root.append(
        el('p', { text: 'В корзине нет доступных товаров.' }),
        el('a', { class: 'btn btn--primary btn--block', href: '#/', text: 'В каталог' }));
      return;
    }
    if (ordersOff()) {
      root.append(pauseNotice());
      return;
    }

    root.append(el('details', { class: 'summary' },
      el('summary', { text: `Ваш заказ: ${formatItemsCount(available.length)}, ${formatPrice(total)}` }),
      el('ul', { class: 'summary__list' }, available.map(l =>
        el('li', { text: `${l.product.name} — ${formatQty(l.qty, l.product.unit)} — ${formatPrice(l.sum)}` }))),
      el('a', { href: '#/cart', text: 'Изменить корзину' })));

    const phone = el('input', { class: 'input', id: 'f-phone', name: 'phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '+ код страны и номер', required: true, value: draft.phone });
    const name = el('input', { class: 'input', id: 'f-name', name: 'name', type: 'text', autocomplete: 'given-name', maxlength: LIMITS.name, value: draft.name });
    const room = el('input', { class: 'input', id: 'f-room', name: 'room', type: 'text', autocomplete: 'off', maxlength: LIMITS.room, value: draft.room });
    const comment = el('textarea', { class: 'input', id: 'f-comment', name: 'comment', rows: '3', maxlength: LIMITS.comment, placeholder: 'Например: когда удобно получить, спелость фруктов, дата выезда' });
    comment.value = draft.comment;
    // Поле-ловушка для ботов: людям не видно. Имя нарочно не «website», чтобы автозаполнение браузера его не трогало.
    const trap = el('input', { type: 'text', id: 'f-hp', name: 'hp-check', tabindex: '-1', autocomplete: 'off' });

    phone.addEventListener('input', () => { draft.phone = phone.value; });
    name.addEventListener('input', () => { draft.name = name.value; });
    room.addEventListener('input', () => { draft.room = room.value; });
    comment.addEventListener('input', () => { draft.comment = comment.value; });

    const choices = el('div', { class: 'choices', role: 'radiogroup', 'aria-labelledby': 'messenger-label' },
      Object.entries(MESSENGER_LABELS).flatMap(([value, label]) => [
        el('input', {
          class: 'choice__input visually-hidden', type: 'radio', name: 'messenger', id: `m-${value}`, value,
          checked: draft.messenger === value,
          onchange: () => { draft.messenger = value; },
        }),
        el('label', { class: 'choice', for: `m-${value}`, text: label }),
      ]));

    const submit = el('button', { class: 'btn btn--primary btn--block btn--big', type: 'submit', text: state.sending ? 'Отправляем…' : 'Отправить заказ' });
    if (state.sending) {
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
    }

    const form = el('form', { class: 'form', novalidate: true },
      field({ name: 'phone', label: 'Ваш телефон', hint: 'Номер любой страны, с кодом: например +7 …, +380 …, +375 …', control: phone }),
      el('div', { class: 'field' },
        el('p', { class: 'field__label', id: 'messenger-label', text: 'Как с вами связаться' }),
        choices),
      field({ name: 'name', label: 'Имя', control: name, optional: true }),
      field({ name: 'room', label: 'Номер комнаты', control: room, optional: true }),
      field({ name: 'comment', label: 'Комментарий', control: comment, optional: true }),
      el('div', { class: 'hp', 'aria-hidden': 'true' }, el('label', { for: 'f-hp', text: 'Оставьте это поле пустым' }), trap),
      state.failure && failurePanel(),
      submit,
      el('p', { class: 'muted form__consent', text: 'Нажимая кнопку, вы соглашаетесь, что оператор свяжется с вами по указанному номеру. Телефон используется только для этого заказа.' }));

    form.addEventListener('submit', event => {
      event.preventDefault();
      onSubmit(form, { available, total }, trap.value);
    });
    root.append(form);
    showErrors(form, state.fieldErrors);
  }

  function failurePanel() {
    const rate = state.failure.kind === 'rate';
    return el('div', { class: 'notice notice--danger', role: 'alert', tabindex: '-1', id: 'failure' },
      el('p', { text: rate
        ? 'Слишком много заказов подряд. Напишите нам в WhatsApp, и мы оформим заказ вручную.'
        : 'Не получилось отправить заказ. Проверьте интернет и попробуйте ещё раз.' }),
      el('div', { class: 'contacts' },
        !rate && el('button', { class: 'btn btn--primary', type: 'submit', text: 'Попробовать ещё раз' }),
        whatsappButton(settings.whatsapp, state.waText, 'Отправить через WhatsApp')));
  }

  async function onSubmit(form, { available, total }, trapValue) {
    if (state.sending) return;
    const result = validateOrderForm(state.draft);
    state.fieldErrors = result.errors;
    showErrors(form, result.errors);
    if (!result.ok) {
      form.querySelector('#f-phone')?.focus();
      return;
    }

    state.failure = null;
    state.notice = null;
    state.sending = true;
    state.waText = buildOrderText({ lines: available, total, values: result.values });
    saveProfile(result.values);
    build();

    const signature = JSON.stringify([result.values.phone, available.map(l => [l.product.id, l.qty])]);
    const clientOrderId = getClientOrderId(signature);
    const payload = buildOrderPayload({
      values: result.values,
      lines: available,
      total,
      clientOrderId,
      catalogVersion: ctx.catalog.version,
      website: trapValue,
    });
    const res = await sendOrder(payload);
    state.sending = false;

    if (res.ok) {
      const orderNo = String(res.orderNo || '').replace(/[^A-Za-z0-9-]/g, '') || 'OK';
      // Заказ запоминаем на этом устройстве для вкладки «Заказы» (без телефона и имени)
      addOrder({
        id: clientOrderId,
        no: orderNo,
        ts: Date.now(),
        total,
        items: available.map(l => ({ id: l.product.id, name: l.product.name, unit: l.product.unit, qty: l.qty, price: l.product.price })),
      });
      clearCart();
      clearClientOrderId();
      state = null;
      location.replace(`#/done/${orderNo}`);
      return;
    }

    handleFailure(res);
    if (location.hash.replace(/^#/, '') === '/checkout') {
      current();
      const target = document.getElementById('failure') || document.getElementById('notice');
      target?.focus();
    }
  }

  function handleFailure(res) {
    switch (res.error) {
      case 'ITEM_UNAVAILABLE': {
        const ids = Array.isArray(res.items) ? res.items : [];
        const names = ids.map(id => products.get(id)?.name).filter(Boolean).map(n => `«${n}»`);
        ids.forEach(removeItem);
        loadCatalog();
        state.notice = {
          tone: 'warn',
          text: `${names.length ? `Товар ${names.join(', ')} сейчас недоступен` : 'Некоторые товары сейчас недоступны'}, мы убрали его из корзины. Проверьте заказ и отправьте ещё раз.`,
        };
        break;
      }
      case 'VALIDATION':
        state.fieldErrors = res.fields && typeof res.fields === 'object' ? res.fields : {};
        state.notice = { tone: 'danger', text: res.message || 'Проверьте введённые данные.' };
        break;
      case 'ORDERS_PAUSED':
        state.paused = true;
        break;
      case 'RATE_LIMIT':
        state.failure = { kind: 'rate' };
        break;
      default:
        state.failure = { kind: 'server' };
    }
  }

  current = build;
  build();
}
