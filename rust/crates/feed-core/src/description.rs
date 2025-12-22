pub fn generate_description(title: Option<&str>, material_id: Option<&str>, address: Option<&str>) -> String {
    let label = title
        .filter(|t| !t.trim().is_empty())
        .map(|t| t.trim().to_string())
        .or_else(|| material_id.map(material_id_to_label))
        .unwrap_or_else(|| "Сыпучий материал".to_string());

    let delivery = address
        .filter(|a| !a.trim().is_empty())
        .map(|a| format!("Доставка по адресу: {}", a.trim()))
        .unwrap_or_else(|| "Доставка по Москве и области".to_string());

    format!(
        "{}. {}. В наличии. Работаем ежедневно, возможен самовывоз. Звоните или пишите для расчёта объёма и стоимости.",
        label, delivery
    )
}

fn material_id_to_label(material_id: &str) -> String {
    match material_id {
        "karier_neseyan_nemyt_pesok" => "Песок карьерный несеяный немытый",
        "karier_seyan_nemyt_pesok" => "Песок карьерный сеяный немытый",
        "karier_seyan_myt_pesok_1.5" => "Песок карьерный сеяный мытый мк 1.5 (мелкий)",
        "karier_seyan_myt_pesok_2" => "Песок карьерный сеяный мытый мк 2 (средний)",
        "karier_seyan_myt_pesok_2.5" => "Песок карьерный сеяный мытый мк 2.5 (крупный)",
        "scheben_vtorichnyi_5_20" => "Щебень вторичный 5–20",
        "scheben_vtorichnyi_40_70" => "Щебень вторичный 40–70",
        _ => "Сыпучий материал",
    }
    .to_string()
}
