# feed-cli

Черновой CLI для перехода на Rust.

## Аргументы
- `--plan` (по умолчанию `data/plan.json`)
- `--current-dir` (по умолчанию `data/current`)
- `--update-rules` (по умолчанию `update_old_ads.json`)
- `--config` (по умолчанию `config/feed.json`)
- `--photos` (true/false) — запустить JS-этапы генерации/загрузки фото
- `--disk-root` (по умолчанию `Cursor_for_Avito`)
- `--out-dir` (по умолчанию `output`)
- `--date-label` (метка для photos_links_*.json; если пусто — текущее время)
- `--photos-mapping` (путь к готовому photos_links_*.json, если читать без upload)

Сейчас выполняет валидации плана (counts/окна/шаги). Фото-обвязка через JS есть (`--photos`), читает маппинг по `photos_links_<date_label>.json` (или указанному).
