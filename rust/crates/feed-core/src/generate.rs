use std::collections::HashMap;

use rand::seq::SliceRandom;
use rand::thread_rng;

use crate::{
    ad_id::{generate_ad_id, parse_date_begin},
    constants::{EXACT_TITLES, TOP_5_TITLES},
    generate_description, parse_date_time, Ad, Plan,
};

/// Генерация новых объявлений строго по publicationQueue.
/// Требуется маппинг фото adId -> url (как после upload-photos.js).
pub fn generate_new_ads(
    plan: &Plan,
    photo_map: &HashMap<String, String>,
    existing_ids: &std::collections::HashSet<String>,
) -> Result<Vec<Ad>, String> {
    let mut rng = thread_rng();
    let mut counters: HashMap<(String, String), u32> = HashMap::new(); // (materialId,address) -> counter
    let mut alias_counter_index: HashMap<(String, String, String), String> = HashMap::new(); // (matAlias,cityAlias,counter) -> url
    for (ad_id, url) in photo_map {
        if let Some((mat, city, counter)) = parse_ad_id_parts(ad_id) {
            alias_counter_index
                .entry((mat, city, counter))
                .or_insert_with(|| url.clone());
        }
    }
    let mut ads = Vec::new();

    for slot in &plan.publication_queue {
        let material_id = if !slot.material_id.is_empty() {
            slot.material_id.clone()
        } else {
            slot.material.clone().unwrap_or_default()
        };
        let address = slot.location.clone();
        let key = (material_id.clone(), address.clone());
        let counter = counters
            .entry(key.clone())
            .and_modify(|c| *c += 1)
            .or_insert(1);

        let dt = parse_date_time(&slot.date_begin)
            .or_else(|| parse_date_begin(&slot.date_begin))
            .ok_or_else(|| format!("Не удалось распарсить DateBegin {}", slot.date_begin))?;

        let ad_id = generate_ad_id(&material_id, &address, &dt, *counter).map_err(|e| {
            format!(
                "Ошибка генерации adId для {} @ {}: {:?}",
                material_id, address, e
            )
        })?;

        if existing_ids.contains(&ad_id) {
            return Err(format!(
                "Сгенерированный adId уже существует в Excel: {}",
                ad_id
            ));
        }

        let photo = photo_map
            .get(&ad_id)
            .cloned()
            .or_else(|| {
                if let Some((mat, city, counter)) = parse_ad_id_parts(&ad_id) {
                    alias_counter_index.get(&(mat, city, counter)).cloned()
                } else {
                    None
                }
            })
            .ok_or_else(|| format!("Не найдено фото для adId {}", ad_id))?;

        let title = pick_title(&material_id, &mut rng);

        let description = Some(generate_description(
            Some(&title),
            Some(&material_id),
            Some(&address),
        ));

        let ad = Ad {
            ad_id: Some(ad_id.clone()),
            avito_id: Some(ad_id.clone()),
            title: Some(title),
            description,
            date_begin: Some(slot.date_begin.clone()),
            address: Some(address.clone()),
            photo_link: Some(photo),
            material_id: Some(material_id.clone()),
            ..Ad::default()
        };

        ads.push(ad);
    }

    Ok(ads)
}

fn pick_title(material_id: &str, rng: &mut impl rand::Rng) -> String {
    if let Some(list) = EXACT_TITLES.get(material_id) {
        if let Some(t) = list.choose(rng) {
            return (*t).to_string();
        }
    }
    if let Some(t) = TOP_5_TITLES.choose(rng) {
        return (*t).to_string();
    }
    "Объявление".to_string()
}

fn parse_ad_id_parts(ad_id: &str) -> Option<(String, String, String)> {
    let parts: Vec<&str> = ad_id.split('_').collect();
    if parts.len() != 4 {
        return None;
    }
    Some((
        parts[0].to_string(),
        parts[1].to_string(),
        parts[3].to_string(),
    ))
}
