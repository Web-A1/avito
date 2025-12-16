# Быстрое тестирование build-feed.js

## Быстрый старт

### 1. Тест чтения данных (шаги 1-3)

```bash
npm run build:feed -- \
  --plan data/plan.json \
  --current-dir data/current \
  --test-step 1-3
```

**Проверьте:**
- ✅ План прочитан
- ✅ Excel прочитан (если есть)
- ✅ Правила обновления прочитаны (если есть)

### 2. Тест генерации фото для старых объявлений (шаг 4, без загрузки)

```bash
npm run build:feed -- \
  --plan data/plan.json \
  --current-dir data/current \
  --update-rules update_old_ads.json \
  --test-step 4 \
  --skip-upload
```

**Проверьте:**
- ✅ Фото созданы в `data/photos/<materialId>/temp_updates/`
- ✅ Файлы имеют имена `AvitoId.jpg`
- ✅ Фото содержат водяной знак

### 3. Тест генерации фото для новых объявлений (шаг 5)

```bash
npm run build:feed -- \
  --plan data/plan.json \
  --test-step 5
```

**Проверьте:**
- ✅ Фото созданы в `data/photos/<materialId>/variants/`
- ✅ Количество соответствует плану

### 4. Тест обновления описаний (шаг 7, без фото)

```bash
npm run build:feed -- \
  --plan data/plan.json \
  --current-dir data/current \
  --update-rules update_old_ads.json \
  --test-step 7 \
  --skip-photos
```

**Проверьте:**
- ✅ Описания обновлены для объявлений с `updateDescription: "auto"`
- ✅ Заголовки обновлены для объявлений с `customTitle`

### 5. Тест генерации новых объявлений (шаг 8, без фото)

```bash
npm run build:feed -- \
  --plan data/plan.json \
  --current-dir data/current \
  --test-step 8 \
  --skip-photos \
  --skip-updates
```

**Проверьте:**
- ✅ Сгенерировано N новых объявлений
- ✅ Объявления имеют все необходимые поля

### 6. Тест формирования XML (шаг 9, без генерации)

```bash
npm run build:feed -- \
  --plan data/plan.json \
  --current-dir data/current \
  --update-rules update_old_ads.json \
  --test-step 9 \
  --skip-photos \
  --skip-updates \
  --skip-generation
```

**Проверьте:**
- ✅ XML файл создан
- ✅ XML валидный (можно проверить через `xmllint`)

### 7. Полный прогон в режиме dry-run

```bash
npm run build:feed -- \
  --plan data/plan.json \
  --current-dir data/current \
  --update-rules update_old_ads.json \
  --dry-run
```

**Проверьте:**
- ✅ Все шаги выполнены
- ✅ Логи показывают, что было бы сделано
- ✅ Файлы не изменены

## Полезные флаги

- `--test-step N` - выполнить только шаг N
- `--test-step N-M` - выполнить шаги с N по M
- `--skip-photos` - пропустить все операции с фото
- `--skip-upload` - пропустить загрузку на Яндекс.Диск
- `--skip-new-photos` - пропустить генерацию фото для новых объявлений
- `--skip-old-photos` - пропустить обновление фото для старых объявлений
- `--skip-updates` - пропустить обновление описаний/заголовков
- `--skip-generation` - пропустить генерацию новых объявлений
- `--dry-run` - режим тестирования (не изменяет файлы)
- `--test-output-dir <dir>` - использовать отдельную папку для тестовых файлов

## Примеры комбинаций

### Только чтение и валидация данных
```bash
npm run build:feed -- --plan data/plan.json --current-dir data/current --test-step 1-3
```

### Генерация фото без загрузки
```bash
npm run build:feed -- --plan data/plan.json --test-step 4-5 --skip-upload
```

### Обновление данных без фото
```bash
npm run build:feed -- --plan data/plan.json --current-dir data/current --update-rules update_old_ads.json --test-step 7 --skip-photos
```

### Полный тест без реальных изменений
```bash
npm run build:feed -- --plan data/plan.json --current-dir data/current --update-rules update_old_ads.json --dry-run
```

## Проверка результатов

### Проверка фото
```bash
# Старые объявления
ls -la data/photos/karier_neseyan_nemyt_pesok/temp_updates/

# Новые объявления
ls -la data/photos/karier_neseyan_nemyt_pesok/variants/*/
```

### Проверка маппинга фото
```bash
cat output/photos_links_*.json | jq '.items | length'
cat output/photos_links_*.json | jq '.items[] | select(.avitoId)'
```

### Проверка XML
```bash
# Валидация XML
xmllint --noout output/ads_*.xml

# Количество объявлений
grep -c "<Ad>" output/ads_*.xml
```

## Типичные проблемы

**"План не найден"** → Проверьте путь к плану
**"Excel не найден"** → Убедитесь, что файл в папке `data/current/`
**"YANDEX_DISK_TOKEN не найден"** → Используйте `--skip-upload` или установите переменную
**"Не указан materialId"** → Добавьте `materialId` в правила обновления



