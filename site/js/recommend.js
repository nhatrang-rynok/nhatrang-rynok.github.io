// Рекомендации. Чистые функции.

// «Вам может понравиться» на странице товара: сначала rel, потом популярное,
// потом остальное из той же категории. Без самого товара и без «сезон закончился».
export function relatedForProduct(product, catalog, limit = 6) {
  const byId = new Map(catalog.products.map(p => [p.id, p]));
  const sameCategory = catalog.products
    .filter(p => p.cat === product.cat)
    .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'ru'));
  const ids = [...product.rel, ...catalog.popular, ...sameCategory.map(p => p.id)];
  const seen = new Set([product.id]);
  const result = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (!p || seen.has(id) || p.stock === 'out') continue;
    seen.add(id);
    result.push(p);
    if (result.length >= limit) break;
  }
  return result;
}

// «Возможно, будет интересно» в корзине: сопутствующие (rel) выбранных товаров, затем популярное,
// затем товары из категорий, которых в корзине нет. Без того, что уже в корзине, и без «сезон закончился».
export function suggestForCart(cart, catalog, limit = 6) {
  const byId = new Map(catalog.products.map(p => [p.id, p]));
  const inCart = Object.keys(cart).map(id => byId.get(id)).filter(Boolean);
  const cartCats = new Set(inCart.map(p => p.cat));
  const otherCategories = catalog.products
    .filter(p => !cartCats.has(p.cat))
    .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'ru'));
  const ids = [...inCart.flatMap(p => p.rel), ...catalog.popular, ...otherCategories.map(p => p.id)];
  const seen = new Set(Object.keys(cart));
  const result = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (!p || seen.has(id) || p.stock === 'out') continue;
    seen.add(id);
    result.push(p);
    if (result.length >= limit) break;
  }
  return result;
}
