# Структура API Авито

Цель: единый, понятный для ИИ конспект всех разделов Avito API. Для каждого раздела фиксируем назначение, авторизацию/скоупы, лимиты, группы эндпоинтов, ключевые модели и особые замечания. Заполняем данные из swagger JSON, которые сохраняются в `docs/swagger/*.json`.

## Как использовать
- Добавьте swagger файла раздела в `docs/swagger/<name>.json`.
- Пройдитесь по шаблону раздела ниже и заполните поля из спеки.
- Проверяйте авторизацию (OAuth2 типы и скоупы), лимиты, деприкейты.
- Для ИИ: придерживайся формата разделов и не придумывай данные, если их нет в swagger.

## Оглавление
- [Иерархия Аккаунтов](#иерархия-аккаунтов)
- [Авито Реклама](#авито-реклама)
- [CPA-аукцион](#cpa-аукцион)
- [Авторизация](#авторизация)
- [Автозагрузка](#автозагрузка)
- [Автостратегия](#автостратегия)
- [Автотека](#автотека)
- [CallTracking[KT]](#calltrackingkt)
- [CPA Авито](#cpa-авито)
- [Настройка цены целевого действия](#настройка-цены-целевого-действия)
- [Доставка](#доставка)
- [Объявления](#объявления)
- [Авито.Работа](#авиторабота)
- [Мессенджер](#мессенджер)
- [Управление заказами](#управление-заказами)
- [Рейтинги и отзывы](#рейтинги-и-отзывы)
- [Аналитика по недвижимости](#аналитика-по-недвижимости)
- [Рассылка скидок и спецпредложений в мессенджере (beta-version)](#рассылка-скидок-и-спецпредложений-в-мессенджере-beta-version)
- [Управление остатками](#управление-остатками)
- [Краткосрочная аренда](#краткосрочная-аренда)
- [Тарифы](#тарифы)
- [TrxPromo](#trxpromo)
- [Информация о пользователе](#информация-о-пользователе)

---

## Шаблон для каждого раздела
- **Назначение:** кратко, что дает раздел.
- **Базовый URL:** обычно `https://api.avito.ru/` (уточнить в swagger).
- **Спека:** путь к swagger-файлу.
- **Авторизация/скоупы:** типы OAuth, обязательные скоупы, заголовки.
- **Лимиты:** rate limits, специальные ограничения (глубина дат, размер списков).
- **Группы эндпоинтов:** логические блоки (например, Информация, Управление, Статистика), с перечислением методов.
- **Ключевые модели:** важные запросы/ответы.
- **Важные примечания:** деприкейты, особенности по категориям, поведения для сотрудников и т.д.

---

## Иерархия Аккаунтов
- **Назначение:** Управление иерархией аккаунтов: статус пользователя, сотрудники, линковка объявлений к сотрудникам, телефоны компании, выбор объявлений по сотруднику.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/accounts-hierarchy.json` (OpenAPI 3.0, тег `Ah`, v1)
- **Авторизация/скоупы:** OAuth2 Bearer; скоуп `ah:access`; заголовки `Authorization`, `X-Oauth-Scopes`, `X-Oauth-Flow`. В тарифе ИА — требуется платный тариф (по описаниям методов).
- **Лимиты:** Не указаны в swagger.
- **Группы эндпоинтов:**
  - Статус/профиль: `GET /checkAhUserV1` — статус пользователя в иерархии (`isCompany`, `isEmployee`, `isChief`, `avitoCompanyId`).
  - Сотрудники: `GET /getEmployeesV1` — список сотрудников компании (id, имя, email, телефоны, признак руководителя).
  - Телефоны: `GET /listCompanyPhonesV1` — список телефонов компании.
  - Линковка объявлений: `POST /linkItemsV1` — привязка объявлений к сотруднику / перенос между сотрудниками (body `LinkItems`: `employeeId`, `itemIds` ≤ 50).
  - Объявления по сотруднику: `POST /listItemsByEmployeeIdV1` — список объявлений по сотруднику с фильтром по категории и пагинацией по курсору (`employeeId`, `categoryId`, опц. `lastItemId`, заголовок `X-Is-Employee` для запроса от имени сотрудника).
- **Ключевые модели:** `GetEmployeesResult` (массив сотрудников), `CompanyPhonesResult`, `LinkItems`, `ListItemsByEmployeeIdBody`, `ListItemsByEmployeeIdResult` (items, hasNext), ошибки `OpenApiError`.
- **Важные примечания:** Требуется тариф ИА; `linkItems` ограничение 50 itemIds; `listItemsByEmployeeId` — выбор только по сотруднику (не по компании), поддерживает курсорную пагинацию через `lastItemId`.

## Авито Реклама
- **Назначение:** Получение информации об аккаунте рекламодателя (юридические данные, контакты, менеджер).
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/ads.json` (OpenAPI 3.0, v1.0.0)
- **Авторизация/скоупы:** OAuth2 ClientCredentials (Bearer); скоупы не перечислены отдельно в swagger.
- **Лимиты:** `x-rate-limiter` 500 rpm; заголовок ответа `Api-Point-Balance` (баланс API баллов).
- **Группы эндпоинтов:**
  - Аккаунт: `GET /ads/v1/account/{accountID}` — получить аккаунт по ID.
- **Ключевые модели:** `Account` (inn, ogrn, kpp, legalAddress, actualAddress, shortName, longName, contact{name,phone}, manager{name,email}); `V1GetAccountByIdOut` (account); `Error` (code, message).
- **Важные примечания:** Единичный метод чтения; учитывайте лимиты и баланс API-баллов из заголовка `Api-Point-Balance`.

## CPA-аукцион
- **Назначение:** Управление ставками CPA-аукциона для объявлений (получение доступных/текущих ставок, сохранение ставок).
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/auction.json` (OpenAPI 3.0, v1, тег `CPA-аукцион`)
- **Авторизация/скоупы:** OAuth2 Bearer; скоуп `cpa-auction:bids` для AuthorizationCode; также ClientCredentials.
- **Лимиты:** 200 rpm для обоих методов; заголовки `X-RateLimit-Limit`, `X-RateLimit-Remaining` при 429.
- **Группы эндпоинтов:**
  - Ставки (чтение): `GET /auction/1/bids` — действующие и доступные ставки по объявлениям; пагинация через `fromItemID` (default 0) + `batchSize` (max 200).
  - Ставки (запись): `POST /auction/1/bids` — сохранить ставки по объявлениям (до 200 items); `itemID`, `pricePenny`, опц. `expirationTime` (RFC3339, null — бессрочно).
- **Ключевые модели:** ответ списка ставок (`items`: `itemID`, `pricePenny`, `expirationTime`, `availablePrices[{pricePenny, goodness}]`); запрос на установку ставок (`items[{itemID, pricePenny, expirationTime?}]`); ошибки `badRequest`, `unauthorized`, `tooManyRequestsError`, `internalError`.
- **Важные примечания:** Цена в копейках; `expirationTime` может быть пустым для бессрочной ставки; максимум 200 объявлений за запрос.

## Авторизация
- **Назначение:** OAuth2 токены для доступа ко всем разделам API (персональная авторизация и авторизация приложений).
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/auth.json` (OpenAPI 3.0, v1, теги `Access`, `ApplicationAccess`)
- **Авторизация/скоупы:** Не требует предварительной авторизации. Запросы `application/x-www-form-urlencoded`.
- **Лимиты:** Не указаны в swagger.
- **Группы эндпоинтов:**
  - Персональная авторизация: `POST /token` — `grant_type=client_credentials`, тело `GetTokenRequest` (`client_id`, `client_secret`, `grant_type`). Ответ: `access_token`, `expires_in`, `token_type`.
  - Авторизация приложений: `POST /token‎` — `grant_type=authorization_code`, тело `GetTokenOAuthRequest` (`client_id`, `client_secret`, `code`). Ответ: `access_token`, `refresh_token`, `expires_in`, `scope`, `token_type`.
  - Обновление токена приложения: `POST /token‎‎` — `grant_type=refresh_token`, тело `RefreshRequest` (`client_id`, `client_secret`, `refresh_token`). Ответ: новый `access_token`, `refresh_token`, `expires_in`, `scope`, `token_type`.
- **Ключевые модели:** `GetTokenRequest`, `GetTokenOAuthRequest`, `RefreshRequest`; ответы с полями `access_token`, `refresh_token`, `expires_in`, `scope`, `token_type`.
- **Важные примечания:** В swagger встречаются пути `/token` с невидимыми символами; фактически это разные флоу: client_credentials, authorization_code и refresh_token. Используйте соответствующий `grant_type` и тело запроса.

## Автозагрузка
- **Назначение:** Управление профилем автозагрузки, запуск выгрузок по фиду, соответствие ID объявлений, отчёты по выгрузкам.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/autoload.json` (OpenAPI 3.0, v1, тег `Autoload`)
- **Авторизация/скоупы:** OAuth2 Bearer; AuthorizationCode (множественные скоупы в схеме, ключевой — `autoload:reports` для отчётов) и ClientCredentials. Заголовок `Authorization`.
- **Лимиты:** В descr: upload — не чаще 1 раза в час; некоторые ответы содержат rate-limit хедеры на 429; явных rpm нет.
- **Группы эндпоинтов:**
  - Профиль: `GET/POST /autoload/v2/profile` — получить/создать/обновить профиль (autoload_enabled, schedule, report_email, feeds_data). v1 `/autoload/v1/profile` — deprecated (использовать v2).
  - Запуск выгрузки: `POST /autoload/v1/upload` — запустить выгрузку файла по ссылке из настроек.
  - Справочники: `GET /autoload/v1/user-docs/tree` — дерево категорий; `GET /autoload/v1/user-docs/node/{node_slug}/fields` — поля категории (оба без явного деприкейта).
  - ID сопоставление: `GET /autoload/v2/items/avito_ids` — Avito ID по ad_id из файла; `GET /autoload/v2/items/ad_ids` — ad_id по Avito ID (query — строка ID через запятую/«|»).
  - Отчёты (v2): `GET /autoload/v2/reports` — список отчётов (пагинация, фильтры date_from/date_to); `GET /autoload/v2/reports/items` — объявления по ID в автозагрузке; `GET /autoload/v2/reports/{report_id}/items` — объявления из конкретной выгрузки; `GET /autoload/v2/reports/{report_id}/items/fees` — списания за объявления; `GET /autoload/v2/reports/last_completed_report` и `GET /autoload/v2/reports/{report_id}` — статистика (deprecated, заменены v3).
  - Отчёты (v3): `GET /autoload/v3/reports/last_completed_report` — статистика по последней выгрузке; `GET /autoload/v3/reports/{report_id}` — статистика по конкретной выгрузке.
- **Ключевые модели:** `UpsertProfileInV2` (agreement, autoload_enabled, schedule, report_email, feeds_data), `FeedsData` (имя и ссылка на фид), `ExportSchedule` (cron/периодичность), `ReportAutoloadV3` (events, feeds_urls, finished_at, published/not_published, uploaded, errors), `ReportShortAutoloadV2` + `MetaReportsAutoloadV2` (пагинация), `FieldErrorV2` (ошибки), маппинги ID (`items[{ad_id,avito_id}]`).
- **Важные примечания:** v1 профиль — deprecated; статистика v2 deprecated — использовать v3; загрузка по ссылке — максимум одна выгрузка в час и не учитывает лимиты публикаций из настроек; с 23.12.2024 поля `upload_url/feed_url` заменены на `feeds_data/feeds_urls`.

## Автостратегия
- **Статус:** Не используется в текущей интеграции (раздел не заполняем).

## Автотека
- **Статус:** Не используется в текущей интеграции (раздел не заполняем).

## CallTracking[KT]
- **Назначение:** Доступ к звонкам CallTracking: список звонков, детали по ID, получение аудиозаписи.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/calltracking.json` (OpenAPI 3.0, v1, тег `CallTracking`)
- **Авторизация/скоупы:** OAuth2 ClientCredentials (Bearer); скоупы не перечислены отдельно в схеме.
- **Лимиты:** `x-rate-limiter` 5 rpm для получения звонков/по ID, 50 rpm для записи; запись доступна 3 месяца, появляется с задержкой до 30 минут.
- **Группы эндпоинтов:**
  - Звонки по времени: `POST /calltracking/v1/getCalls/` — фильтр по `dateTimeFrom` (RFC3339), опц. `dateTimeTo` (до +3 мес., по умолчанию +1 мес.), `limit`≤100, `offset`.
  - Звонок по ID: `POST /calltracking/v1/getCallById/` — тело `callId`.
  - Запись звонка: `GET /calltracking/v1/getRecordByCallId/` — query `callId`, ответ audio/mpeg с заголовками `Content-Type`, `Content-Length`.
- **Ключевые модели:** `Call` (структура звонка), `GetCallsResponse` (calls[], error), `GetCallByIdResponse`, `GetCallRecordError` (коды 0,1000–1005).
- **Важные примечания:** Запись может быть недоступна сразу (код 425 Too early); держится до 3 месяцев; лимит выборки 100, временной интервал max 3 месяца.

## CPA Авито
- **Назначение:** Доступ к целевым звонкам/чатам, жалобам и балансу CPA; получение записей, метаданных и информации о балансе.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/cpa.json` (OpenAPI 3.0, v1, тег `Cpa`)
- **Авторизация/скоупы:** OAuth2 Bearer; скоупы явно не перечислены в swagger (обычно `cpa:*`). Методы используют POST/GET с authHeader.
- **Лимиты:** Примеры из описаний: callsByTime v2 — 1 rpm; chatsByTime v2 — 40 rpm; balance v3 — 50 rpm; другие — не указаны. Проверяйте 429.
- **Группы эндпоинтов:**
  - Звонки: `POST /cpa/v2/callsByTime` — звонки по времени (body `CallsByTime`: `dateTimeFrom`, опц. `limit`, `offset`); `POST /cpa/v2/callById` — звонок по ID (deprecated). v1 `/cpa/v1/call/{call_id}` — запись звонка (deprecated).
  - Чаты: `POST /cpa/v2/chatsByTime` — чаты по времени (body `OpenAPIChatsByTimeV2In`); v1 `GET /cpa/v1/chatByActionId/{actionId}` — чат по actionId; v1 `POST /cpa/v1/chatsByTime` — deprecated.
  - Жалобы: `POST /cpa/v1/createComplaint` — жалоба по звонкам; `POST /cpa/v1/createComplaintByActionId` — жалоба по звонкам/чатам.
  - Телефоны из чатов: `POST /cpa/v1/phonesInfoFromChats` — вернуть номера телефонов из целевых чатов.
  - Баланс: `POST /cpa/v3/balanceInfo` — текущий баланс в копейках (актуально); `POST /cpa/v2/balanceInfo` — deprecated.
- **Ключевые модели:** `CallsByTime`, `CallV2`, `OpenAPIChatsByTimeV2In`, модели чатов (`OpenApiChatsComposition`, `ChatV2`), `CpaError`, балансовый ответ (`balance` int), структуры жалоб и телефонов (по схемам v1), ошибки 429/400/401/403/404.
- **Важные примечания:** Используйте v2 для звонков/чатов, v3 для баланса; соблюдайте лимиты (1 rpm на callsByTime, 40 rpm на chatsByTime, 50 rpm на balance); deprecated методы v1/v2 отмечены. Для `balanceInfo` требуется передать `{}` в теле для валидации.

## Настройка цены целевого действия
- **Назначение:** Управление ценой целевого действия (CPX) и бюджетами для объявлений: просмотр ставок, автопромо, ручные цены, остановка продвижения.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/cpxpromo.json` (OpenAPI 3.0, v1, тег «Настройка цены целевого действия»)
- **Авторизация/скоупы:** OAuth2 Bearer; authHeader, скоупы не указаны явно (ориентир — промо/CPX).
- **Лимиты:** Примеры из описаний: getBids 20 rpm; setManual 20 rpm; setAuto 10 rpm; remove 300 rpm; getPromotionsByItemIds 400 rpm.
- **Группы эндпоинтов:**
  - Просмотр: `GET /cpxpromo/1/getBids/{itemId}` — детальные действующие/доступные цены и бюджеты по объявлению.
  - Массовый просмотр: `POST /cpxpromo/1/getPromotionsByItemIds` — текущие цены/бюджеты по списку объявлений (до 200).
  - Управление ценой: `POST /cpxpromo/1/setManual` — ручная цена и лимит трат (в копейках); `POST /cpxpromo/1/setAuto` — автоматическое продвижение (бюджет в копейках, срок 1d/7d/30d, нельзя в категории «Транспорт»).
  - Остановка: `POST /cpxpromo/1/remove` — остановить продвижение, вернуть цены прайс-листа.
- **Ключевые модели:** `getBidsOut` (доступные/текущие цены, бюджеты, преимущества), `getPromotionsByItemIdsIn`, `ManualBid`, `AutoBid` (budget, period), `RemovePromotion`.
- **Важные примечания:** Все цены/бюджеты в копейках; лимит 200 itemIds в массовом запросе; соблюдайте rpm; для ручной цены она должна быть выше минимальной из getBids; автопромо не доступно в «Транспорт».

## Доставка
- **Назначение:** Песочница доставки: создание/отмена анонсов и посылок, трекинг, тарифные данные, тестовые сценарии.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/delivery-sandbox.json` (OpenAPI 3.0, v1, теги DeliveryTariffication/TerminalManagement/ParcelProcessing/XDelivery/DeliverySandbox)
- **Авторизация/скоупы:** OAuth2 Bearer (authHeader); скоупы не указаны явным списком.
- **Лимиты:** Не указаны явно; смотреть ответы/429.
- **Группы эндпоинтов (sandbox):**
  - Базовые: `POST /createAnnouncement`, `POST /cancelAnnouncement`, `POST /createParcel`.
  - Sandbox анонсы: `POST /delivery-sandbox/announcements/create`, `POST /delivery-sandbox/announcements/track`, `POST /delivery-sandbox/v1/createAnnouncement`, `POST /delivery-sandbox/v1/cancelAnnouncement`, `POST /delivery-sandbox/v1/getAnnouncementEvent`.
  - Sandbox посылки: `POST /delivery-sandbox/v1/createParcel`, `POST /delivery-sandbox/v1/cancelParcel`, `POST /delivery-sandbox/v1/changeParcel`, `POST /delivery-sandbox/v1/getParcelInfo`, `POST /delivery-sandbox/v1/getRegisteredParcelID`, `POST /delivery-sandbox/v1/getChangeParcelInfo`, `POST /sandbox/changeParcels`, `POST /delivery/order/changeParcelResult`.
  - Трекинг/подтверждение: `POST /delivery-sandbox/order/tracking`, `POST /delivery-sandbox/order/checkConfirmationCode`, `POST /delivery-sandbox/order/properties`, `POST /delivery-sandbox/order/realAddress`, `POST /delivery-sandbox/order/tracking` (track), `POST /delivery-sandbox/prohibitOrderAcceptance`.
  - Тарифы и терминалы: `GET /delivery-sandbox/sorting-center`, `POST /delivery-sandbox/tariffs/sorting-center`, `POST /delivery-sandbox/tariffs/{tariff_id}/areas`, `POST /delivery-sandbox/tariffs/{tariff_id}/tagged-sorting-centers`, `POST /delivery-sandbox/tariffs/{tariff_id}/terminals`, `POST /delivery-sandbox/tariffs/{tariff_id}/terms`, `POST /delivery-sandbox/tariffsV2`, `GET /delivery-sandbox/tasks/{task_id}`.
  - XDelivery (v2): `POST /delivery-sandbox/v2/createParcel`.
- **Ключевые модели:** Описаны в swagger: анонсы/посылки (идентификаторы, статусы, свойства), тарифные сущности (терминалы, области, теги), трекинг/код подтверждения; ошибки FieldError.
- **Важные примечания:** Это sandbox-ручки для тестирования доставки; проверяйте обязательные тела запросов (часто требуется целый объект даже для пустого `{}`); следите за версиями (v1/v2) и задачами тарификации через `tasks/{task_id}`.

## Объявления
- **Назначение:** Работа с объявлениями: получение, продвижение (VAS), управление ценой, статистика.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/item.json` (OpenAPI 3.0)
- **Авторизация/скоупы:** OAuth2 Bearer; `items:info`, `items:apply_vas`, `stats:read`.
- **Лимиты:** Примерно 500 rpm (детали объявления), 25 rpm (список), 150 rpm (обновление цены), 1 rpm (analytics v2). Заголовки `X-RateLimit-Limit`, `X-RateLimit-Remaining`.
- **Группы эндпоинтов:**
  - Информация: `GET /core/v1/accounts/{user_id}/items/{item_id}/`, `GET /core/v1/items`.
  - VAS: `POST /core/v1/accounts/{userId}/vas/prices`, `PUT /core/v2/items/{itemId}/vas/` (актуальный), устаревшие `vas` v1 и `vas_packages`.
  - Управление: `POST /core/v1/items/{item_id}/update_price`.
  - Статистика: `POST /core/v1/accounts/{user_id}/calls/stats/`, `POST /stats/v1/accounts/{user_id}/items`, `POST /stats/v2/accounts/{user_id}/items`.
- **Ключевые модели:** `ItemInfoAvito`, `ItemsInfoWithCategoryAvito`, `VasPricesResp`, `ApplyVasResp`, `UpdatePriceRequest/Response`, `CallsStatsRequest/Response`, `StatisticsShallowRequestBody/StatisticsResponse`, `AnalyticsRequest/Response`.
- **Важные примечания:** Deprecated VAS v1 и vas_packages; `GET /core/v1/items` не работает для объявлений сотрудников; статистика/аналитика — глубина 270 дней, ограничение 200 itemIds (stats v1), до 1000 сущностей (stats v2); категории ограничения для обновления цены (товары/запчасти/авто/недвижимость без краткосрочной).

## Авито.Работа
- **Статус:** Не используется в текущей интеграции (раздел не заполняем).

## Мессенджер
- **Назначение:** Работа с чатами Авито: чтение чатов/сообщений, отправка сообщений (текст/картинки/голос), вебхуки, blacklist.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/messenger.json` (OpenAPI 3.0, v1–v3, тег `Messenger`)
- **Авторизация/скоупы:** OAuth2 Bearer; типы AuthorizationCode/ClientCredentials (см. общую схему в других спеках), скоупы: `messenger:read`, `messenger:write` (по общей политике Avito).
- **Лимиты:** Не указаны в swagger; учитывать 429.
- **Группы эндпоинтов:**
  - Чаты: `GET /messenger/v2/accounts/{user_id}/chats` — список чатов; `GET /messenger/v2/accounts/{user_id}/chats/{chat_id}` — инфо по чату.
  - Сообщения: `GET /messenger/v3/accounts/{user_id}/chats/{chat_id}/messages/` — список сообщений (v3); `POST /messenger/v1/accounts/{user_id}/chats/{chat_id}/messages` — отправка текста; `POST /.../messages/image` — отправка с изображением; `POST /.../messages/{message_id}` — удаление сообщения.
  - Голос/файлы: `GET /messenger/v1/accounts/{user_id}/getVoiceFiles` — получить голосовые сообщения; `POST /messenger/v1/accounts/{user_id}/uploadImages` — загрузка изображений.
  - Прочтение/blacklist: `POST /messenger/v1/accounts/{user_id}/chats/{chat_id}/read` — отметить чат прочитанным; `POST /messenger/v2/accounts/{user_id}/blacklist` — добавить пользователя в blacklist.
  - Вебхуки: `POST /messenger/v1/subscriptions` — получить подписки (webhooks); `POST /messenger/v1/webhook/unsubscribe` — отключить; `POST /messenger/v3/webhook` — включение уведомлений v3.
- **Ключевые модели:** Сообщения (text/image), чаты (id, participants, last message), голосовые файлы, структуры вебхуков; использовать схемы из спеки (`MessengerMessage`, `Chat`, и т.п.).
- **Важные примечания:** Использовать v3 для получения сообщений, v2 для чатов; для отправки изображений сначала загружаются файлы (`uploadImages`), затем отправляется message/image; следите за нужным user_id/ chat_id в пути.

## Управление заказами
- **Назначение:** Управление заказами (доставка/самовывоз): статусы, трек-номер, временные окна, этикетки, честный знак.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/order-management.json` (OpenAPI 3.0, v1.0.0)
- **Авторизация/скоупы:** OAuth2 Bearer (authHeader); скоупы не перечислены (ориентир — доставка/заказы).
- **Лимиты:** Не указаны в swagger; учитывать 429.
- **Группы эндпоинтов:**
  - Заказы: `GET /order-management/1/orders` — список заказов.
  - Статусы/переходы: `POST /order-management/1/order/applyTransition` — смена статуса; `POST /order-management/1/order/checkConfirmationCode` — проверка кода; `POST /order-management/1/order/acceptReturnOrder` — выбор отделения для возврата; `POST /order-management/1/order/cncSetDetails` — подготовка заказа самовывоз.
  - Курьер: `GET /order-management/1/order/getCourierDeliveryRange` — доступные слоты; `POST /order-management/1/order/setCourierDeliveryRange` — выбрать слот.
  - Трекинг/доставка: `POST /order-management/1/order/setTrackingNumber` — передача трек-номера.
  - Этикетки: `POST /order-management/1/orders/labels` (до 100) и `/orders/labels/extended` (до 1000) — создание задачи генерации; `GET /order-management/1/orders/labels/{taskID}/download` — скачать PDF.
  - Маркировка: `POST /order-management/1/markings` — передача «честного знака».
- **Ключевые модели:** Заказ/статус (см. схемы), модели слотов доставки, структуры заявок на этикетки (taskID), модели «честного знака», ошибки `ErrorResponse`.
- **Важные примечания:** Соблюдать лимиты по количеству заказов в задачах этикеток (100/1000); применяйте нужные ID заказа/задачи; для слотов доставки сначала получить доступные, затем выбрать.

## Рейтинги и отзывы
- **Назначение:** Управление рейтингом и отзывами пользователя: получение рейтинга, отзывов, ответы на отзывы.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/ratings.json` (OpenAPI 3.0, v1, тег `Ratings`)
- **Авторизация/скоупы:** OAuth2 Bearer; скоупы не перечислены (ориентир — ratings/reviews).
- **Лимиты:** Не указаны в swagger.
- **Группы эндпоинтов:**
  - Рейтинг: `GET /ratings/v1/info` — информация о рейтинге пользователя.
  - Отзывы: `GET /ratings/v1/reviews` — список активных отзывов (пагинация).
  - Ответы: `POST /ratings/v1/answers` — отправка ответа на отзыв; `DELETE /ratings/v1/answers/{answer_id}` — удаление ответа.
- **Ключевые модели:** `RatingInfo`, `Review` (соответствующие схемы в swagger), `Answer` (ответ на отзыв), ошибки `FieldError/Errors`.
- **Важные примечания:** При работе с ответами используйте корректный `answer_id`; пагинация для списка отзывов; следите за актуальностью скоупов для чтения/записи.

## Аналитика по недвижимости
- **Статус:** Не используется в текущей интеграции (раздел не заполняем).

## Рассылка скидок и спецпредложений в мессенджере (beta-version)
- **Статус:** Не используется в текущей интеграции (раздел не заполняем).

## Управление остатками
- **Статус:** Не используется в текущей интеграции (раздел не заполняем).

## Краткосрочная аренда
- **Статус:** Не используется в текущей интеграции (раздел не заполняем).

## Тарифы
- **Назначение:** Получение информации по тарифам (категория «Транспорт», не CPA).
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/tariff.json` (OpenAPI 3.0, v1, тег `Tariff`)
- **Авторизация/скоупы:** OAuth2 ClientCredentials (authHeader).
- **Лимиты:** Не указаны в swagger.
- **Группы эндпоинтов:** `GET /tariff/info/1` — информация по тарифу (current/scheduled тариф, бонусы, пакеты, цены, сроки).
- **Ключевые модели:** `TariffInfo` (current, scheduled: bonus, isActive, level, packages{categories, locations, priceConditions, remain/total}, price, start/closeTime).
- **Важные примечания:** Доступно только для тарифов «Транспорт», тариф не должен быть CPA.

## TrxPromo
- **Назначение:** Управление промо по транзакционной модели: запуск/остановка и проверка комиссий.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/trxpromo.json` (OpenAPI 3.0, v1, тег `TrxPromo`)
- **Авторизация/скоупы:** OAuth2 Bearer (authHeader); скоупы не указаны явно.
- **Лимиты:** Не указаны в swagger.
- **Группы эндпоинтов:** `POST /trx-promo/1/apply` — запуск продвижения; `POST /trx-promo/1/cancel` — остановка; `GET /trx-promo/1/commissions` — доступность и размер комиссий.
- **Ключевые модели:** Комиссии/статусы из схемы (`commissions`, применимость).
- **Важные примечания:** Все суммы/комиссии смотреть в копейках; убедиться в доступности промо перед применением.

## Информация о пользователе
- **Назначение:** Информация о пользователе, баланс и история операций кошелька.
- **Базовый URL:** `https://api.avito.ru/`
- **Спека:** `docs/swagger/user.json` (OpenAPI 3.0, v1, тег `User`)
- **Авторизация/скоупы:** OAuth2 Bearer (authHeader); скоупы: `user:read`, `user_balance:read`, `user_operations:read` (см. общую схему в автозагрузке).
- **Лимиты:** Не указаны в swagger.
- **Группы эндпоинтов:** `GET /core/v1/accounts/self` — инфо об авторизованном пользователе; `GET /core/v1/accounts/{user_id}/balance/` — баланс кошелька; `POST /core/v1/accounts/operations_history/` — история операций (тело с фильтрами/пагинацией).
- **Ключевые модели:** Профиль пользователя, баланс (amount, currency), `operations_history` (список операций, даты, суммы).
- **Важные примечания:** Для истории операций требуется тело запроса; баланс и операции зависят от прав/скоупов.
