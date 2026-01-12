# План перехода на Rust (с сохранением текущего JS до готовности)

Последовательность шагов в `rust/`. Текущий JS-пайплайн не трогаем, пока Rust не станет эквивалентным.

1. Каркас — сделано
   - Workspace `rust/`, `crates/feed-core`, `crates/feed-cli`, базовый `cargo check`.

2. Доменные модели / ввод данных / валидации — готово на базовом уровне
   - Модели: `Plan`, `Task`, `PublicationSlot`, `Location`, `Aliases`, `UpdateRules`, `UpdateRule`, `UpdateByLists`, `Ad`, `PhotoMapping` (`crates/feed-core/src/plan.rs`).
   - Константы: `MATERIAL_ALIASES`, `CITY_ALIASES`, `TOP_5_TITLES`, `EXACT_TITLES`, `ZHIROSHINO_TITLES` (`crates/feed-core/src/constants.rs`).
   - Конфиг окон/шага: `config/feed.json`, загрузчик `FeedConfig` (`crates/feed-core/src/config.rs`).
   - Чтение: `read_plan`, `read_update_rules` (`crates/feed-core/src/read.rs`); `read_ads_from_excel` (`crates/feed-core/src/excel.rs`).
   - Excel-ридер подхватывает DateEnd/ListingFee/AdStatus/контакты/характеристики.
   - Валидации плана: counts, окна времени, шаги, парсинг дат (`crates/feed-core/src/validate.rs`), используют `FeedConfig`.

3. CLI — каркас готов
   - `feed-cli` читает .env, `--plan` (по умолчанию `data/plan.json`), `--current-dir` (`data/current`), `--config` (`config/feed.json`); валидирует counts/окна/шаги. Код: `crates/feed-cli/src/cli.rs`.
   - Следующее: добавить флаги/логику для `updateRules`, шагов генерации/загрузки/XML.

4. Фото (первый этап)
   - Вызов существующих JS-скриптов генерации/загрузки фото через `std::process::Command`.
   - Чтение итогового `photos_links_*.json` для маппинга adId → URL.
   - Обвязка вызовов JS и чтения маппинга подготовлена в `crates/feed-cli/src/photo.rs`; запускается опционально флагом `--photos`.
   - Можно читать готовый `photos_links_*.json` без запуска JS через `--photos-mapping`.
   - Поддержка формата маппинга с `avitoId` или именем файла (`fileName`/`file`) → URL.
   - В JS-пайплайне `npm run build:feed` при нанесении водяного знака учитываются индивидуальные настройки прозрачности из `data/watermark-overrides.json` (для каждого исходника). При переносе фото-этапа на Rust это нужно воспроизвести.

5. Обновление старых объявлений
   - Применить `updateRules` к объявлениям из Excel: фото (по маппингу), заголовки, описания, адреса.
   - Учесть флагманские объявления (counter = 1) при генерации id/параметров.
   - Карта правил (`crates/feed-core/src/update.rs`) повторяет updateAll из JS: создаёт правила для всех объявлений Excel, восстанавливает materialId/address по алиасам adId или полям Excel, нормализует адреса до канонических newAddress, byId перекрывает byLists. Применение в CLI: авто-описания по материалу, случайный выбор customTitle из списка, проверка адреса против CITY_ALIASES, нормализация priceFor. Покрыто unit-тестами apply_updates.
   - CLI ищет `update_old_ads.json` по указанному пути, а если не найден — пробует `../update_old_ads.json` (удобно при запуске из `rust/`).

6. Генерация новых объявлений
   - Генерация adId по material/address/dateBegin/counter (без паддинга счётчика, учитывает алиасы адресов для adId).
   - Привязка к `publicationQueue` (строгое соответствие позиций).
   - Использование фото из маппинга; ошибка, если нет фото для нужного adId.
   - Фолбек фото: если точного adId нет, берём первую запись с тем же materialAlias+cityAlias+counter (разные метки времени в маппинге).
   - Реализовано: распределение заголовков TOP/Zhiroshino/Exact (70/15/15, первый слот — Exact), цены 50/50±10% на связку материал+адрес (с валидацией), MinSale/Compaction/Color из справочников, PriceFor “тонну”. Требование фото для каждого слота (`crates/feed-core/src/generate.rs`, вызов в CLI). Юнит-тесты генерации (точное фото, фолбек по алиасам, ошибка без фото) добавлены. Нужно сверить с JS по результату.

7. Загрузка фото на Яндекс.Диск (Rust-обвязка)
   - HTTP через `reqwest` + ретраи/backoff: ensure folder, upload, publish, получить `public_url`.
   - Формирование объединённого `photos_links_*.json`.
   - Добавлен клиент Я.Диска (`crates/feed-core/src/yandex.rs`) с ретраями и тестами моков; интеграция в CLI: флаг `--upload-rust` загружает фото из `--photos-dir` на Диск и пишет `photos_links_<label>.json`, YANDEX_DISK_TOKEN обязателен.
   - Rust-генерация фото: `generate_plan_photos` собирает исходники из `data/photos/<material>/originals`, распределяет counts по адресам плана (учитывает алиасы адресов), имена файлов вида `<mat>_<variant>_<city>_<date>_<idx>.jpg`, первый кадр без искажений, остальные — лёгкие трансформации/паттерн и текстовый ватермарк. Настройки текста/цвета/opacity/паттерна и overrides (`data/watermark-overrides.json`) поддерживаются. CLI: `--photos-rust` + `--photos-root`/`--photos-dir`/`--photos-default-count` и флаги прозрачности/текста.
   - Следующее: переписать генерацию фото на Rust с учетом водяных знаков, `watermark-overrides.json`, формата имён/вариантов и проверки уникальных `_1`. После этого отказаться от JS `generate-photo-variants.js`.
   - Для водяных знаков: поддержка точечных overrides по исходникам (`watermark-overrides.json`), утилита-превью для подбора opacity/цвета/текста (генерация сетки вариантов), автогенерация шаблона overrides для каталога исходников.
   - Добавлен генератор шаблона overrides (`feed-cli --make-wm-template "<glob>"`) и превью водяных знаков (`--photos-preview ... --preview-opacities ...`) для ручного подбора прозрачности по исходникам. В Rust-генератор добавлена базовая уникализация через aHash (до 6 попыток на вариант) и паттерн-оверлей. Остаётся довести до уровня JS (история/более сложные паттерны) и утвердить полный отказ от JS `generate-photo-variants.js`.

8. Проверка XML
   - Добавлен флаг `--xml-compare <file>` в `feed-cli`: после генерации сравнивает итоговый XML с эталоном (без учёта пробелов), помогает сверять с JS.
   - Следующее: получить/сохранить эталонный XML (JS) и сравнить вывод Rust, устранить расхождения.

8. Формирование XML и манифестов
   - Генератор XML на `quick-xml` (`crates/feed-core/src/xml.rs`), выводит поля из Excel + дефолты (Id/AvitoId/DateBegin/DateEnd/ListingFee/AdStatus/контакты/цена/упаковка/минимальный заказ/характеристики/Images); Title/Description/PriceFor/CompactionCoefficient теперь всегда присутствуют с пустыми значениями при их отсутствии. Address в XML не пишем, только SellerAddressID (обязательный).
   - BulkMaterialType обязателен (берётся только из данных объявления, без дефолтов из materialId). RubbleType/Fraction/FlakinessIndex/ConcreteGrade/FrostResistance выводятся только для `BulkMaterialType="Щебень, гравий"` и `BulkMaterialSubType="Щебень"`, RubbleType/Fraction поддерживают извлечение из title/description как в JS.
   - Id: используется adId/Id/AvitoId или fallback `sand_<dateLabel>_<idx>`; `feed-cli` передает dateLabel в генератор.
   - AdStatus: берётся из AdStatus (или дефолт Free), AvitoStatus игнорируем (чтобы совпасть с JS).
   - Delivery: теперь обязательное поле, выводим всегда со значением `Свой курьер` (или из объявления), добавлено и в JS и в Rust.
   - XML/манифест/build-log сохраняются (`feed-cli`): `ads_<label>.xml`, `ads_<label>_manifest.json`, `build-log_<label>.json`.
   - Юнит-тесты генерации XML (дефолты, SellerAddressID, ошибка без картинок) добавлены. Следующее: сверить XML с JS выводом на образце и добить оставшиеся различия по шаблонам. В генерации добавлены цены 50/50±10%, MinSale/Compaction/Color из справочников, распределение заголовков TOP/Zhiroshino/Exact 70/15/15 с Exact на первом слоте; фото-мэппинг понимает JS имена с 5 частями. Валидации доли базовых цен и уникальности чистых фото (_1) уже в CLI. Остаётся подтянуть Excel-объявления к справочникам.

### Ближайшие шаги по описаниям (чтобы совпасть с JS)
1. Оценить соответствие latinizator/рандома чисел блока 7 с JS на образце (один прогон и визуальное сравнение).
2. Перегенерировать XML и сравнить с JS-эталоном (`output/ads_22.12.xml`), зафиксировать остаточные расхождения и устранить.

9. Тестирование
   - Юнит: валидации плана, парсинг дат, генерация adId, ретраи HTTP.
   - Интеграционные: фиктивный план → мок загрузок → проверка adId/dateBegin/фото-маппинга → XML содержит все объявления.

10. Проверка эквивалентности
   - Сравнить вывод Rust и JS на одном плане; зафиксировать процедуру в README Rust-папки.

11. Готовность к замене
   - Обновить инструкции запуска; при желании заменить вызовы JS-скриптов на чистый Rust (после эквивалентности).
   - Оставить старый JS до подтверждения стабильной работы Rust-версии.

12. Plan-builder (UI)
   - Текущая версия достаточна; новые UI-доработки не планируются до завершения эквивалентности Rust-пайплайна.

### Фокус по переходу на Rust (в целом)
1. Довести генерацию фото в Rust до полного соответствия JS (паттерны, уникализация, ватермарки).
2. Сверить XML с JS-эталоном на одном плане, зафиксировать остаточные расхождения и устранить.
3. Сверить итоговый полный прогон (Excel → обновления → генерация → XML) и зафиксировать процедуру в README.
