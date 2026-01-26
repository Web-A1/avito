# Авито масспостинг (авторазмещение)

## Статус
- Основной рабочий пайплайн — Rust (`rust/`).
- JS-версия сохранена как архив в `js_archive/` и полностью работоспособна.
- API-интеграция с Авито пока не работает (ждём поддержки). Используем локальную генерацию XML и ручную загрузку в интерфейс Авито.

## Как сейчас работаем (локально, Rust — основной)
1. Скачать из Авито Excel с активными объявлениями и положить **один** `.xlsx` в `data/current/`.
2. Построить план через plan‑builder:
   - Запустить локальный сервер:
     ```bash
     cd js_archive
     node tools/plan-builder/server.js
     ```
   - Открыть `http://localhost:3000` (страница `js_archive/tools/plan-builder/index.html`).
   - В интерфейсе задать правила для старых объявлений (фото/описание/заголовок, по всем или по AvitoId) и сохранить `update_old_ads.json`.
3. Полный боевой сценарий (фото + загрузка + обновление старых + новые объявления + XML):
   **Рекомендуется запускать release‑бинарник (в разы быстрее, без потери качества):**
   ```bash
   bin/run-release.sh
   ```
   Если нужно передать дополнительные флаги в `feed-cli`, добавьте их в конец команды:
   ```bash
   bin/run-release.sh --date-label "26.01.2026_10-00-00"
   ```
   **Debug‑запуск (значительно медленнее, для отладки):**
   ```bash
   cargo run --manifest-path rust/Cargo.toml -p feed-cli -- \
     --plan data/plan.json \
     --current-dir data/current \
     --update-rules update_old_ads.json \
     --photos-rust \
     --upload-rust \
     --out-dir rust/output
   ```
   - Артефакты запуска складываются в `rust/output/runs/<label>/`, предыдущие — в `rust/output/archive/`.
4. Забрать `rust/output/runs/<label>/ads.xml` и загрузить вручную через интерфейс Авито.

## JS-архив (рабочий)
- Код начальной версии сохранён в `js_archive/`.
- Запуск из архива:
  ```bash
  cd js_archive
  npm install
  npm run build:feed -- --plan data/plan.json --current-dir data/current --update-rules update_old_ads.json
  ```
- В JS используется `data/js_watermark-settings.json` для настроек водяного знака.

## Структура проекта (актуально для Rust)
- `rust/` — основной код и CLI (`feed-cli`, `feed-core`).
- `rust/output/` — артефакты запусков (runs/archive).
- `data/plan.json` — основной план задач.
- `data/current/*.xlsx` — слепок текущих объявлений из Авито.
- `data/photos/...` — исходные фото (variants/hashes генерируются и чистятся автоматически).
- `data/watermark-settings.json` — ручная калибровка opacity для Rust.
- `data/js_watermark-settings.json` — настройки водяного знака для JS-архива.
- `update_old_ads.json` — правила обновления старых объявлений.
- `js_archive/` — рабочий архив JS-версии (полный цикл через `npm run build:feed`).
- `docs/` — документация/правила XML.

## Дополнительная документация
- `docs/structure.md` — финальная архитектура проекта (Rust‑first + JS‑архив).
- `docs/avito_rules.md` — правила и структура XML-фида для Авито (обязательные поля, чек-лист, типовые ошибки).
- `docs/content_sand.md` — тексты и параметры блоков 1–7 для объявлений по песку.
- `docs/strategy.md` — стратегия генерации объявлений и уникализации (блоки, латиница, проверка дублей).
- `docs/api_structure.md` — конспект по разделам Avito API (Swagger-файлы в `docs/swagger/`).
- `docs/research.md` — исследование конкурентов и выводы для стратегии генерации.

## Сценарии проверки валидатора
- Ошибка "Block1/2 mismatch": у объявления с `BulkMaterialType="Песок"` подставить в блок 1 или 2 ключевые слова про щебень/гравий (или наоборот — для щебня вставить «песок»). Валидатор должен выдать критическую ошибку с `adId`.

## Автодеплой
- Для выкладки на Beget используется rsync-скрипт из `deploy/rsync.sh` и SSH-ключи `deploy_key*`.
- Конфигурация CI через GitHub Actions может быть добавлена отдельно (сейчас `.github/workflows/deploy.yml` в репозитории нет).
- `.env` хранится только на сервере, не коммитится.

## Что отложено (когда включат API)
- Настройка OAuth: `AVITO_CLIENT_ID`, `AVITO_CLIENT_SECRET`, `AVITO_REFRESH_TOKEN`, `AVITO_API_URL`, редирект `https://avito.vsepeski.ru/oauth/callback.php` (см. `oauth/callback.php`).
- Подключение API-клиента (`src/avito/apiClient.js`) и автоматизация автозагрузки/интеграции с Avito API.
- Линты/тесты и дополнительная инфраструктура CI (конфигурация `.github/workflows/*`, линтеры/тесты).
