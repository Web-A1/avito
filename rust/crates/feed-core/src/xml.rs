use once_cell::sync::Lazy;
use quick_xml::events::{BytesCData, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer;
use regex::Regex;
use std::io::Cursor;

use crate::{
    constants::{
        DEFAULT_AD_STATUS, DEFAULT_AD_TYPE, DEFAULT_AVAILABILITY, DEFAULT_BULK_MATERIAL_SUBTYPE,
        DEFAULT_COMPANY_NAME, DEFAULT_CONDITION, DEFAULT_CONTACT_METHOD, DEFAULT_CONTACT_PHONE,
        DEFAULT_EMAIL, DEFAULT_INTERNET_CALLS, DEFAULT_LISTING_FEE, DEFAULT_MANAGER_NAME,
        DEFAULT_MIN_SALE_QUANTITY, DEFAULT_PACKAGING_TYPE, DEFAULT_SERVICE_ROOM_TYPE,
        DEFAULT_SERVICE_WORK_DAYS, DEFAULT_TARGET_AUDIENCE,
        SELLER_ADDRESS_ALIASES, SELLER_ADDRESS_IDS,
    },
    Ad,
};

/// Генерирует XML Avito (форматVersion=3, target=Avito.ru).
/// `date_label` используется для fallback Id (`sand_<date>_<idx>`), если Id/AvitoId отсутствуют.
pub fn generate_xml(ads: &[Ad], date_label: Option<&str>) -> Result<String, String> {
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    start_elem(
        &mut writer,
        "Ads",
        &[("formatVersion", "3"), ("target", "Avito.ru")],
    )?;

    for (idx, ad) in ads.iter().enumerate() {
        write_ad(&mut writer, ad, idx, date_label)?;
    }

    end_elem(&mut writer, "Ads")?;
    let bytes = writer.into_inner().into_inner();
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

fn resolve_id(ad: &Ad, idx: usize, date_label: Option<&str>) -> String {
    if let Some(id) = ad
        .ad_id
        .as_ref()
        .or(ad.id.as_ref())
        .or(ad.avito_id.as_ref())
    {
        id.clone()
    } else if let Some(label) = date_label {
        format!("sand_{}_{}", label, idx + 1)
    } else {
        format!("sand_{}", idx + 1)
    }
}

fn write_ad(
    writer: &mut Writer<Cursor<Vec<u8>>>,
    ad: &Ad,
    idx: usize,
    date_label: Option<&str>,
) -> Result<(), String> {
    start_elem(writer, "Ad", &[])?;
    text_elem(writer, "Id", &resolve_id(ad, idx, date_label))?;
    if let Some(avito_id) = ad.avito_id.as_ref() {
        text_elem(writer, "AvitoId", avito_id)?;
    }
    if let Some(date_begin) = ad.date_begin.as_ref() {
        text_elem(writer, "DateBegin", date_begin)?;
    }
    if let Some(date_end) = ad.avito_date_end.as_ref() {
        text_elem(writer, "DateEnd", date_end)?;
    }
    if let Some(listing_fee) = ad.listing_fee.as_ref() {
        text_elem(writer, "ListingFee", listing_fee)?;
    } else {
        text_elem(writer, "ListingFee", DEFAULT_LISTING_FEE)?;
    }
    let status = ad.ad_status.as_deref().unwrap_or(DEFAULT_AD_STATUS);
    text_elem(writer, "AdStatus", status)?;
    let is_service = is_service_ad(ad);
    text_elem(
        writer,
        "ManagerName",
        ad.manager_name.as_deref().unwrap_or(DEFAULT_MANAGER_NAME),
    )?;
    text_elem(
        writer,
        "ContactPhone",
        ad.contact_phone.as_deref().unwrap_or(DEFAULT_CONTACT_PHONE),
    )?;
    if is_service {
        let category = ad
            .category
            .as_deref()
            .unwrap_or("Предложение услуг")
            .trim();
        if !category.is_empty() {
            text_elem(writer, "Category", category)?;
        }
    } else {
        text_elem(
            writer,
            "Category",
            ad.category.as_deref().unwrap_or("Ремонт и строительство"),
        )?;
    }
    let address = pick_address(ad);
    let seller_address_id = resolve_seller_address_id(address)?;
    text_elem(writer, "SellerAddressID", &seller_address_id)?;
    if is_service {
        if let Some(address) = address {
            text_elem(writer, "Address", address)?;
        }
        if let Some(latitude) = ad.latitude.as_deref() {
            if !latitude.trim().is_empty() {
                text_elem(writer, "Latitude", latitude)?;
            }
        }
        if let Some(longitude) = ad.longitude.as_deref() {
            if !longitude.trim().is_empty() {
                text_elem(writer, "Longitude", longitude)?;
            }
        }
    }
    text_elem(writer, "Title", ad.title.as_deref().unwrap_or(""))?;
    cdata_elem(
        writer,
        "Description",
        ad.description.as_deref().unwrap_or(""),
    )?;
    if let Some(price) = ad.price {
        text_elem(writer, "Price", &price.to_string())?;
    }
    let images = collect_images(ad.photo_link.as_ref(), ad.image_urls.as_deref());
    if images.is_empty() {
        return Err("Объявление должно содержать хотя бы одно изображение".into());
    }
    start_elem(writer, "Images", &[])?;
    for url in images {
        empty_elem(writer, "Image", &[("url", &url)])?;
    }
    end_elem(writer, "Images")?;
    text_elem(
        writer,
        "ContactMethod",
        ad.contact_method
            .as_deref()
            .unwrap_or(DEFAULT_CONTACT_METHOD),
    )?;
    if !is_service {
        text_elem(
            writer,
            "Delivery",
            ad.delivery
                .as_deref()
                .unwrap_or(crate::constants::DEFAULT_DELIVERY),
        )?;
    }
    text_elem(
        writer,
        "InternetCalls",
        ad.internet_calls
            .as_deref()
            .unwrap_or(DEFAULT_INTERNET_CALLS),
    )?;
    text_elem(
        writer,
        "EMail",
        ad.email.as_deref().unwrap_or(DEFAULT_EMAIL),
    )?;
    text_elem(
        writer,
        "CompanyName",
        ad.company_name.as_deref().unwrap_or(DEFAULT_COMPANY_NAME),
    )?;
    if is_service {
        if let Some(service_type) = ad.service_type.as_deref() {
            if !service_type.trim().is_empty() {
                text_elem(writer, "ServiceType", service_type)?;
            }
        }
        if let Some(service_subtype) = ad.service_subtype.as_deref() {
            if !service_subtype.trim().is_empty() {
                text_elem(writer, "ServiceSubtype", service_subtype)?;
            }
        }
        if let Some(waste_type) = ad.waste_type.as_deref() {
            if !waste_type.trim().is_empty() {
                text_elem(writer, "WasteType", waste_type)?;
            }
        }
        if let Some(value) = ad.same_day_pickup.as_deref() {
            if !value.trim().is_empty() {
                text_elem(writer, "SameDayPickup", value)?;
            }
        }
        if let Some(value) = ad.performers_on_the_team.as_deref() {
            if !value.trim().is_empty() {
                text_elem(writer, "PerformersOnTheTeam", value)?;
            }
        }
        if let Some(value) = ad.work_experience.as_deref() {
            if !value.trim().is_empty() {
                text_elem(writer, "WorkExperience", value)?;
            }
        }
        if let Some(value) = ad.work_with_legal_entities.as_deref() {
            if !value.trim().is_empty() {
                text_elem(writer, "WorkWithLegalEntities", value)?;
            }
        }
        let work_days = normalize_work_days(
            ad.work_days
                .as_deref()
                .unwrap_or(DEFAULT_SERVICE_WORK_DAYS),
        );
        if !work_days.trim().is_empty() {
            text_elem(writer, "WorkDays", &work_days)?;
        }
        if let Some(value) = ad.work_time_from.as_deref() {
            if !value.trim().is_empty() {
                text_elem(writer, "WorkTimeFrom", value)?;
            }
        }
        if let Some(value) = ad.work_time_to.as_deref() {
            if !value.trim().is_empty() {
                text_elem(writer, "WorkTimeTo", value)?;
            }
        }
        if let Some(value) = ad.minimum_order_amount.as_deref() {
            if !value.trim().is_empty() {
                text_elem(writer, "MinimumOrderAmount", value)?;
            }
        }
        if let Some(value) = ad.calls_devices.as_deref() {
            if !value.trim().is_empty() {
                text_elem(writer, "CallsDevices", value)?;
            }
        }
        if let Some(value) = ad.promo.as_deref() {
            if !value.trim().is_empty() {
                text_elem(writer, "Promo", value)?;
            }
        }
        if let Some(value) = ad.promo_auto_options.as_deref() {
            if !value.trim().is_empty() {
                text_elem(writer, "PromoAutoOptions", value)?;
            }
        }
        if let Some(value) = ad.promo_manual_options.as_deref() {
            if !value.trim().is_empty() {
                text_elem(writer, "PromoManualOptions", value)?;
            }
        }
        let room_type = ad
            .room_type
            .as_deref()
            .unwrap_or(DEFAULT_SERVICE_ROOM_TYPE);
        if !room_type.trim().is_empty() {
            text_elem(writer, "RoomType", room_type)?;
        }
    } else {
        text_elem(
            writer,
            "PackagingType",
            ad.packaging_type
                .as_deref()
                .unwrap_or(DEFAULT_PACKAGING_TYPE),
        )?;
        let compaction = ad
            .compaction_coefficient
            .map(|v| v.to_string())
            .unwrap_or_else(String::new);
        text_elem(writer, "CompactionCoefficient", &compaction)?;
        let min_sale = ad.min_sale_quantity.unwrap_or(DEFAULT_MIN_SALE_QUANTITY);
        text_elem(writer, "MinSaleQuantity", &min_sale.to_string())?;
        text_elem(writer, "PriceFor", ad.price_for.as_deref().unwrap_or(""))?;
        text_elem(
            writer,
            "GoodsType",
            ad.goods_type.as_deref().unwrap_or("Стройматериалы"),
        )?;
        text_elem(
            writer,
            "AdType",
            ad.ad_type.as_deref().unwrap_or(DEFAULT_AD_TYPE),
        )?;
        text_elem(
            writer,
            "Condition",
            ad.condition.as_deref().unwrap_or(DEFAULT_CONDITION),
        )?;
        text_elem(
            writer,
            "Availability",
            ad.availability.as_deref().unwrap_or(DEFAULT_AVAILABILITY),
        )?;
        text_elem(
            writer,
            "GoodsSubType",
            ad.goods_sub_type.as_deref().unwrap_or("Сыпучие материалы"),
        )?;
        let bulk_material_type = resolve_bulk_material_type(ad)?;
        let bulk_material_sub_type = ad
            .bulk_material_sub_type
            .as_deref()
            .unwrap_or(DEFAULT_BULK_MATERIAL_SUBTYPE);
        text_elem(writer, "BulkMaterialType", &bulk_material_type)?;
        text_elem(writer, "BulkMaterialSubType", bulk_material_sub_type)?;

        if bulk_material_type == "Щебень, гравий" && bulk_material_sub_type == "Щебень" {
            if let Some(rubble_type) = ad.rubble_type.clone().or_else(|| {
                extract_rubble_type_from_text(ad.title.as_deref(), ad.description.as_deref())
            }) {
                text_elem(writer, "RubbleType", &rubble_type)?;
            }

            if let Some(fraction) = ad
                .fraction
                .clone()
                .or_else(|| extract_fraction_from_text(ad.description.as_deref()))
            {
                text_elem(writer, "Fraction", &fraction)?;
            }

            if let Some(flakiness) = ad
                .flakiness_index
                .as_deref()
                .map(format_flakiness_index)
                .filter(|value| !value.is_empty())
            {
                text_elem(writer, "FlakinessIndex", &flakiness)?;
            }
            if let Some(concrete_grade) = ad.concrete_grade.as_ref() {
                text_elem(writer, "ConcreteGrade", concrete_grade)?;
            }
            if let Some(frost) = ad.frost_resistance.as_ref() {
                text_elem(writer, "FrostResistance", frost)?;
            }
        }
    }

    if let Some(color) = ad.color.as_ref() {
        text_elem(writer, "Color", color)?;
    }
    if !is_service {
        text_elem(
            writer,
            "TargetAudience",
            ad.target_audience
                .as_deref()
                .unwrap_or(DEFAULT_TARGET_AUDIENCE),
        )?;
    }
    end_elem(writer, "Ad")?;
    Ok(())
}

fn is_service_ad(ad: &Ad) -> bool {
    let category = ad.category.as_deref().unwrap_or("").to_lowercase();
    category.contains("услуг")
        || ad
            .service_type
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        || ad
            .service_subtype
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
        || ad
            .waste_type
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
}

fn normalize_work_days(value: &str) -> String {
    let raw = value.to_lowercase().replace('.', " ");
    let mut days = Vec::new();
    for token in raw.split(|c: char| !c.is_alphabetic()) {
        if token.is_empty() {
            continue;
        }
        let key = token.chars().take(2).collect::<String>();
        let mapped = match key.as_str() {
            "пн" => Some("пн."),
            "вт" => Some("вт."),
            "ср" => Some("ср."),
            "чт" => Some("чт."),
            "пт" => Some("пт."),
            "сб" => Some("сб."),
            "вс" => Some("вс."),
            _ => None,
        };
        if let Some(day) = mapped {
            if !days.contains(&day) {
                days.push(day);
            }
        }
    }
    if days.is_empty() {
        value.to_string()
    } else {
        days.join(" | ")
    }
}

fn pick_address(ad: &Ad) -> Option<&str> {
    ad.address.as_deref().and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{DEFAULT_AD_STATUS, DEFAULT_LISTING_FEE};

    fn base_ad() -> Ad {
        Ad {
            ad_id: Some("s00_troi_010123-100000_1".to_string()),
            address: Some("Троицк, Индустриальная улица, 1".to_string()),
            price: Some(1000.0),
            photo_link: Some("https://example.com/pic.jpg".to_string()),
            material_id: Some("karier_neseyan_nemyt_pesok".to_string()),
            bulk_material_type: Some("Песок".to_string()),
            bulk_material_sub_type: Some("Карьерный".to_string()),
            ..Ad::default()
        }
    }

    #[test]
    fn generates_xml_with_defaults_and_seller_address_id() {
        let xml =
            generate_xml(&[base_ad()], Some("010123")).expect("xml generation should succeed");
        assert!(
            xml.contains(&format!("<ListingFee>{}</ListingFee>", DEFAULT_LISTING_FEE)),
            "should include default ListingFee"
        );
        assert!(
            xml.contains(&format!("<AdStatus>{}</AdStatus>", DEFAULT_AD_STATUS)),
            "should include default AdStatus"
        );
        assert!(
            xml.contains("<Delivery>Свой курьер</Delivery>"),
            "should include default Delivery"
        );
        assert!(xml.contains("<Title></Title>"));
        assert!(xml.contains("<Description><![CDATA[]]></Description>"));
        assert!(
            xml.contains("<SellerAddressID>101431339</SellerAddressID>"),
            "SellerAddressID should be resolved from aliases"
        );
    }

    #[test]
    fn errors_when_no_images() {
        let mut ad = base_ad();
        ad.photo_link = None;
        ad.image_urls = None;
        let err = generate_xml(&[ad], Some("010123")).unwrap_err();
        assert!(err.contains("изображение"), "expected image error");
    }
}

fn resolve_bulk_material_type(ad: &Ad) -> Result<String, String> {
    if let Some(t) = ad.bulk_material_type.clone() {
        let trimmed = t.trim();
        if trimmed.is_empty() {
            return Err("BulkMaterialType пустой".into());
        }
        return Ok(trimmed.to_string());
    }

    Err("BulkMaterialType не задан".into())
}

fn resolve_seller_address_id(address: Option<&str>) -> Result<String, String> {
    let addr = address
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "SellerAddressID: адрес не указан".to_string())?;
    let canonical = SELLER_ADDRESS_ALIASES.get(addr).copied().unwrap_or(addr);
    if let Some(id) = SELLER_ADDRESS_IDS.get(canonical) {
        return Ok(id.to_string());
    }
    let available: Vec<&str> = SELLER_ADDRESS_IDS.keys().copied().collect();
    Err(format!(
        "SellerAddressID не найден для адреса \"{}\". Доступные адреса ({}): {}",
        addr,
        available.len(),
        available.join("; ")
    ))
}

fn start_elem(
    writer: &mut Writer<Cursor<Vec<u8>>>,
    name: &str,
    attrs: &[(&str, &str)],
) -> Result<(), String> {
    let mut elem = BytesStart::new(name);
    for (k, v) in attrs {
        elem.push_attribute((*k, *v));
    }
    writer
        .write_event(Event::Start(elem))
        .map_err(|e| e.to_string())
}

fn end_elem(writer: &mut Writer<Cursor<Vec<u8>>>, name: &str) -> Result<(), String> {
    writer
        .write_event(Event::End(BytesEnd::new(name)))
        .map_err(|e| e.to_string())
}

fn empty_elem(
    writer: &mut Writer<Cursor<Vec<u8>>>,
    name: &str,
    attrs: &[(&str, &str)],
) -> Result<(), String> {
    let mut elem = BytesStart::new(name);
    for (k, v) in attrs {
        elem.push_attribute((*k, *v));
    }
    writer
        .write_event(Event::Empty(elem))
        .map_err(|e| e.to_string())
}

fn text_elem(writer: &mut Writer<Cursor<Vec<u8>>>, name: &str, text: &str) -> Result<(), String> {
    start_elem(writer, name, &[])?;
    writer
        .write_event(Event::Text(BytesText::new(text)))
        .map_err(|e| e.to_string())?;
    end_elem(writer, name)
}

fn cdata_elem(writer: &mut Writer<Cursor<Vec<u8>>>, name: &str, text: &str) -> Result<(), String> {
    start_elem(writer, name, &[])?;
    writer
        .write_event(Event::CData(BytesCData::new(text)))
        .map_err(|e| e.to_string())?;
    end_elem(writer, name)
}

fn collect_images(primary: Option<&String>, fallback: Option<&str>) -> Vec<String> {
    if let Some(p) = primary {
        return vec![p.clone()];
    }
    let mut res = Vec::new();
    if let Some(f) = fallback {
        for part in f.split(|c| c == ',' || c == ';' || c == ' ') {
            let trimmed = part.trim();
            if !trimmed.is_empty() {
                res.push(trimmed.to_string());
            }
        }
    }
    res
}

fn extract_rubble_type_from_text(title: Option<&str>, description: Option<&str>) -> Option<String> {
    let mut text = String::new();
    if let Some(t) = title {
        text.push_str(t);
        text.push(' ');
    }
    if let Some(d) = description {
        text.push_str(d);
    }
    let text = text.to_lowercase();
    let mappings = [
        ("вторичный", "Вторичный"),
        ("гравийный", "Гравийный"),
        ("гранитный", "Гранитный"),
        ("известняковый", "Известняковый"),
        ("известковый", "Известняковый"),
        ("бутовый", "Бутовый"),
        ("мраморный", "Мраморный"),
    ];
    for (keyword, value) in mappings {
        if text.contains(keyword) {
            return Some(value.to_string());
        }
    }
    None
}

fn extract_fraction_from_text(description: Option<&str>) -> Option<String> {
    static FRACTION_MM_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?i)(\d+)[–-](\d+)\s*мм").expect("fraction mm regex"));
    static FRACTION_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?i)(\d+)[–-](\d+)").expect("fraction regex"));
    let description = description?;
    if let Some(caps) = FRACTION_MM_RE.captures(description) {
        let min = caps.get(1)?.as_str();
        let max = caps.get(2)?.as_str();
        return Some(format!("{}–{} мм", min, max));
    }
    if let Some(caps) = FRACTION_RE.captures(description) {
        let min = caps.get(1)?.as_str();
        let max = caps.get(2)?.as_str();
        return Some(format!("{}–{} мм", min, max));
    }
    None
}

fn format_flakiness_index(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.to_lowercase().contains("группа") {
        trimmed.to_string()
    } else if trimmed.is_empty() {
        String::new()
    } else {
        format!("{} группа", trimmed)
    }
}
