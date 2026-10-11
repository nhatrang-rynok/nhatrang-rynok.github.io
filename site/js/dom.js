// Мелкие помощники для построения DOM. Текст всегда вставляется через textContent,
// поэтому всё, что пришло из таблицы, безопасно (никакого innerHTML).

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

// Временная заглушка экрана: заголовок и пояснение, какая задача его реализует.
export function stubScreen(title, task, note) {
  return [
    el('h1', { text: title }),
    el('div', { class: 'stub' },
      el('p', { text: note }),
      el('p', { text: `Будет реализовано в задаче ${task}.` })),
  ];
}
