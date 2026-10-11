import { stubScreen } from '../dom.js';

export const title = 'Заказ принят';

export function render(root, { params: [orderNo] }) {
  root.append(...stubScreen('Заказ принят', 'T1.4', `Здесь будет подтверждение заказа № ${orderNo}.`));
}
