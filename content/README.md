# content/

Материалы для наполнения каталога. Процесс — `docs/10-content-pipeline.md`.

- `transcripts/` — расшифровки YouTube-роликов (.txt, первая строка — ссылка и название ролика). Загружать через GitHub: Add file → Upload files.
- `candidates.csv` — кандидаты в каталог (делает Claude, задача T3.4).
- `descriptions/` — CSV для импорта в лист «Товары». `sample-products.csv` — 14 примерных товаров (фрукты и ром), собирается из `site/data/catalog.sample.json` командой `node tools/make-sample-csv.mjs`; тест следит, чтобы они совпадали. Настоящие товары по задаче T3.5.
- `photo-sources.md` — источники и лицензии стоковых фото, если такие используются как временные заглушки.
