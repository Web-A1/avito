# Авито масспостинг (авторазмещение)

## Статус
- API-интеграция с Авито пока не работает (ждём поддержки). Используем локальную генерацию XML и ручную загрузку в интерфейс Авито.
- Автодеплой из GitHub на Beget настроен: пуш в `main` выкладывает файлы на `avito.vsepeski.ru`.

## Как сейчас работаем (локально)
1. Установить зависимости: `npm install` (Node 18+).
2. Настроить план задач в `data/plan.json`: материал/ID, интервалы публикаций (`slots`) с датой/временем `DateBegin` и общим `count`, распределение по адресам (5 утверждённых, можно алисы) через `locations` с `count` (штуки) или `percent` (от `slot.count`), интервалы между объявлениями `intervalMinMinutes` / `intervalMaxMinutes` (по умолчанию рандом 1–6 минут внутри слота).
   - Пример: в 09:00 — 50 объявлений, 30 шт на Троицк, 40% на Домодедово, 10% на Подольск; в 20:00 — 20 объявлений с другим распределением. Формат `DateBegin`: `dd.MM.yyyy HH:mm`. Проценты берём от `slot.count` (целая часть), остаток добавляем к последней локации с указанным count/percent.
3. Если есть актуальные объявления из Авито, положить один `.xlsx` (последняя выгрузка текущих активных объявлений) в `data/current/` — это слепок, его не правим; он подмешается, чтобы учесть уже опубликованные и избежать дублей/удалений.
4. Сгенерировать фид:
   ```bash
   npm run generate -- --date 05.12
   # или: node bin/generate-xml.js --plan data/plan.json --date 05.12 --current-dir data/current
   ```
   - Параметр `--date` нужен только как метка для имени файла/ID; если не указать, подставится текущая дата в формате `dd.MM`.
5. Забрать `output/ads_<date>.xml` и загрузить вручную через интерфейс Авито.

## Что внутри
- `bin/generate-xml.js` — CLI генератора XML: читает план, текущие объявления из XLSX, генерирует объявления и пишет в `output/`.
- `src/generators/*`, `src/constants/*`, `src/algorithms/*`, `src/validators/*`, `src/xml/xmlGenerator.js` — логика генерации объявлений (пока песок) и сборка XML.
- `docs/swagger/*.json`, `docs/api_structure.md` — конспекты по API Авито (готовим на будущее).
- `deploy/`, `.github/workflows/deploy.yml` — автодеплой на Beget (rsync по SSH).

## Автодеплой (работает)
- Ветка `main` → GitHub Actions → выкладка в `/home/t/tdsta/avito.vsepeski.ru/public_html` на `tdsta.beget.tech`.
- Секреты в GitHub Actions: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_KEY` (приватный SSH-ключ, публичный в `~/.ssh/authorized_keys`).
- `.env` хранится только на сервере, не коммитится.

## Что отложено (когда включат API)
- Настройка OAuth: `AVITO_CLIENT_ID`, `AVITO_CLIENT_SECRET`, `AVITO_REFRESH_TOKEN`, `AVITO_API_URL`, редирект `https://avito.vsepeski.ru/oauth/callback.php`.
- Подключение API-клиента (`src/avito/apiClient.js`) и автоматизация автозагрузки.
- Линты/тесты и дополнительная инфраструктура CI.
