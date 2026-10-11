import { stubScreen } from '../dom.js';

export const title = 'Товар';

export function render(root, { params: [productId] }) {
  root.append(...stubScreen('Товар', 'T1.3', `Здесь будет карточка товара «${productId}».`));
}
