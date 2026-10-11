import { stubScreen } from '../dom.js';

export const title = 'Категория';

export function render(root, { params: [catId] }) {
  root.append(...stubScreen('Категория', 'T1.3', `Здесь будет список товаров категории «${catId}».`));
}
