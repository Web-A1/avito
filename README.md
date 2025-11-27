# Авито масспостинг (авторазмещение)

Локальная разработка → пуш в GitHub → автодеплой на Beget (`avito.vsepeski.ru`).

## Что внутри (первый шаг)
- `deploy/` — скрипты деплоя.
- `.github/workflows/deploy.yml` — черновик GitHub Actions (потребуются секреты).
- `.gitignore` — базовый набор для Node/PHP.

## Минимальный стек
Стартуем без жёсткой привязки: можно держать статический фронт или легкий Node/PHP-бэкенд. По мере реализации выберем конкретный runtime. Для генератора и API-клиента удобен Node.js.

## Деплой (общая схема)
1. Пуш в `main` → GitHub Actions.
2. CI прогоняет проверки (линты/тесты — добавим позже).
3. `rsync` по SSH выкладывает файлы в `/home/t/tdsta/avito.vsepeski.ru/public_html`.
4. `.env` хранится только на сервере, не коммитится.

## Секреты для CI (нужно завести в GitHub → Settings → Secrets → Actions)
- `DEPLOY_HOST` — `tdsta.beget.tech`
- `DEPLOY_USER` — `tdsta`
- `DEPLOY_PATH` — `/home/t/tdsta/avito.vsepeski.ru/public_html`
- `DEPLOY_KEY` — приватный SSH-ключ (формат PEM). Публичную часть положить на сервер в `~/.ssh/authorized_keys`.

## Быстрый старт (локально)
```bash
git clone https://github.com/Web-A1/avito.git
cd avito
# разработка, затем:
git add .
git commit -m "init"
git push origin main
```

## Дальше
- Определить точный стек (Node/PHP) и добавить сборку/линты.
- Добавить шаблоны объявлений, генератор текстов, клиент Avito API.
- Настроить A/B и логи модерации.
