import { el } from '../dom.js';
import { catalogGate, categoryBar, notFound, productCard } from '../components.js';
import { productsOfCategory, visibleCategories } from '../catalog.js';

export const title = 'Категория';

export function render(root, ctx) {
  if (catalogGate(root, ctx)) return;
  const [catId] = ctx.params;
  const category = ctx.catalog.categories.find(c => c.id === catId);
  if (!category) {
    notFound(root, 'Категория');
    return;
  }

  root.append(categoryBar(visibleCategories(ctx.catalog), category.id));
  root.append(el('h1', {}, el('span', { 'aria-hidden': 'true', text: `${category.icon} ` }), category.name));
  if (category.note) root.append(el('p', { class: 'muted', text: category.note }));

  const products = productsOfCategory(ctx.catalog, category.id);
  if (products.length === 0) root.append(el('p', { text: 'В этой категории пока ничего нет.' }));
  root.append(el('div', { class: 'list' }, products.map(p => productCard(p, ctx))));
  return category.name;
}
