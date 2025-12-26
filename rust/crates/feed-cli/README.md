# feed-cli

Черновой CLI для перехода на Rust.

## Аргументы
- `--plan` (по умолчанию `data/plan.json`)
- `--current-dir` (по умолчанию `data/current`)
- `--update-rules` (по умолчанию `update_old_ads.json`)
- `--config` (по умолчанию `config/feed.json`)
- `--photos` (true/false) — запустить JS-этапы генерации/загрузки фото (ищет скрипты в `bin/` из корня репо)
- `--photos-rust` (true/false) — сгенерировать варианты фото на Rust (берёт исходники из `--photos-root` → `<material>/originals`, складывает в `--photos-dir`, имена `<mat>_<variant>_<city>_<date>_<idx>.jpg`)
- `--photos-root` (по умолчанию `data/photos`) — где лежат исходники для Rust-генератора
- `--photos-default-count` (по умолчанию 1) — сколько фото на локацию, если в плане нет count
- `--photos-text`/`--photos-text-opacity`/`--photos-text-color`/`--photos-pattern-opacity` — настройки ватермарка (перекрывают overrides)
- `--upload-rust` (true/false) — загрузить готовые фото на Я.Диск через Rust-клиент (YANDEX_DISK_TOKEN обязателен)
- `--photos-dir` (по умолчанию `output/photos`) — каталог с фото для `--photos-rust` и `--upload-rust`
- `--disk-root` (по умолчанию `Cursor_for_Avito`)
- `--out-dir` (по умолчанию `output`)
- `--date-label` (метка для photos_links_*.json; если пусто — текущее время)
- `--photos-mapping` (путь к готовому photos_links_*.json, если читать без upload)
- `--make-wm-template "<glob>"` — сгенерировать шаблон `data/watermark-overrides.json` по маске файлов (например, `"data/photos/**/*.jpg"`)
- `--photos-preview <file>` + `--preview-opacities 0.04,0.06,...` — собрать сетку превью водяного знака в `--preview-out` (по умолчанию `output/photos_preview`)
- `--xml-compare <file>` — после генерации сверить XML с эталоном (без учёта пробелов)

Сейчас выполняет валидации плана (counts/окна/шаги). Фото-обвязка через JS есть (`--photos`), читает маппинг по `photos_links_<date_label>.json` (или указанному). Rust-генерация (`--photos-rust`) умеет учитывать overrides для ватермарка, складывает фото в `--photos-dir`. Загрузка на Я.Диск (`--upload-rust`) формирует `photos_links_<label>.json`.
