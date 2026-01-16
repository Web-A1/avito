use std::path::Path;

use calamine::{open_workbook_auto, Reader};

use crate::Ad;

/// Читает первый лист Excel с объявлениями Авито.
/// Возвращает вектор Ad с заполненными полями по именам колонок.
pub fn read_ads_from_excel(path: impl AsRef<Path>) -> Result<Vec<Ad>, String> {
    let path_ref = path.as_ref();
    let mut workbook = open_workbook_auto(path_ref)
        .map_err(|e| format!("Не удалось открыть Excel {}: {}", path_ref.display(), e))?;

    let range = workbook
        .worksheet_range_at(0)
        .ok_or_else(|| "Не найден первый лист в Excel".to_string())?
        .map_err(|e| format!("Ошибка чтения листа: {}", e))?;

    let mut ads = Vec::new();
    let mut headers: Vec<String> = Vec::new();

    for (row_idx, row) in range.rows().enumerate() {
        if row_idx == 0 {
            headers = row.iter().map(|c| c.to_string()).collect();
            continue;
        }
        let mut ad = Ad::default();
        for (col_idx, cell) in row.iter().enumerate() {
            let key = headers.get(col_idx).map(|s| s.as_str()).unwrap_or("");
            let val = cell.to_string();
            if val.is_empty() {
                continue;
            }
            match key {
                "Id" => ad.id = Some(val),
                "AvitoId" => ad.avito_id = Some(val),
                "AvitoStatus" => ad.avito_status = Some(val),
                "AdStatus" | "adStatus" => ad.ad_status = Some(val),
                "AvitoDateEnd" | "DateEnd" | "dateEnd" => ad.avito_date_end = Some(val),
                "ListingFee" | "listingFee" => ad.listing_fee = Some(val),
                "ImageUrls" => ad.image_urls = Some(val.clone()),
                "ImageUrl" => ad.image_urls = Some(val.clone()),
                "adId" => ad.ad_id = Some(val),
                "Title" | "title" => ad.title = Some(val),
                "Description" | "description" => ad.description = Some(val),
                "DateBegin" => ad.date_begin = Some(val),
                "Location" | "location" => ad.location = Some(val),
                "Address" | "address" => ad.address = Some(val),
                "Photo" | "PhotoLink" | "photoLink" => ad.photo_link = Some(val),
                "MaterialId" | "materialId" => ad.material_id = Some(val),
                "Price" | "price" => {
                    let normalized = val.replace(',', ".");
                    ad.price = normalized.parse().ok()
                }
                "useBasePrice" | "UseBasePrice" => {
                    ad.use_base_price = Some(val == "true" || val == "1")
                }
                "PriceFor" | "priceFor" => ad.price_for = normalize_price_for_value(&val),
                "Color" | "color" => ad.color = Some(val),
                "ManagerName" | "managerName" => ad.manager_name = Some(val),
                "CompanyName" | "companyName" => ad.company_name = Some(val),
                "ContactPhone" | "contactPhone" => ad.contact_phone = Some(val),
                "ContactMethod" | "contactMethod" => ad.contact_method = Some(val),
                "InternetCalls" | "internetCalls" => ad.internet_calls = Some(val),
                "EMail" | "Email" | "email" => ad.email = Some(val),
                "AdType" | "adType" => ad.ad_type = Some(val),
                "Condition" | "condition" => ad.condition = Some(val),
                "Availability" | "availability" => ad.availability = Some(val),
                "TargetAudience" | "targetAudience" => ad.target_audience = Some(val),
                "BulkMaterialSubType" | "bulkMaterialSubType" => {
                    ad.bulk_material_sub_type = Some(val)
                }
                "BulkMaterialType" | "bulkMaterialType" => ad.bulk_material_type = Some(val),
                "RubbleType" | "rubbleType" => ad.rubble_type = Some(val),
                "Fraction" | "fraction" => ad.fraction = Some(val),
                "FlakinessIndex" | "flakinessIndex" => ad.flakiness_index = Some(val),
                "ConcreteGrade" | "concreteGrade" => ad.concrete_grade = Some(val),
                "FrostResistance" | "frostResistance" => ad.frost_resistance = Some(val),
                "MinSaleQuantity" | "minSaleQuantity" => ad.min_sale_quantity = val.parse().ok(),
                "PackagingType" | "packagingType" => ad.packaging_type = Some(val),
                "CompactionCoefficient" | "compactionCoefficient" => {
                    ad.compaction_coefficient = val.parse().ok()
                }
                "Delivery" | "delivery" => ad.delivery = Some(val),
                "ServiceType" => ad.service_type = Some(val),
                "ServiceSubtype" => ad.service_subtype = Some(val),
                "WasteType" => ad.waste_type = Some(val),
                "SameDayPickup" => ad.same_day_pickup = Some(val),
                "PerformersOnTheTeam" => ad.performers_on_the_team = Some(val),
                "RoomType" => ad.room_type = Some(val),
                "WorkExperience" => ad.work_experience = Some(val),
                "WorkWithLegalEntities" => ad.work_with_legal_entities = Some(val),
                "WorkDays" => ad.work_days = Some(val),
                "WorkTimeFrom" => ad.work_time_from = Some(val),
                "WorkTimeTo" => ad.work_time_to = Some(val),
                "MinimumOrderAmount" => ad.minimum_order_amount = Some(val),
                "CallsDevices" => ad.calls_devices = Some(val),
                "Promo" => ad.promo = Some(val),
                "PromoAutoOptions" => ad.promo_auto_options = Some(val),
                "PromoManualOptions" => ad.promo_manual_options = Some(val),
                "Latitude" => ad.latitude = Some(val),
                "Longitude" => ad.longitude = Some(val),
                _ => {}
            }
        }
        // Пропускаем пустые строки без Id/AvitoId и прочих данных
        let has_data = ad.id.is_some()
            || ad.avito_id.is_some()
            || ad.title.is_some()
            || ad.description.is_some()
            || ad.address.is_some()
            || ad.photo_link.is_some()
            || ad.ad_id.is_some();
        if has_data {
            ads.push(ad);
        }
    }

    Ok(ads)
}

fn normalize_price_for_value(value: &str) -> Option<String> {
    let normalized = value.to_lowercase();
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed == "тонну" || trimmed == "тонна" || trimmed == "т" || trimmed == "tonnu" {
        return Some("тонну".to_string());
    }
    if trimmed == "м³"
        || trimmed == "м3"
        || trimmed == "м^3"
        || trimmed.contains('м')
        || trimmed.contains("куб")
    {
        return Some("м³".to_string());
    }
    Some(value.to_string())
}
