import { el, stubScreen } from '../dom.js';

export const title = 'Главная';

export function render(root) {
  root.append(
    ...stubScreen('Главная', 'T1.3', 'Здесь будут категории, «Самое популярное» и кнопки связи.'),
    // Временно: ссылки на все маршруты, чтобы проверять переходы. Удалить в T1.3.
    el('h2', { text: 'Все экраны (временно)' }),
    el('ul', { class: 'stub-links' },
      ...[
        ['#/c/fruits', 'Категория «Фрукты»'],
        ['#/p/fr-001', 'Товар fr-001'],
        ['#/cart', 'Корзина'],
        ['#/checkout', 'Оформление'],
        ['#/done/TEST-0001', 'Готово (TEST-0001)'],
      ].map(([href, text]) => el('li', {}, el('a', { href, text })))));
}
