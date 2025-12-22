use std::collections::HashMap;

use crate::{
    generate_description, Ad, CustomTitle, UpdateByLists, UpdateDescription, UpdateRule,
    UpdateRules,
};

#[derive(Debug, Default)]
pub struct UpdateResult {
    pub updated_ads: Vec<Ad>,
}

fn rule_for_id<'a>(map: &'a mut HashMap<String, UpdateRule>, id: &'a str) -> &'a mut UpdateRule {
    map.entry(id.to_string())
        .or_insert_with(UpdateRule::default)
}

fn apply_by_lists(
    map: &mut HashMap<String, UpdateRule>,
    by_lists: &UpdateByLists,
    current_ads: &[Ad],
) {
    // updateAll: применяем updatePhoto=true ко всем, опционально updateDescription=auto
    if by_lists.update_all.unwrap_or(false) {
        for ad in current_ads {
            if let Some(key) = ad.id.clone().or(ad.avito_id.clone()) {
                let rule = rule_for_id(map, &key);
                rule.update_photo = Some(true);
                if by_lists.update_description_for_all.unwrap_or(false) {
                    rule.update_description = Some(UpdateDescription::Auto("auto".into()));
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

/// Построить карту правил обновления по Id/AvitoId, учитывая byId и byLists.
pub fn build_update_map(
    update_rules: &UpdateRules,
    current_ads: &[Ad],
) -> HashMap<String, UpdateRule> {
    let mut map = HashMap::new();
    if let Some(by_id) = &update_rules.by_id {
        for (k, v) in by_id {
            map.insert(k.clone(), v.clone());
        }
    }
    if let Some(by_lists) = &update_rules.by_lists {
        apply_by_lists(&mut map, by_lists, current_ads);
    }
    map
}

/// Применить правила обновления к объявлениям из Excel.
/// Здесь только простая перекладка полей (описание/заголовок/адрес/фото), без генерации текстов.
pub fn apply_updates(
    ads: Vec<Ad>,
    updates: &HashMap<String, UpdateRule>,
    photo_mapping: Option<&HashMap<String, String>>,
) -> Vec<Ad> {
    ads.into_iter()
        .map(|mut ad| {
            let key = ad.id.clone().or(ad.avito_id.clone()).unwrap_or_default();
            if let Some(rule) = updates.get(&key) {
                if let Some(addr) = &rule.new_address {
                    ad.address = Some(addr.clone());
                }
                if let Some(material_id) = &rule.material_id {
                    ad.material_id = Some(material_id.clone());
                }
                if let Some(UpdateDescription::Manual(desc)) = &rule.update_description {
                    ad.description = Some(desc.clone());
                }
                if let Some(UpdateDescription::Auto(_)) = &rule.update_description {
                    let title = ad.title.as_deref();
                    let material_id = ad.material_id.as_deref();
                    let address = ad.address.as_deref();
                    ad.description = Some(generate_description(title, material_id, address));
                }
                if let Some(title) = &rule.custom_title {
                    match title {
                        CustomTitle::Single(t) => ad.title = Some(t.clone()),
                        CustomTitle::List(list) if !list.is_empty() => {
                            ad.title = Some(list[0].clone());
                        }
                        _ => {}
                    }
                }
            }
            if let Some(mapping) = photo_mapping {
                let key = ad.id.clone().or(ad.avito_id.clone()).unwrap_or_default();
                if let Some(url) = mapping.get(&key) {
                    ad.photo_link = Some(url.clone());
                }
            }
            ad
        })
        .collect()
}
