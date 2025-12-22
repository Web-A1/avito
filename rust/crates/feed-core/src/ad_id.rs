use chrono::{NaiveDate, NaiveDateTime};

use crate::constants::{CITY_ALIASES, MATERIAL_ALIASES};

#[derive(Debug)]
pub enum AdIdError {
    MissingMaterial,
    MissingAddress,
    UnknownAddress(String),
}

fn get_material_alias(material_id: &str) -> String {
    MATERIAL_ALIASES
        .get(material_id)
        .map(|s| s.to_string())
        .unwrap_or_else(|| material_id.chars().take(3).collect())
}

fn get_city_alias(address: &str) -> Result<&'static str, AdIdError> {
    CITY_ALIASES
        .get(address)
        .copied()
        .ok_or_else(|| AdIdError::UnknownAddress(address.to_string()))
}

fn format_date_label(dt: &NaiveDateTime) -> String {
    dt.format("%d%m%y-%H%M%S").to_string()
}

/// Генерация adId: {materialAlias}_{cityAlias}_{dateLabel}_{counter:02}
pub fn generate_ad_id(
    material_id: &str,
    address: &str,
    date_begin: &NaiveDateTime,
    counter: u32,
) -> Result<String, AdIdError> {
    if material_id.is_empty() {
        return Err(AdIdError::MissingMaterial);
    }
    if address.is_empty() {
        return Err(AdIdError::MissingAddress);
    }
    let mat_alias = get_material_alias(material_id);
    let city_alias = get_city_alias(address)?;
    let date_label = format_date_label(date_begin);
    let counter_str = format!("{:02}", counter);
    Ok(format!(
        "{}_{}_{}_{}",
        mat_alias, city_alias, date_label, counter_str
    ))
}

/// Парсинг dateBegin (DD.MM.YYYY HH:MM или DD.MM.YYYY).
pub fn parse_date_begin(s: &str) -> Option<NaiveDateTime> {
    if let Ok(dt) = NaiveDateTime::parse_from_str(s, "%d.%m.%Y %H:%M") {
        Some(dt)
    } else if let Ok(d) = NaiveDate::parse_from_str(s, "%d.%m.%Y") {
        d.and_hms_opt(0, 0, 0)
    } else {
        None
    }
}
