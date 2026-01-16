use std::cmp::Ordering;
use std::collections::{HashMap, VecDeque};

use chrono::Local;
use rand::seq::SliceRandom;
use rand::Rng;

use crate::{
    ad_id::{generate_ad_id, parse_date_begin},
    constants::{CITY_ALIASES, MATERIAL_ALIASES, SELLER_ADDRESS_ALIASES},
    constants::{EXACT_TITLES, TOP_5_TITLES},
    generate_description_with_rng, parse_date_time, Ad, Aliases, Location, Plan,
};

#[derive(Clone)]
struct ParsedAdId {
    source_base: String,
    material_alias: String,
    city_alias: String,
    date_label: String,
    counter: u32,
}

#[derive(Clone)]
struct PhotoEntry {
    ad_id: String,
    url: String,
    parsed: ParsedAdId,
}

struct LocationPlan {
    address: String,
    count: u32,
}

struct AdsBucket {
    ads: Vec<Ad>,
    index: usize,
    material_id: String,
    location: String,
    photo_queue: Vec<PhotoEntry>,
    task_photos: Vec<String>,
}

/// Генерация новых объявлений строго по publicationQueue.
/// Требуется маппинг фото adId -> url (как после upload-photos.js).
pub fn generate_new_ads(
    plan: &Plan,
    photo_map: &HashMap<String, String>,
    existing_ids: &std::collections::HashSet<String>,
) -> Result<Vec<Ad>, String> {
    let mut rng = rand::thread_rng();
    if plan.date_begin.trim().is_empty() {
        return Err("В плане не указан DateBegin.".to_string());
    }

    let aliases = plan.aliases.as_ref();
    let plan_date = parse_date_time(&plan.date_begin).or_else(|| parse_date_begin(&plan.date_begin));
    let fallback_date = plan_date.unwrap_or_else(|| Local::now().naive_local());

    let mut ads_by_key: HashMap<(String, String), AdsBucket> = HashMap::new();

    for task in &plan.tasks {
        let task_material_id = if task.material_id.trim().is_empty() {
            "karier_neseyan_nemyt_pesok".to_string()
        } else {
            task.material_id.clone()
        };
        let material_id_resolved = resolve_material_alias(task_material_id, aliases);
        let total_count = if task.count > 0 { task.count } else { 1 };

        let empty_locations: Vec<Location> = Vec::new();
        let locations = if !task.locations.is_empty() {
            &task.locations
        } else if let Some(addrs) = task.addresses.as_ref() {
            addrs
        } else {
            &empty_locations
        };
        let locations_plan = build_location_plan(total_count, locations, aliases);

        let is_rubble_task = task
            .material
            .as_deref()
            .map(|m| m == "rubble")
            .unwrap_or(false)
            || material_id_resolved.starts_with("scheben");

        let default_titles = if let Some(titles) = task.titles.as_ref().filter(|t| !t.is_empty()) {
            titles.clone()
        } else if is_rubble_task {
            EXACT_TITLES
                .get(material_id_resolved.as_str())
                .map(|titles| titles.iter().map(|t| t.to_string()).collect())
                .unwrap_or_else(|| vec!["Щебень".to_string(), "Щебень вторичный".to_string()])
        } else {
            TOP_5_TITLES.iter().map(|t| t.to_string()).collect()
        };

        let task_photos = task.photos.clone().unwrap_or_default();

        for loc in locations_plan {
            let base_count = ((loc.count as f64) * 0.5).round() as u32;
            let base_price_count = base_count.min(loc.count);
            let use_base_price_flags: Vec<bool> =
                (0..loc.count).map(|idx| idx < base_price_count).collect();

            let mut ads = Vec::new();
            for (_idx, use_base) in use_base_price_flags.iter().enumerate() {
                let title = pick_title(&default_titles, &mut rng);
                let ad = build_material_ad(
                    &material_id_resolved,
                    &loc.address,
                    title,
                    *use_base,
                    is_rubble_task,
                    &task_photos,
                    &mut rng,
                );
                let mut ad = ad;
                ad.use_base_price = Some(*use_base);
                ads.push(ad);
            }

            let mat_alias = material_alias(&material_id_resolved);
            let city_alias = city_alias(&loc.address);
            let location_photos = collect_location_photos(photo_map, &mat_alias, &city_alias, existing_ids);
            let mut photo_queue: VecDeque<PhotoEntry> = VecDeque::from(location_photos.clone());

            let mut ads_without_photo = Vec::new();
            for (idx, ad) in ads.iter_mut().enumerate() {
                let target_counter = idx as u32 + 1;
                if let Some(photo) = photo_queue.pop_front() {
                    ad.ad_id = Some(photo.ad_id);
                    ad.photo_link = Some(photo.url);
                } else {
                    let ad_id = generate_ad_id(&material_id_resolved, &loc.address, &fallback_date, target_counter)
                        .map_err(|e| format!("Ошибка генерации adId: {:?}", e))?;
                    ad.ad_id = Some(ad_id);
                    if ad.photo_link.as_deref().unwrap_or("").is_empty() && !task_photos.is_empty() {
                        ad.photo_link = Some(pick_title(&task_photos, &mut rng));
                    }
                }
                if ad.photo_link.as_deref().unwrap_or("").is_empty() {
                    ads_without_photo.push(ad.ad_id.clone().unwrap_or_default());
                }
            }

            if !ads_without_photo.is_empty() {
                let sample = ads_without_photo
                    .iter()
                    .take(5)
                    .cloned()
                    .collect::<Vec<String>>()
                    .join(", ");
                return Err(format!(
                    "Обнаружены объявления без фото ({} из {}):\n  Локация: {}\n  Объявления без фото: {}{}",
                    ads_without_photo.len(),
                    ads.len(),
                    loc.address,
                    sample,
                    if ads_without_photo.len() > 5 { "..." } else { "" }
                ));
            }

            let key = (material_id_resolved.clone(), loc.address.clone());
            ads_by_key.insert(
                key,
                AdsBucket {
                    ads,
                    index: 0,
                    material_id: material_id_resolved.clone(),
                    location: loc.address,
                    photo_queue: location_photos,
                    task_photos: task_photos.clone(),
                },
            );
        }
    }

    let mut generated_ads = Vec::new();

    for slot in &plan.publication_queue {
        let material_id = if !slot.material_id.trim().is_empty() {
            slot.material_id.clone()
        } else {
            slot.material.clone().unwrap_or_default()
        };
        let material_id_resolved = resolve_material_alias(material_id, aliases);
        let resolved_location = resolve_address_alias(slot.location.clone(), aliases);
        let key = (material_id_resolved.clone(), resolved_location.clone());

        let entry = match ads_by_key.get_mut(&key) {
            Some(entry) => entry,
            None => continue,
        };
        if entry.index >= entry.ads.len() {
            continue;
        }

        let ad = &mut entry.ads[entry.index];
        let photo = entry.photo_queue.get(entry.index).cloned();
        let queue_date = parse_date_time(&slot.date_begin);

        if let Some(photo) = photo {
            ad.ad_id = Some(photo.ad_id);
            ad.photo_link = Some(photo.url);
        } else {
            let base_date = queue_date.or(plan_date).unwrap_or(fallback_date);
            let ad_id = generate_ad_id(
                &entry.material_id,
                &entry.location,
                &base_date,
                (entry.index + 1) as u32,
            )
            .map_err(|e| format!("Ошибка генерации adId: {:?}", e))?;
            ad.ad_id = Some(ad_id);
            if ad.photo_link.as_deref().unwrap_or("").is_empty() && !entry.task_photos.is_empty() {
                ad.photo_link = Some(pick_title(&entry.task_photos, &mut rng));
            }
        }

        ad.date_begin = Some(slot.date_begin.clone());
        generated_ads.push(ad.clone());
        entry.index += 1;
    }

    Ok(generated_ads)
}

fn build_location_plan(
    total_count: u32,
    locations: &[Location],
    aliases: Option<&Aliases>,
) -> Vec<LocationPlan> {
    if locations.is_empty() {
        let fallback = resolve_address_alias("Московская область, Троицк".to_string(), aliases);
        return vec![LocationPlan {
            address: fallback,
            count: total_count,
        }];
    }

    struct TempLoc {
        address: String,
        count: Option<u32>,
        percent: Option<f64>,
    }

    let mut result: Vec<TempLoc> = locations
        .iter()
        .map(|loc| TempLoc {
            address: if !loc.address.trim().is_empty() {
                loc.address.clone()
            } else {
                loc.addr.clone().unwrap_or_default()
            },
            count: if loc.count > 0 { Some(loc.count) } else { None },
            percent: loc.percent,
        })
        .collect();

    let mut remaining: i64 = total_count as i64;
    for loc in &result {
        if let Some(count) = loc.count {
            if count > 0 {
                remaining -= count as i64;
            }
        }
    }

    for loc in result.iter_mut() {
        if loc.count.is_none() {
            if let Some(percent) = loc.percent {
                let share = ((total_count as f64) * percent / 100.0).floor() as u32;
                loc.count = Some(share);
                remaining -= share as i64;
            }
        }
    }

    if remaining > 0 {
        let target_index = result
            .iter()
            .rposition(|loc| loc.count.is_some())
            .unwrap_or(0);
        let target = &mut result[target_index];
        let new_count = target.count.unwrap_or(0) + remaining as u32;
        target.count = Some(new_count);
    }

    result
        .into_iter()
        .filter_map(|loc| {
            let count = loc.count.unwrap_or(0);
            if count == 0 {
                return None;
            }
            Some(LocationPlan {
                address: resolve_address_alias(loc.address, aliases),
                count,
            })
        })
        .collect()
}

fn collect_location_photos(
    photo_map: &HashMap<String, String>,
    mat_alias: &str,
    city_alias: &str,
    existing_ids: &std::collections::HashSet<String>,
) -> Vec<PhotoEntry> {
    let mut location_photos = Vec::new();
    for (ad_id, url) in photo_map {
        let parsed = match parse_ad_id(ad_id) {
            Some(parsed) => parsed,
            None => continue,
        };
        if parsed.material_alias != mat_alias || parsed.city_alias != city_alias {
            continue;
        }
        if !has_time_label(&parsed.date_label) {
            continue;
        }
        if existing_ids.contains(ad_id) {
            continue;
        }
        location_photos.push(PhotoEntry {
            ad_id: ad_id.clone(),
            url: url.clone(),
            parsed,
        });
    }

    location_photos.sort_by(|a, b| {
        match a.parsed.date_label.cmp(&b.parsed.date_label) {
            Ordering::Equal => match a.parsed.source_base.cmp(&b.parsed.source_base) {
                Ordering::Equal => a.parsed.counter.cmp(&b.parsed.counter),
                other => other,
            },
            other => other,
        }
    });

    location_photos
}

fn has_time_label(date_label: &str) -> bool {
    date_label.contains('-') && date_label.len() > 6
}

fn parse_ad_id(ad_id: &str) -> Option<ParsedAdId> {
    if ad_id.is_empty() {
        return None;
    }
    let mut parts: Vec<&str> = ad_id.split('_').collect();
    if parts.len() < 4 {
        return None;
    }
    let counter_raw = parts.pop()?;
    let counter: u32 = counter_raw.parse().ok()?;
    let date_label = parts.pop()?.to_string();
    let city_alias = parts.pop()?.to_string();
    let source_base = parts.join("_");
    if source_base.is_empty() {
        return None;
    }
    let material_alias = source_base
        .split('_')
        .next()
        .unwrap_or(&source_base)
        .to_string();

    Some(ParsedAdId {
        source_base,
        material_alias,
        city_alias,
        date_label,
        counter,
    })
}

fn pick_title<R: Rng + ?Sized>(titles: &[String], rng: &mut R) -> String {
    titles
        .choose(rng)
        .cloned()
        .unwrap_or_else(|| "Объявление".to_string())
}

fn build_material_ad<R: Rng + ?Sized>(
    material_id: &str,
    address: &str,
    title: String,
    use_base_price: bool,
    is_rubble: bool,
    photos: &[String],
    rng: &mut R,
) -> Ad {
    let spec = material_spec(material_id);
    let price = if use_base_price {
        spec.base_price
    } else {
        spec.base_price + pick_price_delta(rng)
    };
    let min_sale_quantity = random_min_sale_quantity(rng);
    let color = if is_rubble {
        Some("Серый".to_string())
    } else {
        spec.color.map(|opts| pick_color(opts, rng))
    };
    let photo_link = if photos.is_empty() {
        None
    } else {
        Some(pick_title(photos, rng))
    };

    let mut ad = Ad {
        title: Some(title.clone()),
        description: Some(generate_description_with_rng(
            rng,
            Some(&title),
            Some(material_id),
            Some(address),
        )),
        address: Some(address.to_string()),
        photo_link,
        material_id: Some(material_id.to_string()),
        bulk_material_type: Some(resolve_bulk_material_type(material_id)),
        bulk_material_sub_type: Some(resolve_bulk_material_sub_type(material_id)),
        price: Some(price),
        price_for: Some(spec.price_for.to_string()),
        min_sale_quantity: Some(min_sale_quantity),
        compaction_coefficient: Some(spec.compaction),
        color,
        ..Ad::default()
    };

    if is_rubble {
        ad.rubble_type = Some("Вторичный".to_string());
        ad.fraction = Some(match material_id {
            "scheben_vtorichnyi_5_20" => "5–20 мм",
            "scheben_vtorichnyi_40_70" => "40–70 мм",
            _ => "",
        }
        .to_string());
        ad.concrete_grade = Some(pick_choice(&["M600", "M800"], rng));
        ad.frost_resistance = Some(pick_choice(&["F100", "F150", "F200", "F300"], rng));
        ad.flakiness_index = Some(pick_choice(
            &["1 группа", "2 группа", "3 группа", "4 группа"],
            rng,
        ));
    }

    ad
}

fn pick_choice<R: Rng + ?Sized>(options: &[&str], rng: &mut R) -> String {
    options
        .choose(rng)
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn material_alias(material_id: &str) -> String {
    MATERIAL_ALIASES
        .get(material_id)
        .map(|s| s.to_string())
        .unwrap_or_else(|| material_id.chars().take(3).collect())
}

fn city_alias(address: &str) -> String {
    let canonical = SELLER_ADDRESS_ALIASES
        .get(address)
        .copied()
        .unwrap_or(address);
    CITY_ALIASES
        .get(canonical)
        .copied()
        .unwrap_or(canonical)
        .to_string()
}

fn resolve_bulk_material_type(material_id: &str) -> String {
    if material_id.starts_with("scheben") {
        "Щебень, гравий".to_string()
    } else {
        "Песок".to_string()
    }
}

fn resolve_bulk_material_sub_type(material_id: &str) -> String {
    if material_id.starts_with("scheben") {
        "Щебень".to_string()
    } else {
        "Карьерный".to_string()
    }
}

fn resolve_address_alias(addr: String, aliases: Option<&Aliases>) -> String {
    if let Some(a) = aliases {
        if let Some(mapped) = a.addresses.get(&addr) {
            return mapped.clone();
        }
    }
    addr
}

fn resolve_material_alias(id: String, aliases: Option<&Aliases>) -> String {
    if let Some(a) = aliases {
        if let Some(mapped) = a.materials.get(&id) {
            return mapped.clone();
        }
    }
    id
}

struct MaterialSpec {
    base_price: f64,
    compaction: f64,
    price_for: &'static str,
    color: Option<&'static [&'static str]>,
}

fn material_spec(material_id: &str) -> MaterialSpec {
    match material_id {
        "karier_neseyan_nemyt_pesok" => MaterialSpec {
            base_price: 280.0,
            compaction: 1.40,
            price_for: "тонну",
            color: Some(&["Белый", "Жёлтый", "Серый"]),
        },
        "karier_seyan_nemyt_pesok" => MaterialSpec {
            base_price: 240.0,
            compaction: 1.70,
            price_for: "тонну",
            color: Some(&["Белый", "Жёлтый", "Серый"]),
        },
        "karier_seyan_myt_pesok_1.5" => MaterialSpec {
            base_price: 430.0,
            compaction: 1.60,
            price_for: "тонну",
            color: Some(&["Белый", "Жёлтый", "Серый"]),
        },
        "karier_seyan_myt_pesok_2" => MaterialSpec {
            base_price: 580.0,
            compaction: 1.60,
            price_for: "тонну",
            color: Some(&["Белый", "Жёлтый", "Серый"]),
        },
        "karier_seyan_myt_pesok_2.5" => MaterialSpec {
            base_price: 680.0,
            compaction: 1.60,
            price_for: "тонну",
            color: Some(&["Белый", "Жёлтый", "Серый"]),
        },
        "scheben_vtorichnyi_5_20" => MaterialSpec {
            base_price: 1110.0,
            compaction: 1.35,
            price_for: "тонну",
            color: Some(&["Серый"]),
        },
        "scheben_vtorichnyi_40_70" => MaterialSpec {
            base_price: 1200.0,
            compaction: 1.25,
            price_for: "тонну",
            color: Some(&["Серый"]),
        },
        _ => MaterialSpec {
            base_price: 0.0,
            compaction: 0.0,
            price_for: "",
            color: None,
        },
    }
}

fn pick_price_delta<R: Rng + ?Sized>(rng: &mut R) -> f64 {
    let options = [0.0, 30.0, 60.0, 90.0];
    *options.choose(rng).unwrap_or(&0.0)
}

fn random_min_sale_quantity<R: Rng + ?Sized>(rng: &mut R) -> u32 {
    let steps = (10..=20).step_by(2).collect::<Vec<u32>>();
    *steps.choose(rng).unwrap_or(&20)
}

fn pick_color<R: Rng + ?Sized>(options: &[&str], rng: &mut R) -> String {
    options
        .choose(rng)
        .map(|s| s.to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use super::*;
    use crate::{PublicationSlot, Task};

    fn plan_with_slot(date: &str, material_id: &str, address: &str) -> Plan {
        Plan {
            date_begin: "01.01.2023 10:00".to_string(),
            tasks: vec![Task {
                material_id: material_id.to_string(),
                material: Some("sand".to_string()),
                count: 1,
                locations: vec![Location {
                    address: address.to_string(),
                    count: 1,
                    percent: None,
                    addr: None,
                }],
                addresses: None,
                titles: None,
                photos: None,
            }],
            publication_queue: vec![PublicationSlot {
                date_begin: date.to_string(),
                material_id: material_id.to_string(),
                material: None,
                location: address.to_string(),
            }],
            aliases: None,
        }
    }

    #[test]
    fn generates_ad_with_exact_photo() {
        let address = "Москва, Троицк, Индустриальная ул., 1";
        let plan = plan_with_slot("01.01.2023 10:00", "karier_neseyan_nemyt_pesok", address);
        let ad_id = "s00_troi_010123-100000_1".to_string();
        let mut photo_map = HashMap::new();
        photo_map.insert(ad_id.clone(), "https://example.com/photo.jpg".to_string());
        let existing_ids = HashSet::new();

        let res = generate_new_ads(&plan, &photo_map, &existing_ids).expect("generation failed");
        assert_eq!(res.len(), 1);
        let ad = &res[0];
        assert_eq!(ad.ad_id.as_deref(), Some(ad_id.as_str()));
        assert_eq!(
            ad.photo_link.as_deref(),
            Some("https://example.com/photo.jpg")
        );
        assert_eq!(
            ad.material_id.as_deref(),
            Some("karier_neseyan_nemyt_pesok")
        );
        assert_eq!(ad.address.as_deref(), Some(address));
    }

    #[test]
    fn uses_photo_mapping_when_date_differs() {
        let address = "Москва, Троицк, Индустриальная ул., 1";
        let plan = plan_with_slot("01.01.2023 10:00", "karier_neseyan_nemyt_pesok", address);
        let mapped_ad_id = "s00_troi_020123-090000_1".to_string();
        let mut photo_map = HashMap::new();
        photo_map.insert(
            mapped_ad_id.clone(),
            "https://example.com/fallback.jpg".to_string(),
        );
        let existing_ids = HashSet::new();

        let res = generate_new_ads(&plan, &photo_map, &existing_ids).expect("generation failed");
        assert_eq!(res.len(), 1);
        let ad = &res[0];
        assert_eq!(ad.ad_id.as_deref(), Some(mapped_ad_id.as_str()));
        assert_eq!(
            ad.photo_link.as_deref(),
            Some("https://example.com/fallback.jpg")
        );
    }

    #[test]
    fn errors_when_photo_missing() {
        let address = "Москва, Троицк, Индустриальная ул., 1";
        let plan = plan_with_slot("01.01.2023 10:00", "karier_neseyan_nemyt_pesok", address);
        let photo_map = HashMap::new();
        let existing_ids = HashSet::new();

        let err = generate_new_ads(&plan, &photo_map, &existing_ids).unwrap_err();
        assert!(
            err.contains("без фото"),
            "expected photo error, got: {}",
            err
        );
    }
}
