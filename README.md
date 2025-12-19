# Авито масспостинг (авторазмещение)

## Статус
- API-интеграция с Авито пока не работает (ждём поддержки). Используем локальную генерацию XML и ручную загрузку в интерфейс Авито.
- Автодеплой на Beget работает через rsync-скрипт из `deploy/`, код выкладывается на `avito.vsepeski.ru`.

## Как сейчас работаем (локально)
1. Установить зависимости: `npm install` (Node 18+).
2. Настроить план задач в `data/plan.json`: материал/ID, интервалы публикаций (`slots`) с датой/временем `DateBegin` и общим `count`, распределение по адресам (5 утверждённых, можно алисы) через `locations` с `count` (штуки) или `percent` (от `slot.count`), интервалы между объявлениями `intervalMinMinutes` / `intervalMaxMinutes` (по умолчанию рандом 1–6 минут внутри слота).
3. Если есть актуальные объявления из Авито, положить один `.xlsx` (последняя выгрузка текущих активных объявлений) в `data/current/` — это слепок, его не правим; он подмешается, чтобы учесть уже опубликованные и избежать дублей/удалений.
4. Полный боевой сценарий (фото + обновление старых объявлений + новые объявления + XML):
   ```bash
   npm run build:feed -- \
     --plan data/plan.json \
     --current-dir data/current \
     --update-rules update_old_ads.json \
     --date 17.12
   ```
   - Скрипт `bin/build-feed.js` пошагово: читает план, Excel, правила обновления, генерирует/обновляет фото, загружает их на Яндекс.Диск, обновляет старые объявления, генерирует новые, собирает финальный XML и валидирует его.
   - В `output/` после прогона остаются только актуальные файлы: `ads_<date>.xml`, `ads_<date>_manifest.json` и соответствующий `photos_links_<date>.json`.
5. Упрощённый режим (только генерация XML без фото/Я.Диска) — для быстрых экспериментов:
   ```bash
   npm run generate -- --date 05.12
   # или: node bin/generate-xml.js --plan data/plan.json --date 05.12 --current-dir data/current
   ```
   - Параметр `--date` нужен только как метка для имени файла/ID; если не указать, подставится текущая дата в формате `dd.MM`.
6. Забрать `output/ads_<date>.xml` и загрузить вручную через интерфейс Авито.

## Структура проекта (для ИИ)
- `bin/build-feed.js` — основной пайплайн генерации фида (шаги 1–11, см. комментарии в файле).
- `bin/generate-xml.js` — низкоуровневый генератор XML (используется из `build-feed.js` и может запускаться отдельно).
- `bin/generate-photo-variants.js` — генерация вариантов фото по плану (`data/plan.json`) для новых объявлений.
- `bin/upload-photos.js` — загрузка фото на Яндекс.Диск и формирование `output/photos_links_*.json`.
- `bin/clean-history.js` — чистка истории хэшей фото в `data/photos/**/hashes.json`.
- `bin/validate-xml.js` — валидация XML-фида `output/ads_*.xml`.
- `bin/regenerate-photos.js` — вспомогательные операции по пересозданию фото (если используются).
- `bin/compare-originals.js` — сравнение исходных фото/вариантов (диагностика/отладка).
- `data/plan.json` — основной план задач: материалы, слоты, локации, интервалы публикаций.
- `data/current/*.xlsx` — слепок текущих объявлений из Авито (вход для учёта уже опубликованных).
- `data/photos/...` — исходные и сгенерированные фото, история (`hashes.json`, `hashes.json.tmp`, `temp_updates/`).
- `update_old_ads.json` — правила обновления старых объявлений (по `AvitoId`).
- `update_old_ads.json.example` — пример структуры `update_old_ads.json`.
- `output/ads_*.xml` — сгенерированные XML-фиды для ручной загрузки в Авито.
- `output/ads_*_manifest.json` — манифесты с перечнем `adId` из соответствующего XML.
- `output/photos_links_*.json` — маппинг `adId` → `public_url` для фото на Яндекс.Диске (актуален только последний файл).
- `src/generators/*` — генерация объявлений и описаний:
  - `src/generators/materials/sand/*` — генераторы описаний и техпараметров для песка.
  - `src/generators/materials/rubble/*` — генераторы описаний и техпараметров для щебня.
  - в корне `src/generators/` — только универсальные вещи (`adGenerator`, `materialStrategies`, алгоритмы и т.п.).
- `src/constants/*` — константы: заголовки, блоки 1–7, типы песка, алиасы материалов/городов и т.п.
- `src/algorithms/*` — алгоритмы уникализации (разделители, латиница, порядок блоков).
- `src/utils/*` — утилиты чтения Excel (`currentAdsReader`) и `photos_links` (`photosLinksReader`).
- `src/validators/duplicateChecker.js` — проверка дублей объявлений по правилам из `docs/*`.
- `src/xml/xmlGenerator.js` — сборка XML-фида по правилам из `docs/avito_rules.md`.
- `docs/swagger/*.json`, `docs/api_structure.md` — конспекты по разделам Avito API.
- `deploy/` — скрипты деплоя на Beget (rsync по SSH).

## Дополнительная документация
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
