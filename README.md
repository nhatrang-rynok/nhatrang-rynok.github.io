# Онлайн-рынок для гостей отеля (Нячанг)

Каталог товаров с местного рынка и из аптеки с доставкой в отель. Гость листает каталог с телефона, собирает корзину и оставляет телефон. Оператор (Саня) связывается с ним в WhatsApp или Telegram, закупает товары и привозит их.

**Статус:** документация и план готовы; этап 1 (сайт на заглушках) в работе, готов каркас сайта (`site/`). Адрес сайта: https://nhatrang-rynok.github.io/

## Как устроено (коротко)

```
Телефон гостя ──► Статический сайт (GitHub Pages, папка site/)
                       │  GET каталог / POST заказ
                       ▼
                 Google Apps Script (веб-приложение, папка apps-script/)
                       │
          ┌────────────┼──────────────────┐
          ▼            ▼                  ▼
   Google Таблица   Google Диск      Telegram-бот
   (товары, заказы) (фото товаров)   (уведомление Сане)
```

## Документы

| Файл | О чём |
|---|---|
| [ROADMAP.md](ROADMAP.md) | Дорожная карта: этапы, задачи, критерии готовности. **Начинать отсюда.** |
| [CLAUDE.md](CLAUDE.md) | Правила для Claude Code (Sonnet) при написании кода |
| [docs/00-brief.md](docs/00-brief.md) | Бриф с учётом принятых решений |
| [docs/01-tz-mvp.md](docs/01-tz-mvp.md) | ТЗ на MVP: экраны, поля, сценарии, что не делаем |
| [docs/02-stack.md](docs/02-stack.md) | Выбор стека с плюсами и минусами |
| [docs/03-architecture.md](docs/03-architecture.md) | Архитектура, структура репозитория, потоки данных |
| [docs/04-google-sheet.md](docs/04-google-sheet.md) | Структура Google Таблицы: листы и колонки |
| [docs/05-api.md](docs/05-api.md) | Контракт API между сайтом и Apps Script |
| [docs/06-frontend.md](docs/06-frontend.md) | Спецификация сайта: экраны, поведение, дизайн |
| [docs/07-apps-script.md](docs/07-apps-script.md) | Спецификация серверной части на Apps Script |
| [docs/08-deploy-apps-script.md](docs/08-deploy-apps-script.md) | Как развернуть Apps Script вручную, по шагам |
| [docs/09-hosting-and-url.md](docs/09-hosting-and-url.md) | Хостинг и адрес сайта без ника на GitHub |
| [docs/10-content-pipeline.md](docs/10-content-pipeline.md) | Сбор контента: YouTube → кандидаты → Саня → таблица; фото |
| [docs/11-warnings-and-legal.md](docs/11-warnings-and-legal.md) | Предупреждения для карточек, юридические риски |
| [docs/12-operator-guide.md](docs/12-operator-guide.md) | Инструкция для Сани (черновик) |
| [docs/13-testing.md](docs/13-testing.md) | Чек-листы проверки |
| [docs/14-prompts-for-sonnet.md](docs/14-prompts-for-sonnet.md) | Готовые промпты для каждой задачи |
| [docs/decisions.md](docs/decisions.md) | Журнал принятых решений |
| [docs/open-questions.md](docs/open-questions.md) | Открытые вопросы |
| [docs/00-brief-original.md](docs/00-brief-original.md) | Исходный бриф без изменений |

## Кто что делает

- **Claude Code** пишет код сайта (`site/`) и Apps Script (`apps-script/`), публикует сайт через GitHub Actions и к каждому изменению Apps Script прикладывает инструкцию по развёртыванию.
- **Ты (владелец)** копируешь код Apps Script в редактор, разворачиваешь веб-приложение и настраиваешь таблицу, бота и доступы. Всё делается в графическом интерфейсе.
- **Саня (оператор)** заполняет таблицу с телефона, снимает фото и обрабатывает заказы.
