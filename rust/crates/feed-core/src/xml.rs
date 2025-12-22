use once_cell::sync::Lazy;
use quick_xml::events::{BytesCData, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer;
use regex::Regex;
use std::io::Cursor;

use crate::{
    constants::{
        DEFAULT_AD_STATUS, DEFAULT_AD_TYPE, DEFAULT_AVAILABILITY, DEFAULT_BULK_MATERIAL_SUBTYPE, DEFAULT_COMPANY_NAME,
        DEFAULT_CONDITION, DEFAULT_CONTACT_METHOD, DEFAULT_CONTACT_PHONE, DEFAULT_DELIVERY, DEFAULT_EMAIL,
        DEFAULT_INTERNET_CALLS, DEFAULT_LISTING_FEE, DEFAULT_MANAGER_NAME, DEFAULT_MIN_SALE_QUANTITY,
        DEFAULT_PACKAGING_TYPE, DEFAULT_TARGET_AUDIENCE,
    },
    Ad,
};

/// Генерирует XML Avito (форматVersion=3, target=Avito.ru).
pub fn generate_xml(ads: &[Ad]) -> Result<String, String> {
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    start_elem(&mut writer, "Ads", &[("formatVersion", "3"), ("target", "Avito.ru")])?;

    for ad in ads {
        write_ad(&mut writer, ad)?;
    }

    end_elem(&mut writer, "Ads")?;
    let bytes = writer.into_inner().into_inner();
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

fn write_ad(writer: &mut Writer<Cursor<Vec<u8>>>, ad: &Ad) -> Result<(), String> {
    start_elem(writer, "Ad", &[])?;
    text_elem(writer, "Id", ad.ad_id.as_deref().unwrap_or_else(|| ad.id.as_deref().unwrap_or_default()))?;
    if let Some(avito_id) = ad.avito_id.as_ref() {
        text_elem(writer, "AvitoId", avito_id)?;
    }
    if let Some(status) = ad.avito_status.as_ref().or(ad.ad_status.as_ref()) {
        text_elem(writer, "AdStatus", status)?;
    } else {
        text_elem(writer, "AdStatus", DEFAULT_AD_STATUS)?;
    }
    if let Some(listing_fee) = ad.listing_fee.as_ref() {
        text_elem(writer, "ListingFee", listing_fee)?;
    } else {
        text_elem(writer, "ListingFee", DEFAULT_LISTING_FEE)?;
    }
    if let Some(date_begin) = ad.date_begin.as_ref() {
        text_elem(writer, "DateBegin", date_begin)?;
    }
    if let Some(date_end) = ad.avito_date_end.as_ref() {
        text_elem(writer, "DateEnd", date_end)?;
    }
    if let Some(title) = ad.title.as_ref() {
        text_elem(writer, "Title", title)?;
    }
    if let Some(desc) = ad.description.as_ref() {
        cdata_elem(writer, "Description", desc)?;
    }
    if let Some(address) = ad.address.as_ref() {
        text_elem(writer, "Address", address)?;
    }
    text_elem(
        writer,
        "ContactPhone",
        ad.contact_phone.as_deref().unwrap_or(DEFAULT_CONTACT_PHONE),
    )?;
    text_elem(
        writer,
        "ContactMethod",
        ad.contact_method.as_deref().unwrap_or(DEFAULT_CONTACT_METHOD),
    )?;
    text_elem(writer, "InternetCalls", ad.internet_calls.as_deref().unwrap_or(DEFAULT_INTERNET_CALLS))?;
    text_elem(writer, "EMail", ad.email.as_deref().unwrap_or(DEFAULT_EMAIL))?;
    text_elem(writer, "CompanyName", ad.company_name.as_deref().unwrap_or(DEFAULT_COMPANY_NAME))?;
    text_elem(writer, "ManagerName", ad.manager_name.as_deref().unwrap_or(DEFAULT_MANAGER_NAME))?;
    text_elem(writer, "AdType", ad.ad_type.as_deref().unwrap_or(DEFAULT_AD_TYPE))?;
    text_elem(writer, "Condition", ad.condition.as_deref().unwrap_or(DEFAULT_CONDITION))?;
    text_elem(
        writer,
        "Availability",
        ad.availability.as_deref().unwrap_or(DEFAULT_AVAILABILITY),
    )?;
    text_elem(writer, "TargetAudience", ad.target_audience.as_deref().unwrap_or(DEFAULT_TARGET_AUDIENCE))?;
    let delivery_val = ad.delivery.as_deref().unwrap_or(DEFAULT_DELIVERY);
    if !delivery_val.is_empty() {
        text_elem(writer, "Delivery", delivery_val)?;
    }

    text_elem(writer, "Category", ad.category.as_deref().unwrap_or("Ремонт и строительство"))?;
    text_elem(writer, "GoodsType", ad.goods_type.as_deref().unwrap_or("Стройматериалы"))?;
    text_elem(writer, "GoodsSubType", ad.goods_sub_type.as_deref().unwrap_or("Сыпучие материалы"))?;
    text_elem(
        writer,
        "BulkMaterialSubType",
        ad.bulk_material_sub_type
            .as_deref()
            .unwrap_or(DEFAULT_BULK_MATERIAL_SUBTYPE),
    )?;
    let bulk_material_type = ad
        .bulk_material_type
        .clone()
        .or_else(|| {
            ad.material_id.as_ref().map(|m| {
                if m.starts_with("scheben") {
                    "Щебень, гравий".to_string()
                } else {
                    "Песок".to_string()
                }
            })
        })
        .unwrap_or_else(|| "Песок".to_string());
    text_elem(writer, "BulkMaterialType", &bulk_material_type)?;
    let bulk_material_sub_type = ad
        .bulk_material_sub_type
        .as_deref()
        .unwrap_or(DEFAULT_BULK_MATERIAL_SUBTYPE);

    // Цены / упаковка / минимальный заказ
    if let Some(price) = ad.price {
        text_elem(writer, "Price", &price.to_string())?;
    }
    if let Some(price_for) = ad.price_for.as_ref() {
        text_elem(writer, "PriceFor", price_for)?;
    }
    text_elem(writer, "PackagingType", ad.packaging_type.as_deref().unwrap_or(DEFAULT_PACKAGING_TYPE))?;
    let min_sale = ad.min_sale_quantity.unwrap_or(DEFAULT_MIN_SALE_QUANTITY);
    text_elem(writer, "MinSaleQuantity", &min_sale.to_string())?;

    // Цвет и характеристики
    if let Some(color) = ad.color.as_ref() {
        text_elem(writer, "Color", color)?;
    }
    let images = collect_images(ad.photo_link.as_ref(), ad.image_urls.as_deref());
    if images.is_empty() {
        return Err("Объявление должно содержать хотя бы одно изображение".into());
    }
    start_elem(writer, "Images", &[])?;
    for url in images {
        start_elem(writer, "Image", &[("url", &url)])?;
        end_elem(writer, "Image")?;
    }
    end_elem(writer, "Images")?;
    if let Some(comp) = ad.compaction_coefficient {
        text_elem(writer, "CompactionCoefficient", &comp.to_string())?;
    }

    if bulk_material_type == "Щебень, гравий" && bulk_material_sub_type == "Щебень" {
        let rubble_type = ad
            .rubble_type
            .clone()
            .or_else(|| extract_rubble_type_from_text(ad.title.as_deref(), ad.description.as_deref()));
        if let Some(rubble_type) = rubble_type {
            text_elem(writer, "RubbleType", &rubble_type)?;
        }

        let fraction = ad
            .fraction
            .clone()
            .or_else(|| extract_fraction_from_text(ad.description.as_deref()));
        if let Some(fraction) = fraction {
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

    end_elem(writer, "Ad")?;
    Ok(())
}

fn start_elem(writer: &mut Writer<Cursor<Vec<u8>>>, name: &str, attrs: &[(&str, &str)]) -> Result<(), String> {
    let mut elem = BytesStart::new(name);
    for (k, v) in attrs {
        elem.push_attribute((*k, *v));
    }
    writer.write_event(Event::Start(elem)).map_err(|e| e.to_string())
}

fn end_elem(writer: &mut Writer<Cursor<Vec<u8>>>, name: &str) -> Result<(), String> {
    writer
        .write_event(Event::End(BytesEnd::new(name)))
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
