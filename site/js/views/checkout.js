import { stubScreen } from '../dom.js';

export const title = 'Оформление заказа';

export function render(root) {
  root.append(...stubScreen('Оформление заказа', 'T1.4', 'Здесь будет форма: телефон, способ связи, имя, комната, комментарий.'));
}
