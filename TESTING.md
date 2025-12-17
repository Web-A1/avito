# Тестирование build-feed.js

## Базовое тестирование структуры

### 1. Проверка чтения плана
```bash
npm run build:feed -- --plan data/plan.json
```
**Ожидаемый результат:** Скрипт читает план, находит задачи

### 2. Проверка чтения Excel
```bash
npm run build:feed -- --plan data/plan.json --current-dir data/current
```
**Ожидаемый результат:** Скрипт читает Excel (может быть 0 объявлений, если файл пустой)

### 3. Проверка чтения правил обновления
```bash
# Создайте update_old_ads.json в корне проекта (пример: update_old_ads.json.example)
npm run build:feed -- --plan data/plan.json --current-dir data/current
```
**Ожидаемый результат:** Скрипт находит правила обновления и показывает их количество

### 4. Полный тест (без реальных операций)
```bash
npm run build:feed -- --plan data/plan.json --current-dir data/current --date 11.12
```
**Ожидаемый результат:** 
- ✅ Читает план
- ✅ Читает Excel
- ✅ Читает правила обновления
- ⚠️ Пропускает шаги с TODO (это нормально, они еще не реализованы)

## Что уже работает

✅ Чтение плана из `data/plan.json`
✅ Чтение текущих объявлений из Excel (`data/current/*.xlsx`)
✅ Чтение правил обновления из `update_old_ads.json`
✅ Парсинг гибридного формата правил (byId + byLists)
✅ Базовая структура всех шагов

## Что еще нужно реализовать

⚠️ Генерация фото для новых объявлений
⚠️ Обновление фото для старых объявлений (частично готово)
⚠️ Загрузка фото на Яндекс.Диск
⚠️ Обновление описаний/заголовков для старых объявлений
⚠️ Генерация новых объявлений
⚠️ Формирование финального XML

## Формат update_old_ads.json

```json
{
  "byId": {
    "AvitoId": {
      "updatePhoto": true,
      "updateDescription": "auto" | "Ручное описание...",
      "customTitle": "Заголовок" | ["Вариант 1", "Вариант 2"],
      "newAddress": "Бронницы, Магистральная ул., 3",
      "materialId": "karier_neseyan_nemyt_pesok"
    }
  },
  "byLists": {
    "updatePhoto": ["AvitoId1", "AvitoId2"],
    "updateDescription": ["AvitoId1"],
    "customTitles": {
      "AvitoId1": "Заголовок"
    },
    "customDescriptions": {
      "AvitoId1": "Описание..."
    },
    "newAddresses": {
      "AvitoId1": "Адрес"
    }
  }
}
```

**Приоритет:** Правила из `byId` перезаписывают правила из `byLists` для одного и того же AvitoId.






