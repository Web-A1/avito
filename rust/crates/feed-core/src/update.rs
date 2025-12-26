use std::collections::HashMap;

use crate::{
    constants::{CITY_ALIASES, MATERIAL_ALIASES},
    generate_description, Ad, CustomTitle, UpdateByLists, UpdateDescription, UpdateRule,
    UpdateRules,
};
use rand::{seq::SliceRandom, thread_rng};

#[derive(Debug, Default)]
pub struct UpdateResult {
    pub updated_ads: Vec<Ad>,
}

fn rule_for_id<'a>(map: &'a mut HashMap<String, UpdateRule>, id: &'a str) -> &'a mut UpdateRule {
    map.entry(id.to_string())
        .or_insert_with(UpdateRule::default)
}

fn parse_ad_id_aliases(ad_id: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = ad_id.split('_').collect();
    if parts.len() != 4 {
        return None;
    }
    Some((parts[0].to_string(), parts[1].to_string()))
}

fn material_id_from_alias(alias: &str) -> Option<String> {
    MATERIAL_ALIASES
        .iter()
        .find_map(|(id, a)| (*a == alias).then(|| id.to_string()))
}

fn address_from_alias(alias: &str) -> Option<String> {
    CITY_ALIASES
        .iter()
        .find_map(|(addr, a)| (*a == alias).then(|| addr.to_string()))
}

fn merge_rule(into: &mut UpdateRule, from: &UpdateRule) {
    if from.update_photo.is_some() {
        into.update_photo = from.update_photo;
    }
    if from.update_description.is_some() {
        into.update_description = from.update_description.clone();
    }
    if from.custom_title.is_some() {
        into.custom_title = from.custom_title.clone();
    }
    if from.new_address.is_some() {
        into.new_address = from.new_address.clone();
    }
    if from.material_id.is_some() {
        into.material_id = from.material_id.clone();
    }
    if from.address.is_some() {
        into.address = from.address.clone();
    }
}

fn apply_by_lists(
    map: &mut HashMap<String, UpdateRule>,
    by_lists: &UpdateByLists,
    current_ads: &[Ad],
) {
    // updateAll: применяем updatePhoto=true ко всем, опционально updateDescription=auto
    if by_lists.update_all.unwrap_or(false) {
        let desc_for_all = by_lists.update_description_for_all.unwrap_or(false);
        for ad in current_ads {
            if let Some(key) = ad.id.clone().or(ad.avito_id.clone()) {
                if key.is_empty() {
                    continue;
                }
                let rule = rule_for_id(map, &key);
                rule.update_photo = Some(true);
                if desc_for_all {
                    rule.update_description = Some(UpdateDescription::Auto("auto".into()));
                }

                let mut material_id = None;
                let mut address = None;
                if let Some((mat_alias, city_alias)) = parse_ad_id_aliases(&key) {
                    material_id = material_id_from_alias(&mat_alias);
                    address = address_from_alias(&city_alias);
                }
                if material_id.is_none() {
                    material_id = ad
                        .material_id
                        .clone()
                        .or(ad.bulk_material_sub_type.clone())
                        .or(Some("karier_neseyan_nemyt_pesok".to_string()));
                }
                if let Some(mid) = material_id {
                    rule.material_id = Some(mid);
                }
                if address.is_none() {
                    if let Some(addr) = &ad.address {
                        let trimmed = addr.trim();
                        if !trimmed.is_empty() {
                            address = Some(trimmed.to_string());
                        }
                    }
                }
                if let Some(addr) = address {
                    rule.address = Some(addr);
                }
            }
        }
    }

    // updatePhoto: список id
    for id in &by_lists.update_photo {
        let rule = rule_for_id(map, id);
        rule.update_photo = Some(true);
    }

    // updateDescription: список id (auto)
    for id in &by_lists.update_description {
        let rule = rule_for_id(map, id);
        rule.update_description = Some(UpdateDescription::Auto("auto".into()));
    }

    // customTitles: id -> string (в планах может быть строка или список; тут поддерживаем строку)
    for (id, title) in &by_lists.custom_titles {
        let rule = rule_for_id(map, id);
        // если пришла строка — кладём Single; если массив (не должно) — берём первый элемент
        if let Some(first) = title.get(0) {
            rule.custom_title = Some(CustomTitle::Single(first.clone()));
        }
    }

    // customDescriptions: id -> string
    for (id, desc) in &by_lists.custom_descriptions {
        let rule = rule_for_id(map, id);
        rule.update_description = Some(UpdateDescription::Manual(desc.clone()));
    }

    // newAddresses: id -> string
    for (id, addr) in &by_lists.new_addresses {
        let rule = rule_for_id(map, id);
        rule.new_address = Some(addr.clone());
    }
}

fn set_canonical_addresses(map: &mut HashMap<String, UpdateRule>) {
    for rule in map.values_mut() {
        if rule.new_address.is_some() {
            continue;
        }
        if let Some(addr) = &rule.address {
            if CITY_ALIASES.contains_key(addr.as_str()) {
                rule.new_address = Some(addr.clone());
            }
        }
    }
}

/// Построить карту правил обновления по Id/AvitoId, учитывая byId и byLists.
pub fn build_update_map(
    update_rules: &UpdateRules,
    current_ads: &[Ad],
) -> HashMap<String, UpdateRule> {
    let mut map = HashMap::new();
    if let Some(by_lists) = &update_rules.by_lists {
        apply_by_lists(&mut map, by_lists, current_ads);
        set_canonical_addresses(&mut map);
    }
    if let Some(by_id) = &update_rules.by_id {
        for (k, v) in by_id {
            let target = map.entry(k.clone()).or_insert_with(UpdateRule::default);
            merge_rule(target, v);
        }
    }
    map
}

/// Применить правила обновления к объявлениям из Excel.
/// Здесь только простая перекладка полей (описание/заголовок/адрес/фото), без генерации текстов.
pub fn apply_updates(
    ads: Vec<Ad>,
    updates: &HashMap<String, UpdateRule>,
    photo_mapping: Option<&HashMap<String, String>>,
) -> Result<Vec<Ad>, String> {
    let mut rng = thread_rng();
    let mut out = Vec::with_capacity(ads.len());

    for mut ad in ads {
        let key = ad.id.clone().or(ad.avito_id.clone()).unwrap_or_default();
        if let Some(rule) = updates.get(&key) {
            if let Some(addr) = &rule.new_address {
                if !CITY_ALIASES.contains_key(addr.as_str()) {
                    return Err(format!(
                        "Адрес \"{}\" не найден в утверждённых CITY_ALIASES для объявления {}",
                        addr, key
                    ));
                }
                ad.address = Some(addr.clone());
            }
            if let Some(material_id) = &rule.material_id {
                ad.material_id = Some(material_id.clone());
            }
            if let Some(UpdateDescription::Manual(desc)) = &rule.update_description {
                ad.description = Some(desc.clone());
            }
            if let Some(UpdateDescription::Auto(_)) = &rule.update_description {
                if let Some(material_id) = resolve_material_id(rule, &ad, &key) {
                    let title = ad.title.as_deref();
                    let address = ad.address.as_deref();
                    ad.description = Some(generate_description(title, Some(&material_id), address));
                } else {
                    eprintln!(
                        "⚠️  Не удалось определить materialId для auto-описания объявления {}",
                        key
                    );
                }
            }
            if let Some(title) = &rule.custom_title {
                match title {
                    CustomTitle::Single(t) => ad.title = Some(t.clone()),
                    CustomTitle::List(list) if !list.is_empty() => {
                        if let Some(choice) = list.choose(&mut rng) {
                            ad.title = Some(choice.clone());
                        }
                    }
                    _ => {}
                }
            }

            ad.price_for = normalize_price_for(ad.price_for.clone());
        }

        if let Some(mapping) = photo_mapping {
            let key = ad.id.clone().or(ad.avito_id.clone()).unwrap_or_default();
            if let Some(url) = mapping.get(&key) {
                ad.photo_link = Some(url.clone());
            }
        }

        out.push(ad);
    }

    Ok(out)
}

fn resolve_material_id(rule: &UpdateRule, ad: &Ad, key: &str) -> Option<String> {
    if let Some(mid) = &rule.material_id {
        return Some(mid.clone());
    }
    if let Some(mid) = &ad.material_id {
        return Some(mid.clone());
    }
    if let Some((mat_alias, _)) = parse_ad_id_aliases(key) {
        if let Some(mid) = material_id_from_alias(&mat_alias) {
            return Some(mid);
        }
    }
    ad.bulk_material_sub_type.clone()
}

fn normalize_price_for(val: Option<String>) -> Option<String> {
    let v = val?;
    let normalized = v.to_lowercase().trim().to_string();
    if normalized == "тонну" || normalized == "тонна" || normalized == "т" || normalized == "tonnu"
    {
        return Some("тонну".to_string());
    }
    if normalized == "м³"
        || normalized == "м3"
        || normalized == "м^3"
        || normalized.contains('м')
        || normalized.contains("куб")
    {
        return Some("м³".to_string());
    }
    Some(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_ad() -> Ad {
        Ad {
            id: Some("s00_troi_010123-000000_1".to_string()),
            ad_id: Some("s00_troi_010123-000000_1".to_string()),
            price_for: Some("тонна".to_string()),
            ..Ad::default()
        }
    }

    fn canonical_address() -> String {
        "Москва, Троицк, Индустриальная ул., 1".to_string()
    }

    #[test]
    fn auto_description_uses_material_and_address() {
        let ad = sample_ad();
        let mut rule = UpdateRule::default();
        rule.update_description = Some(UpdateDescription::Auto("auto".into()));
        rule.new_address = Some(canonical_address());
        let map = HashMap::from([(ad.id.clone().unwrap(), rule)]);

        let res = apply_updates(vec![ad], &map, None).expect("apply_updates failed");
        let desc = res[0].description.clone().unwrap_or_default();
        assert!(!desc.is_empty(), "description should be generated");
    }

    #[test]
    fn custom_title_picks_from_list() {
        let mut ad = sample_ad();
        ad.title = Some("old".to_string());
        let mut rule = UpdateRule::default();
        rule.custom_title = Some(CustomTitle::List(vec!["t1".to_string(), "t2".to_string()]));
        rule.new_address = Some(canonical_address());
        let map = HashMap::from([(ad.id.clone().unwrap(), rule)]);

        let res = apply_updates(vec![ad], &map, None).expect("apply_updates failed");
        let title = res[0].title.clone().unwrap_or_default();
        assert!(
            title == "t1" || title == "t2",
            "title should be picked from list"
        );
    }

    #[test]
    fn price_for_normalized_when_rule_applies() {
        let ad = sample_ad();
        let mut rule = UpdateRule::default();
        rule.new_address = Some(canonical_address());
        let map = HashMap::from([(ad.id.clone().unwrap(), rule)]);

        let res = apply_updates(vec![ad], &map, None).expect("apply_updates failed");
        assert_eq!(res[0].price_for.as_deref(), Some("тонну"));
    }

    #[test]
    fn invalid_address_returns_error() {
        let ad = sample_ad();
        let mut rule = UpdateRule::default();
        rule.new_address = Some("Unknown address".to_string());
        let map = HashMap::from([(ad.id.clone().unwrap(), rule)]);

        let err = apply_updates(vec![ad], &map, None).unwrap_err();
        assert!(
            err.contains("не найден"),
            "expected error about address validation, got: {}",
            err
        );
    }
}
