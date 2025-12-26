use std::collections::HashMap;

use rand::seq::SliceRandom;
use rand::{thread_rng, Rng};

use crate::{
    ad_id::{generate_ad_id, parse_date_begin},
    constants::{EXACT_TITLES, TOP_5_TITLES, ZHIROSHINO_TITLES},
    generate_description, parse_date_time, Ad, Aliases, Plan,
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
    let mut alias_city_index: HashMap<(String, String), String> = HashMap::new(); // (matAlias,cityAlias) -> url
    let mut price_stats: HashMap<(String, String), (u32, u32)> = HashMap::new(); // (materialId,address) -> (base_count,total)
    let mut total_slots: HashMap<(String, String), u32> = HashMap::new();
    for slot in &plan.publication_queue {
        let material_id = resolve_material_alias(
            if !slot.material_id.is_empty() {
                slot.material_id.clone()
            } else {
                slot.material.clone().unwrap_or_default()
            },
            plan.aliases.as_ref(),
        );
        let address = resolve_address_alias(slot.location.clone(), plan.aliases.as_ref());
        *total_slots.entry((material_id, address)).or_default() += 1;
    }
    let mut base_targets: HashMap<(String, String), u32> = HashMap::new();
    for (k, total) in &total_slots {
        let target = ((total + 1) / 2).max(1);
        base_targets.insert(k.clone(), target);
    }
    let mut base_used: HashMap<(String, String), u32> = HashMap::new();
    for (ad_id, url) in photo_map {
        if let Some((mat, city, counter)) = parse_ad_id_parts(ad_id) {
            alias_counter_index
                .entry((mat.clone(), city.clone(), counter))
                .or_insert_with(|| url.clone());
            alias_city_index
                .entry((mat, city))
                .or_insert_with(|| url.clone());
        }
    }
    let mut ads = Vec::new();
    let mut title_buckets: HashMap<(String, String), TitleBucket> = HashMap::new(); // (materialId,address) -> bucket

    for slot in &plan.publication_queue {
        let material_id = resolve_material_alias(
            if !slot.material_id.is_empty() {
                slot.material_id.clone()
            } else {
                slot.material.clone().unwrap_or_default()
            },
            plan.aliases.as_ref(),
        );
        let address = resolve_address_alias(slot.location.clone(), plan.aliases.as_ref());
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
            .or_else(|| {
                if let Some((mat, city, _)) = parse_ad_id_parts(&ad_id) {
                    alias_city_index.get(&(mat, city)).cloned()
                } else {
                    None
                }
            })
            .ok_or_else(|| format!("Не найдено фото для adId {}", ad_id))?;

        let title = pick_title(
            &material_id,
            &address,
            *counter,
            &mut title_buckets,
            &mut rng,
        );

        let spec = material_spec(&material_id);
        let use_base = decide_use_base(
            &mut base_used,
            &base_targets,
            &total_slots,
            &mut price_stats,
            &material_id,
            &address,
            *counter,
            &mut rng,
        );
        let delta = if use_base {
            0.0
        } else {
            pick_price_delta(&mut rng)
        };
        let price = Some(spec.base_price + delta);
        let price_for = Some(spec.price_for.to_string());
        let min_sale_quantity = Some(random_min_sale_quantity(&mut rng));
        let compaction_coefficient = Some(spec.compaction);
        let color = spec.color.map(|opts| pick_color(opts, &mut rng));

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
            bulk_material_type: Some(resolve_bulk_material_type(&material_id)),
            bulk_material_sub_type: Some(resolve_bulk_material_sub_type(&material_id)),
            price,
            price_for,
            min_sale_quantity,
            compaction_coefficient,
            color,
            use_base_price: Some(use_base),
            ..Ad::default()
        };

        ads.push(ad);
    }

    Ok(ads)
}

fn pick_title(
    material_id: &str,
    address: &str,
    counter: u32,
    buckets: &mut HashMap<(String, String), TitleBucket>,
    rng: &mut impl rand::Rng,
) -> String {
    let bucket = buckets
        .entry((material_id.to_string(), address.to_string()))
        .or_insert_with(|| TitleBucket::new(material_id, address));
    if counter == 1 {
        return bucket.pick_exact(rng);
    }
    bucket.pick_weighted(rng)
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

struct TitleBucket {
    exact: Vec<String>,
    top: Vec<String>,
    zhiroshino: Vec<String>,
    picked_exact: bool,
    counters: (u32, u32, u32), // (top, zhiro, exact)
    city_allows_zhiro: bool,
}

impl TitleBucket {
    fn new(material_id: &str, address: &str) -> Self {
        let exact = EXACT_TITLES
            .get(material_id)
            .map(|v| v.iter().map(|s| s.to_string()).collect())
            .unwrap_or_default();
        let top = TOP_5_TITLES.iter().map(|s| s.to_string()).collect();
        let zhiro = if city_allows_zhiro(address) {
            ZHIROSHINO_TITLES
                .get(material_id)
                .map(|v| v.iter().map(|s| s.to_string()).collect())
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        Self {
            exact,
            top,
            zhiroshino: zhiro,
            picked_exact: false,
            counters: (0, 0, 0),
            city_allows_zhiro: city_allows_zhiro(address),
        }
    }

    fn pick_exact(&mut self, rng: &mut impl rand::Rng) -> String {
        self.picked_exact = true;
        if let Some(t) = self.exact.choose(rng) {
            self.counters.2 += 1;
            return t.clone();
        }
        "Объявление".to_string()
    }

    fn pick_weighted(&mut self, rng: &mut impl rand::Rng) -> String {
        // target: TOP 70%, Zhiro 15%, Exact 15%
        let total = self.counters.0 + self.counters.1 + self.counters.2;
        let top_share = if total == 0 {
            0.0
        } else {
            self.counters.0 as f64 / total as f64
        };
        let z_share = if total == 0 {
            0.0
        } else {
            self.counters.1 as f64 / total as f64
        };

        let mut pool = Vec::new();
        if !self.top.is_empty() && top_share < 0.7 {
            pool.push("top");
        }
        if self.city_allows_zhiro && !self.zhiroshino.is_empty() && z_share < 0.15 {
            pool.push("zhiro");
        }
        if self.picked_exact && !self.exact.is_empty() {
            pool.push("exact");
        }
        if pool.is_empty() {
            // fallback to any available
            if !self.top.is_empty() {
                pool.push("top");
            }
            if self.city_allows_zhiro && !self.zhiroshino.is_empty() {
                pool.push("zhiro");
            }
            if self.picked_exact && !self.exact.is_empty() {
                pool.push("exact");
            }
        }
        let choice = pool.choose(rng).cloned().unwrap_or("top");
        match choice {
            "zhiro" => {
                if let Some(t) = self.zhiroshino.choose(rng) {
                    self.counters.1 += 1;
                    return t.clone();
                }
            }
            "exact" => {
                if let Some(t) = self.exact.choose(rng) {
                    self.counters.2 += 1;
                    return t.clone();
                }
            }
            _ => {
                if let Some(t) = self.top.choose(rng) {
                    self.counters.0 += 1;
                    return t.clone();
                }
            }
        }
        "Объявление".to_string()
    }
}

fn city_allows_zhiro(address: &str) -> bool {
    let allowed = [
        "Домодедово",
        "Подольск",
        "Чехов",
        "Бронницы",
        "Московская обл., Домодедово, Станционная ул., 26к3",
        "Московская обл., Подольск, ул. Лапшенкова, 3",
        "Московская обл., Чехов, ул. Чехова, 20Бк5",
        "Московская обл., Бронницы, Магистральная ул., 3",
    ];
    allowed.iter().any(|a| address.contains(a))
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

fn decide_use_base(
    base_used: &mut HashMap<(String, String), u32>,
    base_targets: &HashMap<(String, String), u32>,
    total_slots: &HashMap<(String, String), u32>,
    stats: &mut HashMap<(String, String), (u32, u32)>,
    material_id: &str,
    address: &str,
    counter: u32,
    rng: &mut impl Rng,
) -> bool {
    let key = (material_id.to_string(), address.to_string());
    let used = *base_used.get(&key).unwrap_or(&0);
    let target = *base_targets.get(&key).unwrap_or(&0);
    let total_for_key = *total_slots.get(&key).unwrap_or(&0);
    let generated = stats.get(&key).map(|(_, t)| *t).unwrap_or(0);
    let remaining_slots = total_for_key.saturating_sub(generated);
    let base_remaining = target.saturating_sub(used);

    let use_base = if base_remaining == 0 {
        false
    } else if base_remaining >= remaining_slots {
        true
    } else if base_remaining * 2 >= remaining_slots {
        rng.gen_bool(0.6)
    } else {
        rng.gen_bool(0.4)
    };

    if use_base {
        base_used.insert(key.clone(), used + 1);
    }
    let entry_mut = stats.entry(key).or_insert((0, 0));
    if use_base {
        entry_mut.0 += 1;
    }
    entry_mut.1 += 1;
    use_base
}

fn pick_price_delta(rng: &mut impl Rng) -> f64 {
    let options = [0.0, 30.0, 60.0, 90.0, 100.0];
    *options.choose(rng).unwrap_or(&0.0)
}

fn random_min_sale_quantity(rng: &mut impl Rng) -> u32 {
    let steps = (10..=20).step_by(2).collect::<Vec<u32>>();
    *steps.choose(rng).unwrap_or(&20)
}

fn pick_color(options: &[&str], rng: &mut impl Rng) -> String {
    options
        .choose(rng)
        .map(|s| s.to_string())
        .unwrap_or_default()
}
