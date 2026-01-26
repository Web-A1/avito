# Структура проекта (финальная)

Проект приведён к Rust‑first архитектуре, при этом исходный JS‑код сохранён и остаётся рабочим в архиве.

## Rust (основной код)
- `rust/` — основная кодовая база (`feed-core`, `feed-cli`).
- `rust/output/` — артефакты запусков:
  - `runs/<label>/` — только последний запуск (ads.xml, ads_manifest.json, build-log.json, photos_links.json, photos_run.json).
  - `archive/<label>/` — все предыдущие запуски.
- `data/` — общие входные данные:
  - `data/plan.json` — план публикаций.
  - `data/current/*.xlsx` — выгрузка текущих объявлений.
  - `data/photos/` — исходники фото (variants/hashes генерируются и чистятся автоматически).
  - `data/watermark-settings.json` — калибровка водяного знака для Rust.
  - `data/js_watermark-settings.json` — калибровка водяного знака для JS‑архива.
- `update_old_ads.json` — правила обновления старых объявлений.
- `docs/` — правила и справочные материалы.

### Чистый запуск Rust (рекомендуется)
Запуск «с чистого листа» (очистка включена по умолчанию в `feed-cli`):

```bash
cargo run --manifest-path rust/Cargo.toml -p feed-cli -- \
  --plan data/plan.json \
  --current-dir data/current \
  --update-rules update_old_ads.json \
  --photos-rust \
  --upload-rust \
  --out-dir rust/output
```

Примечания:
- `feed-cli` очищает `variants/` и `hashes.json` перед генерацией фото.
- Артефакты автоматически раскладываются в `rust/output/runs/<label>/` и `rust/output/archive/`.

## JS‑архив (рабочий)
- `js_archive/` — сохранённая и рабочая JS‑версия пайплайна.
- Используются симлинки на общие данные:
  - `js_archive/data` → `data`
  - `js_archive/config` → `config`
  - `js_archive/output` → `output`
  - `js_archive/update_old_ads.json` → `update_old_ads.json`
  - `js_archive/.env` → `.env`
- Запуск:
  - `npm run build:feed` (из `js_archive/`)

## Old trash
- `old_trash/` — временное хранилище перемещённых файлов/папок (без удаления).
