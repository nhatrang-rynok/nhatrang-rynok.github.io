import { stubScreen } from '../dom.js';

export const title = 'Корзина';

export function render(root) {
  root.append(...stubScreen('Корзина', 'T1.4', 'Здесь будут выбранные товары, итог и кнопка «Оставить заказ».'));
}
