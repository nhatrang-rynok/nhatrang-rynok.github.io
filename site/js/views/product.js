import { el } from '../dom.js';
import { catalogGate, notFound, productImage, qtyControl, strip } from '../components.js';
import { formatAltPrices, formatUnitPrice, pieceLine } from '../format.js';
import { productMap } from '../catalog.js';
import { relatedForProduct } from '../recommend.js';

export const title = 'Товар';

export function render(root, ctx) {
  if (catalogGate(root, ctx)) return;
  const [productId] = ctx.params;
  const product = productMap(ctx.catalog).get(productId);
  if (!product) {
    notFound(root, 'Товар');
    return;
  }

  const alt = formatAltPrices(product);
  root.append(
    productImage(product, 900, product.name),
    el('h1', { id: 'modal-title', text: product.name }),
    el('p', { class: 'product__price', text: formatUnitPrice(product.price, product.unit) }),
    alt && el('p', { class: 'product__alt', text: alt }),
    pieceLine(product) && el('p', { class: 'product__piece', text: pieceLine(product) }));

  if (product.adult) root.append(el('p', {}, el('span', { class: 'badge-adult', text: '18+' }), ' Только для совершеннолетних.'));
  if (product.stock === 'preorder') root.append(el('p', { class: 'muted', text: 'Под заказ: оператор уточнит срок, когда свяжется с вами.' }));

  root.append(el('div', { class: 'product__buy' }, qtyControl(product, ctx, { large: true })));

  if (product.desc) root.append(el('p', { class: 'pre section', text: product.desc }));
  if (product.src) root.append(el('p', {}, el('strong', { text: 'Где куплено: ' }), product.src));
  if (product.warn) {
    root.append(el('div', { class: 'notice' },
      el('p', {}, el('strong', { text: 'Предупреждение. ' }), product.warn),
      el('p', { class: 'notice__note', text: 'Общая справка, не медицинская рекомендация. Если у вас аллергия, хронические заболевания, беременность или вы принимаете лекарства, посоветуйтесь с врачом.' })));
  }

  const related = relatedForProduct(product, ctx.catalog);
  if (related.length) root.append(strip('Вам может понравиться', related, ctx));
  return product.name;
}
