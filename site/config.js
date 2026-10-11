// Настройки сайта. Секретов здесь быть не должно: репозиторий публичный.

// Адрес веб-приложения Apps Script (оканчивается на /exec). Он не секретный: виден в коде сайта.
// Пустая строка — режим заглушки: каталог берётся из data/catalog.sample.json,
// а отправка заказа имитируется (так работают автоматические проверки).
export const API_URL = 'https://script.google.com/macros/s/AKfycbwnMopEJQwj72xjp2gmEM4wGqW7f55TAaVmaaXtp3DEDL-e5Goyapopu_qNhSKkPe7hDg/exec';

// Название в шапке, пока каталог не загружен (потом его заменяет site_title из таблицы).
export const SITE_TITLE = 'Рынок у отеля';

// Контакты на случай, когда каталог не загрузился. Заглушки: настоящие значения
// оператор вносит в лист «Настройки» таблицы.
export const FALLBACK_CONTACTS = {
  phone: '+84 000 000 000',
  whatsapp: '84000000000',
  telegram: 'primer_operator',
};

export const APP_VERSION = '0.1.0';
