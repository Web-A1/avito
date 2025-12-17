# Команды для пошаговой проверки build-feed.js

## Проверка по шагам (накопительно)

### Шаг 1: Чтение плана
```bash
npm run build:feed -- --test-step 1
```

### Шаги 1-2: Чтение плана + Чтение текущих объявлений из Excel
```bash
npm run build:feed -- --test-step 1-2
```

### Шаги 1-3: Чтение плана + Excel + Правила обновления
```bash
npm run build:feed -- --test-step 1-3
```

### Шаги 1-4: + Обновление фото для старых объявлений
```bash
npm run build:feed -- --test-step 1-4
```

### Шаги 1-5: + Генерация фото для новых объявлений
```bash
npm run build:feed -- --test-step 1-5
```

### Шаги 1-6: + Загрузка всех фото на Яндекс.Диск
```bash
npm run build:feed -- --test-step 1-6
```

### Шаги 1-7: + Обновление описаний и заголовков для старых объявлений
```bash
npm run build:feed -- --test-step 1-7
```

### Шаги 1-8: + Генерация новых объявлений
```bash
npm run build:feed -- --test-step 1-8
```

### Шаги 1-9: + Формирование финального XML
```bash
npm run build:feed -- --test-step 1-9
```

### Шаги 1-10: Полный цикл (включая синхронизацию истории)
```bash
npm run build:feed -- --test-step 1-10
```

## Альтернативные варианты

### Проверка без загрузки на Яндекс.Диск (для шагов 1-5)
```bash
npm run build:feed -- --test-step 1-5 --skip-upload
```

### Проверка без генерации фото (для шагов 1-3, 7-9)
```bash
npm run build:feed -- --test-step 1-3,7-9 --skip-photos
```

### Dry-run режим (без изменений файлов)
```bash
npm run build:feed -- --dry-run
```





