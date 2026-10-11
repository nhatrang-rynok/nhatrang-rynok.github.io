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
