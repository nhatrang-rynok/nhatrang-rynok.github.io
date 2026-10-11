// Выборки из каталога. Чистые функции.

const maps = new WeakMap();

// Map id → товар (запоминается для конкретного объекта каталога)
export function productMap(catalog) {
  if (!catalog) return null;
  let map = maps.get(catalog);
  if (!map) {
    map = new Map(catalog.products.map(p => [p.id, p]));
    maps.set(catalog, map);
  }
  return map;
}

const bySortThenName = (a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, 'ru');

export function productsOfCategory(catalog, catId) {
  return catalog.products.filter(p => p.cat === catId).sort(bySortThenName);
}

// Категории, в которых есть хотя бы один товар
export function visibleCategories(catalog) {
  const used = new Set(catalog.products.map(p => p.cat));
  return catalog.categories.filter(c => used.has(c.id)).sort((a, b) => a.sort - b.sort);
}

export function popularProducts(catalog) {
  const map = productMap(catalog);
  return catalog.popular.map(id => map.get(id)).filter(p => p && p.stock !== 'out');
}
