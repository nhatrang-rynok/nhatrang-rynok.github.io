// Переходы, которые меняют адрес без новой записи в истории (переключение категорий).
// app.js читает флаг в navigate(): запись в стеке заменяется, а не добавляется.
let replaceNext = false;

export function replaceHash(path) {
  if (location.hash === `#${path}`) return; // адрес тот же: hashchange не будет, флаг не нужен
  replaceNext = true;
  location.replace(`#${path}`);
}

export function takeReplaceFlag() {
  const flag = replaceNext;
  replaceNext = false;
  return flag;
}
