use serde::{Deserialize, Serialize};

/// Алиасы материалов и адресов из плана.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Aliases {
    #[serde(default)]
    pub materials: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub addresses: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub photos: std::collections::HashMap<String, String>,
}

/// Задача публикации для конкретного материала.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Task {
    #[serde(rename = "materialId", default)]
    pub material_id: String,
    /// Альтернативное поле material (для совместимости).
    #[serde(default)]
    pub material: Option<String>,
    /// Альтернативный ключ фото (для планов со своей структурой папок).
    #[serde(rename = "photoKey", default)]
    pub photo_key: Option<String>,
    /// Переопределение даты начала для задачи.
    #[serde(rename = "DateBegin", default)]
    pub date_begin: Option<String>,
    #[serde(default)]
    pub count: u32,
    #[serde(default)]
    pub locations: Vec<Location>,
    /// Старое поле addresses (для совместимости).
    #[serde(default)]
    pub addresses: Option<Vec<Location>>,
    /// Слоты с отдельными count/locations (как в JS-плане).
    #[serde(default)]
    pub slots: Option<Vec<TaskSlot>>,
    /// Пользовательские заголовки, если заданы.
    #[serde(default)]
    pub titles: Option<Vec<String>>,
    /// Заранее заданные фото.
    #[serde(default)]
    pub photos: Option<Vec<String>>,
}

/// Локация с количеством объявлений.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Location {
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub count: u32,
    #[serde(default)]
    pub percent: Option<f64>,
    #[serde(default)]
    pub addr: Option<String>,
}

/// Слот внутри задачи (опционально, как в JS-плане).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TaskSlot {
    #[serde(rename = "DateBegin", default)]
    pub date_begin: Option<String>,
    #[serde(default)]
    pub count: u32,
    #[serde(default)]
    pub locations: Vec<Location>,
}

/// Очередь публикаций с фиксированными временными слотами.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PublicationSlot {
    #[serde(rename = "DateBegin", default)]
    pub date_begin: String,
    #[serde(rename = "materialId", default)]
    pub material_id: String,
    /// Альтернативное поле material (для совместимости).
    #[serde(default)]
    pub material: Option<String>,
    #[serde(default)]
    pub location: String,
}

/// План публикаций, формируемый план-билдером.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Plan {
    #[serde(rename = "DateBegin", default)]
    pub date_begin: String,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(rename = "publicationQueue", default)]
    pub publication_queue: Vec<PublicationSlot>,
    #[serde(default)]
    pub aliases: Option<Aliases>,
}

/// Правила обновления для старых объявлений.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateRules {
    #[serde(rename = "byLists", default)]
    pub by_lists: Option<UpdateByLists>,
    #[serde(rename = "byId", default)]
    pub by_id: Option<std::collections::HashMap<String, UpdateRule>>,
}

/// Групповые правила из списков.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateByLists {
    #[serde(default)]
    pub update_photo: Vec<String>,
    #[serde(default)]
    pub update_description: Vec<String>,
    #[serde(default)]
    pub custom_titles: std::collections::HashMap<String, Vec<String>>,
    #[serde(default)]
    pub custom_descriptions: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub new_addresses: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub update_all: Option<bool>,
    #[serde(default)]
    pub update_description_for_all: Option<bool>,
}

/// Конкретное правило обновления по id.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateRule {
    #[serde(rename = "updatePhoto", default)]
    pub update_photo: Option<bool>,
    #[serde(rename = "updateDescription", default)]
    pub update_description: Option<UpdateDescription>,
    #[serde(rename = "customTitle", default)]
    pub custom_title: Option<CustomTitle>,
    #[serde(rename = "newAddress", default)]
    pub new_address: Option<String>,
    #[serde(rename = "materialId", default)]
    pub material_id: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UpdateDescription {
    Auto(String), // "auto"
    Manual(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CustomTitle {
    Single(String),
    List(Vec<String>),
}

/// Объявление в Excel или генерируемое.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Ad {
    #[serde(rename = "Id", default)]
    pub id: Option<String>,
    #[serde(rename = "AvitoId", default)]
    pub avito_id: Option<String>,
    #[serde(rename = "AvitoStatus", default)]
    pub avito_status: Option<String>,
    #[serde(rename = "AvitoDateEnd", default)]
    pub avito_date_end: Option<String>,
    #[serde(rename = "ListingFee", default)]
    pub listing_fee: Option<String>,
    #[serde(rename = "Category", default)]
    pub category: Option<String>,
    #[serde(rename = "GoodsType", default)]
    pub goods_type: Option<String>,
    #[serde(rename = "GoodsSubType", default)]
    pub goods_sub_type: Option<String>,
    #[serde(rename = "adId", default)]
    pub ad_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "Condition", default)]
    pub condition: Option<String>,
    #[serde(rename = "DateBegin", default)]
    pub date_begin: Option<String>,
    #[serde(rename = "Location", alias = "location", default)]
    pub location: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(rename = "photoLink", default)]
    pub photo_link: Option<String>,
    #[serde(rename = "ImageUrls", default)]
    pub image_urls: Option<String>,
    #[serde(default)]
    pub material_id: Option<String>,
    #[serde(default)]
    pub price: Option<f64>,
    #[serde(rename = "priceFor", default)]
    pub price_for: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(rename = "CompactionCoefficient", default)]
    pub compaction_coefficient: Option<f64>,
    #[serde(rename = "CompanyName", default)]
    pub company_name: Option<String>,
    #[serde(rename = "ConcreteGrade", default)]
    pub concrete_grade: Option<String>,
    #[serde(rename = "FlakinessIndex", default)]
    pub flakiness_index: Option<String>,
    #[serde(rename = "Fraction", default)]
    pub fraction: Option<String>,
    #[serde(rename = "FrostResistance", default)]
    pub frost_resistance: Option<String>,
    #[serde(rename = "MinSaleQuantity", default)]
    pub min_sale_quantity: Option<u32>,
    #[serde(rename = "PackagingType", default)]
    pub packaging_type: Option<String>,
    #[serde(rename = "RubbleType", default)]
    pub rubble_type: Option<String>,
    #[serde(rename = "TargetAudience", default)]
    pub target_audience: Option<String>,
    #[serde(rename = "BulkMaterialSubType", default)]
    pub bulk_material_sub_type: Option<String>,
    #[serde(rename = "BulkMaterialType", default)]
    pub bulk_material_type: Option<String>,
    #[serde(rename = "ContactPhone", default)]
    pub contact_phone: Option<String>,
    #[serde(rename = "EMail", default)]
    pub email: Option<String>,
    #[serde(rename = "ContactMethod", default)]
    pub contact_method: Option<String>,
    #[serde(rename = "AdType", default)]
    pub ad_type: Option<String>,
    #[serde(rename = "Availability", default)]
    pub availability: Option<String>,
    #[serde(rename = "ManagerName", default)]
    pub manager_name: Option<String>,
    #[serde(rename = "AdStatus", default)]
    pub ad_status: Option<String>,
    #[serde(rename = "InternetCalls", default)]
    pub internet_calls: Option<String>,
    #[serde(rename = "Delivery", default)]
    pub delivery: Option<String>,
    #[serde(rename = "ServiceType", default)]
    pub service_type: Option<String>,
    #[serde(rename = "ServiceSubtype", default)]
    pub service_subtype: Option<String>,
    #[serde(rename = "WasteType", default)]
    pub waste_type: Option<String>,
    #[serde(rename = "SameDayPickup", default)]
    pub same_day_pickup: Option<String>,
    #[serde(rename = "PerformersOnTheTeam", default)]
    pub performers_on_the_team: Option<String>,
    #[serde(rename = "RoomType", default)]
    pub room_type: Option<String>,
    #[serde(rename = "WorkExperience", default)]
    pub work_experience: Option<String>,
    #[serde(rename = "WorkWithLegalEntities", default)]
    pub work_with_legal_entities: Option<String>,
    #[serde(rename = "WorkDays", default)]
    pub work_days: Option<String>,
    #[serde(rename = "WorkTimeFrom", default)]
    pub work_time_from: Option<String>,
    #[serde(rename = "WorkTimeTo", default)]
    pub work_time_to: Option<String>,
    #[serde(rename = "MinimumOrderAmount", default)]
    pub minimum_order_amount: Option<String>,
    #[serde(rename = "CallsDevices", default)]
    pub calls_devices: Option<String>,
    #[serde(rename = "Promo", default)]
    pub promo: Option<String>,
    #[serde(rename = "PromoAutoOptions", default)]
    pub promo_auto_options: Option<String>,
    #[serde(rename = "PromoManualOptions", default)]
    pub promo_manual_options: Option<String>,
    #[serde(rename = "Latitude", default)]
    pub latitude: Option<String>,
    #[serde(rename = "Longitude", default)]
    pub longitude: Option<String>,
    /// Вспомогательное поле: цена взята ровно по базе (для распределения долей).
    #[serde(rename = "useBasePrice", default)]
    pub use_base_price: Option<bool>,
}

/// Маппинг фото: avitoId → public_url.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PhotoMapping {
    #[serde(default)]
    pub date: Option<String>,
    #[serde(rename = "diskRoot", default)]
    pub disk_root: Option<String>,
    #[serde(rename = "diskPath", default)]
    pub disk_path: Option<String>,
    #[serde(default)]
    pub items: Vec<PhotoMappingItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PhotoMappingItem {
    #[serde(rename = "avitoId", default, skip_serializing_if = "Option::is_none")]
    pub avito_id: Option<String>,
    #[serde(rename = "file", default, alias = "fileName")]
    pub file_name: Option<String>,
    #[serde(rename = "public_url", default)]
    pub public_url: Option<String>,
}

/// Общие временные окна публикации (перечень минут от начала суток).
pub const ALLOWED_WINDOWS: &[(u16, u16)] = &[
    (7 * 60, 10 * 60),       // 07:00–10:00
    (19 * 60, 23 * 60 + 59), // 19:00–23:59
];

/// Минимальный и максимальный шаг между публикациями (минуты).
pub const MIN_STEP_MIN: u16 = 5;
pub const MAX_STEP_MIN: u16 = 30;
