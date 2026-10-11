# Спецификация серверной части (Google Apps Script)

Скрипт **привязан к таблице** (создаётся из таблицы: Расширения → Apps Script). Код в репозитории — в `apps-script/`. Владелец копирует его в редактор вручную (`08-deploy-apps-script.md`).

## Файлы

| Файл | Содержимое |
|---|---|
| `appsscript.json` | Манифест: `timeZone: "Asia/Ho_Chi_Minh"`, `runtimeVersion: "V8"`, `webapp: {executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS"}`, явный список `oauthScopes` (ниже), `exceptionLogging: "STACKDRIVER"` |
| `Main.gs` | `doGet(e)`, `doPost(e)`, `jsonOut_(obj)`, `onOpen()` (меню) |
| `Catalog.gs` | `getCatalog_()`, `buildCatalog_()`, `readSheetAsObjects_(name)`, кэш с разбиением на части, `clearCatalogCache()` |
| `Orders.gs` | `handleOrder_(body)`, лимиты, идемпотентность, счётчик номеров, запись строк |
| `Notify.gs` | `notifyOrder_(order)`, `sendTelegram_(text)`, `sendMailFallback_(subject, body)`, `testNotify()` |
| `Photos.gs` | `syncPhotos()` |
| `Setup.gs` | `setup()`, `installTriggers_()`, `handleEdit(e)`, `findTelegramChatIds()` |
| `Logic.gs` | Чистые функции без сервисов Google: `normalizePhone_`, `validateOrder_`, `computeRubPrice_`, `computePopular_`, `parseRelated_`, `escapeHtml_`, `sanitizeCell_`, `buildOrderText_` |

## Scopes (`oauthScopes`)

```
https://www.googleapis.com/auth/spreadsheets.currentonly   таблица, к которой привязан скрипт
https://www.googleapis.com/auth/drive                      папка с фото: поиск файлов и доступ по ссылке
https://www.googleapis.com/auth/script.external_request    Telegram API
https://www.googleapis.com/auth/script.send_mail           запасные письма
https://www.googleapis.com/auth/script.scriptapp           установка триггеров
https://www.googleapis.com/auth/script.container.ui        меню в таблице
```

Если добавляется новый scope, это обязательно указывается в «Как развернуть»: владельцу нужно будет заново выдать разрешения.

## Script Properties (секреты и служебные значения)

| Ключ | Кто задаёт | Описание |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | владелец | Токен от @BotFather |
| `TELEGRAM_CHAT_IDS` | владелец | chat_id через запятую (Саня, при желании владелец) |
| `ALERT_EMAIL` | владелец | Почта для запасных уведомлений и ошибок |
| `PHOTOS_FOLDER_ID` | `setup()` | ID папки «Фото товаров» (создаётся, если нет, **как подпапка той папки, где лежит таблица**) |
| `ORDER_SEQ` | скрипт | Последний номер заказа |

## `doGet(e)`

- `action=catalog` → `getCatalog_()`; `action=ping` → `{ok, time}`; иначе → `{ok:false, error:"UNKNOWN_ACTION"}`.
- Любое исключение → `{ok:false, error:"SERVER"}` + запись в «Ошибки». Стек наружу не отдаём.

## Каталог и кэш

- `buildCatalog_()` читает «Категории», «Товары», «Настройки», «Позиции заказов» (последние `popular_days` дней).
- Колонки ищутся по заголовку. Если обязательный заголовок не найден — ошибка в «Ошибки», каталог отдаётся без этого поля или (для `ID`, `Название`, `Категория`, цены) пустым, с `ok:true` и сохранением прошлого кэша. Цель — сайт не падает из-за одной кривой правки.
- Строки валидируются по правилам из `04-google-sheet.md`.
- Ссылка на фото: если в `Фото` лежит ID файла (25+ символов `[A-Za-z0-9_-]`) или ссылка Диска — извлечь ID и превратить в `https://lh3.googleusercontent.com/d/<ID>`. Если это любая другая `https://` ссылка — отдать как есть.
- `version` = ISO-время сборки + `#` + первые 6 символов MD5 от JSON (`Utilities.computeDigest`).
- Кэш: `CacheService.getScriptCache()`, TTL 300 с. Ограничение 100 КБ на значение → JSON режется на куски по 90 000 символов: `cat_v1_meta` = `{parts, version}`, `cat_v1_0…N`. Читаем через `getAll`, если какого-то куска нет — пересобираем.
- `clearCatalogCache()` удаляет meta (без meta кэш считается пустым).

## `doPost(e)`

1. `JSON.parse(e.postData.contents)`. Не разобралось → `VALIDATION`.
2. `action === "order"` → `handleOrder_`. Иначе `UNKNOWN_ACTION`.

## `handleOrder_(body)`

Порядок важен:

1. Ловушка `website` не пустая → вернуть `{ok:true, orderNo:"N-0000"}`, ничего не писать.
2. `orders_enabled` выкл → `ORDERS_PAUSED`.
3. `validateOrder_(body, catalogIndex)` (чистая функция) → нормализованный заказ или ошибки (`VALIDATION`, `ITEM_UNAVAILABLE`). Каталог для проверки берётся из `getCatalog_()` (тот же кэш, цены актуальны в пределах 5 минут; при `ITEM_UNAVAILABLE` перед отказом пересобрать каталог без кэша и проверить ещё раз).
4. `LockService.getScriptLock().waitLock(20000)`:
   - идемпотентность: `CacheService` ключ `ord_<clientOrderId>` → если есть, вернуть сохранённый номер с `duplicate:true`;
   - лимиты: счётчики в кэше `rl_phone_<телефон>` (3 за 10 мин) и `rl_global_<час>` (60 в час) → `RATE_LIMIT`;
   - `ORDER_SEQ + 1` → `N-0001` (4 цифры, дальше растёт);
   - `appendRow` в «Заказы» и пачкой `setValues` в «Позиции заказов». Все пользовательские строки — через `sanitizeCell_` (префикс `'` для `= + - @`);
   - записать `ord_<clientOrderId>` в кэш на 6 часов, увеличить счётчики лимитов.
5. Снять блокировку.
6. `notifyOrder_` в try/catch: результат записать в колонку «Уведомление».
7. Вернуть `{ok:true, orderNo, total, duplicate:false}`.

## Уведомление в Telegram

`POST https://api.telegram.org/bot<TOKEN>/sendMessage`, `parse_mode: "HTML"`, `disable_web_page_preview: true`, на каждый chat_id из `TELEGRAM_CHAT_IDS`. `muteHttpExceptions: true`, проверять `ok` в ответе.

Текст (всё пользовательское — через `escapeHtml_`):

```
🛒 <b>Новый заказ N-0042</b>
📞 +79990000000 — предпочитает WhatsApp
👤 Ольга, комн. 512

• Манго — 2 кг × 90 ₽ = 180 ₽
• Ром Chill — 1 бут. 0,7 л × 650 ₽ = 650 ₽
<b>Итого ≈ 830 ₽</b>
🔞 Возраст подтверждён

💬 Манго поспелее
```

И `reply_markup` с inline-кнопками-ссылками: «Написать в WhatsApp» (`https://wa.me/79990000000`), «Написать в Telegram» (`https://t.me/+79990000000`), «Открыть таблицу» (URL таблицы).

Если Telegram не ответил `ok` ни для одного chat_id → письмо на `ALERT_EMAIL` с тем же текстом (без HTML) + строка в «Ошибки».

## `syncPhotos()`

- Папка из `PHOTOS_FOLDER_ID`. Перебрать файлы-изображения (`image/*`).
- Имя без расширения в нижнем регистре = ID товара (`FR-001.JPG` → `fr-001`). Если файлов с одним ID несколько — берём последний изменённый.
- Для найденного товара: если в `Фото` пусто или там другой ID файла → вписать ID файла, открыть доступ «все, у кого есть ссылка — читатель».
- Файлы, которым не нашлось товара, — перечислить в «Ошибках» (не чаще раза в сутки на файл).
- В конце, если были изменения, — `clearCatalogCache()`.
- Запуск: пункт меню и триггер по времени каждые 10 минут.

## `setup()` (запускается владельцем один раз и после обновлений схемы)

Идемпотентна: повторный запуск ничего не ломает и не дублирует.

- Создать недостающие листы и заголовки; закрепить первую строку; защитить заголовки (режим «предупреждение»).
- Выпадающие списки: `Категория` (диапазон ID категорий), `Наличие`, `Статус`, `Связь`. Флажки: `Показывать`, `18+`, `Хит`.
- Условное форматирование «Заказов» по статусу.
- Начальные данные «Категорий» и «Настроек», **если листы пустые**. Существующие значения не перезаписывать.
- Создать папку «Фото товаров» (если нет `PHOTOS_FOLDER_ID`) внутри папки, где лежит таблица (`DriveApp.getFileById(ssId).getParents()`), открыть к ней одной доступ по ссылке (читатель), сохранить ID. Доступ ко всей родительской папке и к таблице не менять.
- Установить триггеры (удалив старые с тем же обработчиком): `handleEdit` (по изменению таблицы), `syncPhotos` (каждые 10 минут).
- В конце показать окно со сводкой: что создано, ссылка на папку с фото, чего не хватает в Script Properties.

## `handleEdit(e)` — установленный триггер

Если правка на листах «Товары», «Категории» или «Настройки» → `clearCatalogCache()`. Если на «Товарах» и не в колонке «Обновлено» → проставить дату в «Обновлено» у изменённых строк. Функция **не** должна называться `onEdit`, иначе она запустится дважды (как простой и как установленный триггер).

## Меню «🛒 Рынок» (`onOpen`)

- Обновить сайт сейчас → `clearCatalogCache()`
- Подтянуть фото → `syncPhotos()`
- Проверить таблицу → прогнать валидацию, показать список проблем
- Отправить тестовое уведомление → `testNotify()`
- Найти chat_id Telegram → `findTelegramChatIds()` (вызывает `getUpdates`, показывает найденные chat_id с именами)
- Первоначальная настройка → `setup()`

На телефоне меню Apps Script недоступно. Поэтому всё, что нужно Сане, работает автоматически через триггеры (кэш, фото). Меню нужно владельцу на компьютере.

## Тестируемость

`Logic.gs` не обращается к сервисам Google. Тесты на Node (`tests/logic.test.js`) загружают файл через `vm.runInContext` и проверяют: нормализацию телефонов (`8 999…`, `+7 (999)…`, `+84 90…`, мусор), валидацию заказа (шаг, минимум, 18+, длины, дубли ID), расчёт рублёвой цены из донгов, «популярное», экранирование HTML, защиту от формул.
