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
   - Черновик: сбор карты правил и применение к объявлениям реализован (`crates/feed-core/src/update.rs`), вызывается в CLI (без автогенерации текстов).
   - CLI ищет `update_old_ads.json` по указанному пути, а если не найден — пробует `../update_old_ads.json` (удобно при запуске из `rust/`).

6. Генерация новых объявлений
   - Генерация adId по material/address/dateBegin/counter.
   - Привязка к `publicationQueue` (строгое соответствие позиций).
   - Использование фото из маппинга; ошибка, если нет фото для нужного adId.
   - Фолбек фото: если точного adId нет, берём первую запись с тем же materialAlias+cityAlias+counter (разные метки времени в маппинге).
   - Черновик: генерация adId, базовый выбор заголовков (EXACT/Top), требование фото для каждого слота (`crates/feed-core/src/generate.rs`, вызов в CLI).

7. Загрузка фото на Яндекс.Диск (Rust-обвязка)
   - HTTP через `reqwest` + ретраи/backoff: ensure folder, upload, publish, получить `public_url`.
   - Формирование объединённого `photos_links_*.json`.

8. Формирование XML и манифестов
   - Генератор XML на `quick-xml` (`crates/feed-core/src/xml.rs`), выводит поля из Excel + дефолты (Id/AvitoId/DateBegin/DateEnd/ListingFee/AdStatus/контакты/цена/упаковка/минимальный заказ/материал/характеристики/Images); Title/Description/Address/PriceFor/CompactionCoefficient теперь всегда присутствуют с пустыми значениями при их отсутствии.
   - Id: используется adId/Id/AvitoId или fallback `sand_<dateLabel>_<idx>`; `feed-cli` передает dateLabel в генератор.
   - AdStatus: берётся из AdStatus (или дефолт Free), AvitoStatus игнорируем (чтобы совпасть с JS).
   - RubbleType/Fraction/FlakinessIndex/ConcreteGrade/FrostResistance выводятся только для `BulkMaterialType="Щебень, гравий"` и `BulkMaterialSubType="Щебень"`, RubbleType/Fraction поддерживают извлечение из title/description как в JS.
   - Delivery: выводится, если задано (пока пустой дефолт).
   - `ImageUrls` используется как fallback для фото.
   - XML/манифест/build-log сохраняются (`feed-cli`): `ads_<label>.xml`, `ads_<label>_manifest.json`, `build-log_<label>.json`.
   - Следующее: сверить XML с JS выводом на образце и добить оставшиеся различия по шаблонам.

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
