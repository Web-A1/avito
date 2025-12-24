use rand::seq::SliceRandom;
use rand::{thread_rng, Rng};

/// Генерация описания по тем же шаблонам и вариативности, что в JS (block1And2/blocks).
pub fn generate_description(
    title: Option<&str>,
    material_id: Option<&str>,
    address: Option<&str>,
) -> String {
    let _ = title;
    let _ = address;
    let mat = material_id.unwrap_or_default();
    ensure_known_material(mat);
    if mat.starts_with("scheben") {
        return generate_rubble_description(mat);
    }
    generate_sand_description(mat)
}

fn generate_sand_description(mat: &str) -> String {
    let mut rng = thread_rng();
    let separators = gen_separators(&mut rng);
    let order = BLOCK_ORDER_VARIANTS
        .choose(&mut rng)
        .copied()
        .unwrap_or(BLOCK_ORDER_VARIANTS[0]);

    let block1 = build_block1_sand(mat, &mut rng);
    let block2 = build_block2_sand(mat, &mut rng);
    let block3 = BLOCK_3_CALL_TO_ACTION_HTML.to_string();
    let block4 = BLOCK_4_ADVANTAGES_HTML.to_string();
    let block5 = BLOCK_5_WORK_HOURS_HTML.to_string();
    let block6 = BLOCK_6_ASSORTMENT_SAND_HTML.to_string();
    let block7 = build_block7_sand(mat, &mut rng);

    let mut blocks = vec![block1, block2, block3, block4, block5, block6, block7];
    let mut ordered = vec![blocks[0].clone(), blocks[1].clone(), blocks[2].clone()];
    for idx in order {
        ordered.push(blocks[*idx].clone());
    }
    ordered.push(blocks[6].clone());

    let mut out = ordered[0].clone();
    for i in 1..ordered.len() {
        out.push_str(&separators[i - 1]);
        out.push_str(&ordered[i]);
    }
    apply_latin_replacements(&out, mat, &mut rng)
}

fn generate_rubble_description(mat: &str) -> String {
    let mut rng = thread_rng();
    let separators = gen_separators(&mut rng);
    let order = BLOCK_ORDER_VARIANTS
        .choose(&mut rng)
        .copied()
        .unwrap_or(BLOCK_ORDER_VARIANTS[0]);

    let block1 = build_block1_rubble(mat, &mut rng);
    let block2 = build_block2_rubble(mat, &mut rng);
    let block3 = BLOCK_3_CALL_TO_ACTION_HTML.to_string();
    let block4 = BLOCK_4_ADVANTAGES_HTML.to_string();
    let block5 = BLOCK_5_WORK_HOURS_HTML.to_string();
    let block6 = BLOCK_6_ASSORTMENT_RUBBLE_HTML.to_string();
    let block7 = build_block7_rubble(mat, &mut rng);

    let mut blocks = vec![block1, block2, block3, block4, block5, block6, block7];
    let mut ordered = vec![blocks[0].clone(), blocks[1].clone(), blocks[2].clone()];
    for idx in order {
        ordered.push(blocks[*idx].clone());
    }
    ordered.push(blocks[6].clone());

    let mut out = ordered[0].clone();
    for i in 1..ordered.len() {
        out.push_str(&separators[i - 1]);
        out.push_str(&ordered[i]);
    }
    apply_latin_replacements(&out, mat, &mut rng)
}

fn build_block1_sand(mat: &str, rng: &mut rand::rngs::ThreadRng) -> String {
    let text = match mat {
        "karier_neseyan_nemyt_pesok" => pick(BLOCK_1_NEMYTYY_NESEYANYY, rng),
        "karier_seyan_nemyt_pesok" => pick(BLOCK_1_SEYANYY_NEMYTYY, rng),
        "karier_seyan_myt_pesok_1.5" => pick_block1_seyanyy_mytyy("1.0–1.5", "мелкий", rng),
        "karier_seyan_myt_pesok_2" => pick_block1_seyanyy_mytyy("1.5–2.0", "средний", rng),
        "karier_seyan_myt_pesok_2.5" => pick_block1_seyanyy_mytyy("2.0–2.5", "крупный", rng),
        _ => pick(BLOCK_1_NEMYTYY_NESEYANYY, rng),
    };
    format!("<p>{}</p>", text)
}

fn build_block1_rubble(mat: &str, rng: &mut rand::rngs::ThreadRng) -> String {
    let text = match mat {
        "scheben_vtorichnyi_5_20" => pick(BLOCK_1_SHEBEN_VTORICHNYI_5_20, rng),
        "scheben_vtorichnyi_40_70" => pick(BLOCK_1_SHEBEN_VTORICHNYI_40_70, rng),
        _ => pick(BLOCK_1_SHEBEN_VTORICHNYI_5_20, rng),
    };
    format!("<p>{}</p>", text)
}

fn build_block2_sand(mat: &str, rng: &mut rand::rngs::ThreadRng) -> String {
    let intro = pick(block2_intro_variants(mat), rng);
    let (headings, list_html) = match mat {
        "karier_neseyan_nemyt_pesok" => (
            BLOCK_2_NEMYTYY_NESEYANYY_HEADINGS,
            BLOCK_2_NEMYTYY_NESEYANYY_HTML,
        ),
        "karier_seyan_nemyt_pesok" => (
            BLOCK_2_SEYANYY_NEMYTYY_HEADINGS,
            BLOCK_2_SEYANYY_NEMYTYY_HTML,
        ),
        "karier_seyan_myt_pesok_1.5" => (
            BLOCK_2_SEYANYY_MYTYY_FINE_HEADINGS,
            BLOCK_2_SEYANYY_MYTYY_FINE_HTML,
        ),
        "karier_seyan_myt_pesok_2" => (
            BLOCK_2_SEYANYY_MYTYY_MEDIUM_HEADINGS,
            BLOCK_2_SEYANYY_MYTYY_MEDIUM_HTML,
        ),
        "karier_seyan_myt_pesok_2.5" => (
            BLOCK_2_SEYANYY_MYTYY_COARSE_HEADINGS,
            BLOCK_2_SEYANYY_MYTYY_COARSE_HTML,
        ),
        _ => (
            BLOCK_2_NEMYTYY_NESEYANYY_HEADINGS,
            BLOCK_2_NEMYTYY_NESEYANYY_HTML,
        ),
    };
    build_block2(intro, pick(headings, rng), list_html, "Минимальный объем 20 м³ (1 самосвал)")
}

fn build_block2_rubble(mat: &str, rng: &mut rand::rngs::ThreadRng) -> String {
    if mat == "scheben_vtorichnyi_5_20" {
        let intro = pick(block2_intro_variants(mat), rng);
        return build_block2_rubble_5_20(intro);
    }

    if mat == "scheben_vtorichnyi_40_70" {
        let intro = pick(block2_intro_variants(mat), rng);
        return build_block2_rubble_40_70(intro);
    }

    let intro = pick(block2_intro_variants("scheben_vtorichnyi_5_20"), rng);
    build_block2_rubble_5_20(intro)
}

fn build_block2(intro: String, heading: String, list_html: &str, minimum: &str) -> String {
    let intro_html = if intro.is_empty() {
        String::new()
    } else {
        format!("<strong>{}</strong>", intro)
    };
    let heading_html = if heading.is_empty() {
        String::new()
    } else {
        format!("<br><br>{}", heading)
    };
    let mut list_part = String::new();
    if !list_html.trim_start().starts_with("<br") {
        list_part.push_str("<br>");
    }
    list_part.push_str(list_html);
    let minimum_html = if minimum.is_empty() {
        String::new()
    } else {
        format!("<br><br>{}", minimum)
    };
    format!("<p>{}{}{}{}<\/p>", intro_html, heading_html, list_part, minimum_html)
}

fn build_block2_rubble_5_20(intro: String) -> String {
    let intro_html = if intro.is_empty() {
        String::new()
    } else {
        format!("<strong>{}</strong>", intro)
    };
    let heading = BLOCK_2_SHEBEN_VTORICHNYI_5_20_HEADINGS
        .get(1)
        .unwrap_or(&BLOCK_2_SHEBEN_VTORICHNYI_5_20_HEADINGS[0]);
    let heading_html = if heading.is_empty() {
        String::new()
    } else {
        format!("<br><br>{}", heading)
    };
    format!(
        "<p>{}{}{}</p>",
        intro_html, heading_html, BLOCK_2_SHEBEN_VTORICHNYI_5_20_HTML
    )
}

fn build_block2_rubble_40_70(intro: String) -> String {
    let intro_html = if intro.is_empty() {
        String::new()
    } else {
        format!("<strong>{}</strong>", intro)
    };
    let heading = BLOCK_2_SHEBEN_VTORICHNYI_40_70_HEADINGS
        .get(1)
        .unwrap_or(&BLOCK_2_SHEBEN_VTORICHNYI_40_70_HEADINGS[0]);
    let heading_html = if heading.is_empty() {
        String::new()
    } else {
        format!("<br><br>{}", heading)
    };
    format!(
        "<p>{}{}{}</p>",
        intro_html, heading_html, BLOCK_2_SHEBEN_VTORICHNYI_40_70_HTML
    )
}

fn build_block7_sand(mat: &str, rng: &mut rand::rngs::ThreadRng) -> String {
    let sand = sand_type(mat);
    let volume = rng.gen_range(BLOCK7_VOLUME_MIN..=BLOCK7_VOLUME_MAX);
    let truck_brand = pick(TRUCK_BRANDS, rng);
    let truck_number = generate_truck_number(rng);
    let xpc = format_num(rand_with_step(rng, 0.01, 9.99, 0.01, 2), 2);
    let gp = format_num(rand_with_step(rng, 0.1, 2.0, 0.1, 1), 1);

    let density_range = sand.density_range.unwrap_or((1350.0, 1450.0));
    let density = format_num(rand_in_range(rng, density_range.0, density_range.1, 0), 0);

    let module_range = sand.module_range.unwrap_or((1.0, 3.0, 3));
    let module = format_num(
        rand_in_range(rng, module_range.0, module_range.1, module_range.2),
        module_range.2,
    );

    let fraction_range = sand.fraction_range.unwrap_or((1.0, 3.0, 2));
    let fraction = format_num(
        rand_in_range(
            rng,
            fraction_range.0,
            fraction_range.1,
            fraction_range.2,
        ),
        fraction_range.2,
    );

    let pnr = format_num(rand_with_step(rng, 0.50, 1.00, 0.05, 2), 2);
    let psi = format_num(rand_with_step(rng, 0.10, 3.00, 0.01, 2), 2);

    format!(
        "<p>{}:<br> - объем: {} м³<br> - самосвал: {} гос. номер: {}<br> - содержание ХПЧ: {} %<br> - содержание ГП: {} %<br> - насыпная плотность D: {} кг/м³<br> - модуль А: {}<br> - фракция А: {}<br> - коэф ПНР: {} кг/см²<br> - коэф 𝜓: {}</p>",
        sand.display_name, volume, truck_brand, truck_number, xpc, gp, density, module, fraction, pnr, psi
    )
}

fn build_block7_rubble(mat: &str, rng: &mut rand::rngs::ThreadRng) -> String {
    let label = rubble_label(mat);
    let volume = rng.gen_range(BLOCK7_VOLUME_MIN..=BLOCK7_VOLUME_MAX);
    let truck_brand = pick(TRUCK_BRANDS, rng);
    let truck_number = generate_truck_number(rng);
    let xpc = format_num(rand_with_step(rng, 0.1, 1.0, 0.01, 2), 2);
    let gp = format_num(rand_with_step(rng, 0.1, 1.5, 0.1, 1), 1);
    let density = format_num(rand_in_range(rng, 1200.0, 1500.0, 1), 1);
    let module = format_num(rand_in_range(rng, 1.4, 3.2, 3), 3);
    let fraction = format_num(rand_in_range(rng, 2.0, 4.0, 3), 3);
    let pnr = format_num(rand_with_step(rng, 0.6, 1.0, 0.05, 2), 2);
    let psi = format_num(rand_with_step(rng, 0.3, 1.5, 0.01, 2), 2);

    format!(
        "<p>{}:<br> - объем: {} м³<br> - самосвал: {} гос. номер: {}<br> - содержание ХПЧ: {} %<br> - содержание ГП: {} %<br> - насыпная плотность D: {} кг/м³<br> - модуль А: {}<br> - фракция А: {}<br> - коэф ПНР: {} кг/см²<br> - коэф 𝜓: {}</p>",
        label, volume, truck_brand, truck_number, xpc, gp, density, module, fraction, pnr, psi
    )
}

fn rubble_label(mat: &str) -> String {
    match mat {
        "scheben_vtorichnyi_5_20" => "Щебень вторичный 5–20 мм".to_string(),
        "scheben_vtorichnyi_40_70" => "Щебень вторичный 40–70 мм".to_string(),
        _ => "Щебень вторичный 40–70 мм".to_string(),
    }
}

fn rand_in_range(
    rng: &mut rand::rngs::ThreadRng,
    min: f64,
    max: f64,
    precision: usize,
) -> f64 {
    if precision == 0 {
        let min_int = min as i64;
        let max_int = max as i64;
        return rng.gen_range(min_int..=max_int) as f64;
    }
    let val: f64 = rng.gen_range(min..=max);
    let s = format!("{:.*}", precision, val);
    s.parse::<f64>().unwrap_or(val)
}

fn rand_with_step(
    rng: &mut rand::rngs::ThreadRng,
    min: f64,
    max: f64,
    step: f64,
    digits: usize,
) -> f64 {
    let steps = ((max - min) / step).floor() as u64 + 1;
    let idx = rng.gen_range(0..steps);
    let val = min + step * idx as f64;
    let s = format!("{:.*}", digits, val);
    s.parse::<f64>().unwrap_or(val)
}

fn generate_truck_number(rng: &mut rand::rngs::ThreadRng) -> String {
    let num: u32 = rng.gen_range(10..=999);
    format!("{:0>3}", num)
}

fn gen_separators(rng: &mut rand::rngs::ThreadRng) -> Vec<String> {
    let length = rng.gen_range(SEPARATOR_MIN_LEN..=SEPARATOR_MAX_LEN);
    let mut seps = Vec::new();
    for i in 0..SEPARATOR_COUNT {
        let after_block2 = i == 1;
        let line_char = if after_block2 && rng.gen_bool(0.5) {
            BLOCK2_SEPARATOR_CHAR
        } else {
            SEPARATOR_CHAR
        };
        let line: String = std::iter::repeat(line_char).take(length).collect();

        let mut space_before = "";
        let mut space_after = "";
        if rng.gen_bool(0.3) {
            let variant: f64 = rng.gen();
            if variant < 0.33 {
                space_before = " ";
            } else if variant < 0.66 {
                space_after = " ";
            } else {
                space_before = " ";
                space_after = " ";
            }
        }

        seps.push(format!("<p>{}{}{}{}</p>", space_before, line, space_after, ""));
    }
    seps
}

fn pick<'a>(arr: &'a [&'a str], rng: &mut rand::rngs::ThreadRng) -> String {
    arr.choose(rng).unwrap_or(&arr[0]).to_string()
}

fn pick_block1_seyanyy_mytyy(
    module_range: &str,
    size: &str,
    rng: &mut rand::rngs::ThreadRng,
) -> String {
    let variants: Vec<String> = BLOCK_1_SEYANYY_MYTYY_TEMPLATES
        .iter()
        .map(|t| t.replace("{module}", module_range).replace("{size}", size))
        .collect();
    variants
        .choose(rng)
        .cloned()
        .unwrap_or_else(|| variants[0].clone())
}

fn block2_intro_variants(mat: &str) -> &'static [&'static str] {
    match mat {
        "karier_neseyan_nemyt_pesok" => BLOCK_2_INTRO_KARIER_NESEYAN_NEMYT,
        "karier_seyan_nemyt_pesok" => BLOCK_2_INTRO_KARIER_SEYAN_NEMYT,
        "karier_seyan_myt_pesok_1.5" => BLOCK_2_INTRO_KARIER_SEYAN_MYT_15,
        "karier_seyan_myt_pesok_2" => BLOCK_2_INTRO_KARIER_SEYAN_MYT_2,
        "karier_seyan_myt_pesok_2.5" => BLOCK_2_INTRO_KARIER_SEYAN_MYT_25,
        "scheben_vtorichnyi_5_20" => BLOCK_2_INTRO_SHEBEN_5_20,
        "scheben_vtorichnyi_40_70" => BLOCK_2_INTRO_SHEBEN_40_70,
        _ => &[],
    }
}

fn sand_type(mat: &str) -> SandType {
    match mat {
        "karier_neseyan_nemyt_pesok" => SandType {
            display_name: "Песок карьерный немытый",
            density_range: Some((1350.0, 1450.0)),
            module_range: Some((1.0, 3.0, 3)),
            fraction_range: Some((1.0, 3.0, 2)),
        },
        "karier_seyan_nemyt_pesok" => SandType {
            display_name: "Песок карьерный сеяный немытый",
            density_range: Some((1650.0, 1750.0)),
            module_range: Some((1.450, 1.550, 3)),
            fraction_range: Some((1.45, 1.55, 2)),
        },
        "karier_seyan_myt_pesok_1.5" => SandType {
            display_name: "Песок карьерный сеяный мытый",
            density_range: Some((1550.0, 1650.0)),
            module_range: Some((1.100, 1.500, 3)),
            fraction_range: Some((1.10, 1.50, 2)),
        },
        "karier_seyan_myt_pesok_2" => SandType {
            display_name: "Песок карьерный сеяный мытый",
            density_range: Some((1550.0, 1650.0)),
            module_range: Some((1.500, 2.000, 3)),
            fraction_range: Some((1.50, 2.00, 2)),
        },
        "karier_seyan_myt_pesok_2.5" => SandType {
            display_name: "Песок карьерный сеяный мытый",
            density_range: Some((1550.0, 1650.0)),
            module_range: Some((2.000, 2.500, 3)),
            fraction_range: Some((2.00, 2.50, 2)),
        },
        _ => SandType {
            display_name: "Песок карьерный немытый",
            density_range: Some((1350.0, 1450.0)),
            module_range: Some((1.0, 3.0, 3)),
            fraction_range: Some((1.0, 3.0, 2)),
        },
    }
}

fn format_num(value: f64, digits: usize) -> String {
    format!("{:.*}", digits, value)
}

#[derive(Clone, Copy)]
struct SandType {
    display_name: &'static str,
    density_range: Option<(f64, f64)>,
    module_range: Option<(f64, f64, usize)>,
        fraction_range: Option<(f64, f64, usize)>,
}

fn ensure_known_material(mat: &str) {
    if !KNOWN_MATERIALS.contains(&mat) {
        panic!("Unknown material_id in description generator: {}", mat);
    }
}

const KNOWN_MATERIALS: &[&str] = &[
    "karier_neseyan_nemyt_pesok",
    "karier_seyan_nemyt_pesok",
    "karier_seyan_myt_pesok_1.5",
    "karier_seyan_myt_pesok_2",
    "karier_seyan_myt_pesok_2.5",
    "scheben_vtorichnyi_5_20",
    "scheben_vtorichnyi_40_70",
];

fn apply_latin_replacements(
    text: &str,
    material_id: &str,
    rng: &mut rand::rngs::ThreadRng,
) -> String {
    let keywords = latin_keywords(material_id);
    let words = extract_words(text, &keywords);
    if words.is_empty() {
        return text.to_string();
    }

    let keyword_indices: Vec<usize> = words
        .iter()
        .enumerate()
        .filter_map(|(i, w)| if w.is_keyword { Some(i) } else { None })
        .collect();

    let selected = select_words_for_replacement(&words, &keyword_indices, rng);
    if selected.is_empty() {
        return text.to_string();
    }

    let mut out = text.to_string();
    let mut selected_words: Vec<(usize, &WordInfo)> = selected
        .into_iter()
        .filter_map(|idx| words.get(idx).map(|w| (idx, w)))
        .collect();
    selected_words.sort_by(|a, b| b.1.start.cmp(&a.1.start));

    for (_, w) in selected_words {
        if let Some(replaced) = replace_letters(&out[w.start..w.end], rng) {
            out.replace_range(w.start..w.end, &replaced);
        }
    }

    out
}

fn latin_keywords(material_id: &str) -> Vec<&'static str> {
    match material_id {
        "karier_neseyan_nemyt_pesok" => &["песок", "карьерный", "немытый"][..],
        "karier_seyan_nemyt_pesok" => &["песок", "карьерный", "сеяный"][..],
        "karier_seyan_myt_pesok_1.5" => {
            &["песок", "карьерный", "сеяный", "мытый", "модуль", "крупности"][..]
        }
        "karier_seyan_myt_pesok_2" => {
            &["песок", "карьерный", "сеяный", "мытый", "модуль", "крупности"][..]
        }
        "karier_seyan_myt_pesok_2.5" => {
            &["песок", "карьерный", "сеяный", "мытый", "модуль", "крупности"][..]
        }
        "scheben_vtorichnyi_5_20" => &["щебень", "вторичный"][..],
        "scheben_vtorichnyi_40_70" => &["щебень", "вторичный"][..],
        _ => &["песок"][..],
    }
    .to_vec()
}

#[derive(Debug, Clone)]
struct WordInfo {
    start: usize,
    end: usize,
    is_keyword: bool,
}

fn extract_words(text: &str, keywords: &[&str]) -> Vec<WordInfo> {
    let kw: std::collections::HashSet<String> =
        keywords.iter().map(|k| k.to_lowercase()).collect();
    let mut out = Vec::new();
    let mut in_tag = false;
    let mut current_start: Option<usize> = None;

    let mut push_word = |start: usize, end: usize, out: &mut Vec<WordInfo>| {
        if start < end {
            let word = &text[start..end];
            let is_kw = kw.contains(&word.to_lowercase());
            out.push(WordInfo {
                start,
                end,
                is_keyword: is_kw,
            });
        }
    };

    for (idx, ch) in text.char_indices() {
        if in_tag {
            if ch == '>' {
                in_tag = false;
            }
            continue;
        }
        if ch == '<' {
            if let Some(s) = current_start.take() {
                push_word(s, idx, &mut out);
            }
            in_tag = true;
            continue;
        }

        let is_word_char = ch.is_alphanumeric() || is_cyr(ch);
        match (current_start, is_word_char) {
            (None, true) => current_start = Some(idx),
            (Some(s), false) => {
                push_word(s, idx, &mut out);
                current_start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = current_start {
        push_word(s, text.len(), &mut out);
    }

    out
}

fn select_words_for_replacement(
    words: &[WordInfo],
    keyword_indices: &[usize],
    rng: &mut rand::rngs::ThreadRng,
) -> Vec<usize> {
    let total = words.len();
    if total == 0 {
        return Vec::new();
    }
    let min_words = ((total as f64 * 0.05).ceil() as usize).max(1);
    let max_words = ((total as f64 * 0.10).ceil() as usize).max(min_words);
    let target = if max_words == min_words {
        min_words
    } else {
        rng.gen_range(min_words..=max_words)
    };

    let mut selected = Vec::new();

    if !keyword_indices.is_empty() {
        let mut kw = keyword_indices.to_vec();
        kw.shuffle(rng);
        let take_kw = if kw.len() >= 2 {
            kw.len().min(4)
        } else {
            1
        };
        selected.extend(kw.into_iter().take(take_kw));
    }

    let mut pool: Vec<usize> = (0..total).collect();
    pool.shuffle(rng);
    for idx in pool {
        if selected.len() >= target {
            break;
        }
        if !selected.contains(&idx) {
            selected.push(idx);
        }
    }

    if selected.len() < 2 && !keyword_indices.is_empty() {
        for &kw in keyword_indices {
            if !selected.contains(&kw) {
                selected.push(kw);
            }
            if selected.len() >= 2 {
                break;
            }
        }
    }

    selected
}

fn replace_letters(word: &str, rng: &mut rand::rngs::ThreadRng) -> Option<String> {
    let mut positions = Vec::new();
    for (i, ch) in word.chars().enumerate() {
        if let Some(rep) = latin_map(ch) {
            positions.push((i, rep));
        }
    }
    if positions.is_empty() {
        return None;
    }
    let replacements = rng.gen_range(1..=positions.len().min(3));
    positions.shuffle(rng);
    let mut chars: Vec<char> = word.chars().collect();
    for (i, rep) in positions.into_iter().take(replacements) {
        chars[i] = rep;
    }
    Some(chars.into_iter().collect())
}

fn latin_map(ch: char) -> Option<char> {
    match ch {
        'а' => Some('a'),
        'е' => Some('e'),
        'о' => Some('o'),
        'с' => Some('c'),
        'х' => Some('x'),
        'р' => Some('p'),
        'у' => Some('y'),
        'А' => Some('A'),
        'В' => Some('B'),
        'С' => Some('C'),
        'Е' => Some('E'),
        'Н' => Some('H'),
        'К' => Some('K'),
        'М' => Some('M'),
        'О' => Some('O'),
        'Р' => Some('P'),
        'Х' => Some('X'),
        _ => None,
    }
}

fn is_cyr(ch: char) -> bool {
    ('а'..='я').contains(&ch) || ('А'..='Я').contains(&ch) || ch == 'ё' || ch == 'Ё'
}

const SEPARATOR_MIN_LEN: usize = 20;
const SEPARATOR_MAX_LEN: usize = 30;
const SEPARATOR_CHAR: char = '_';
const BLOCK2_SEPARATOR_CHAR: char = '=';
const SEPARATOR_COUNT: usize = 6;

const BLOCK7_VOLUME_MIN: i64 = 1000;
const BLOCK7_VOLUME_MAX: i64 = 100000;

// порядок блоков 4-6 (индексы в массиве blocks: 3,4,5)
const BLOCK_ORDER_VARIANTS: &[&[usize]] = &[
    &[3, 4, 5],
    &[3, 5, 4],
    &[4, 3, 5],
    &[4, 5, 3],
    &[5, 3, 4],
    &[5, 4, 3],
];

const BLOCK_3_CALL_TO_ACTION_HTML: &str =
    "<p><strong>☎️ Позвоните нам - мы предложим лучшие решения и поможем с поставкой необходимых материалов для вашего проекта!</strong></p>";
const BLOCK_4_ADVANTAGES_HTML: &str = "<p>
Преимущества NERUDA:
<br>
<br>- Напрямую из карьера
<br> Мы работаем с карьерами напрямую без посредников
<br>
<br>- Coбствeнный автопарк
<br> Наша компания имеет широкий автопарк, состоящий из самосвалов различной грузоподъемности, фронтальных погрузчиков, гусеничных экскаваторов и бульдозеров.
<br>
<br>- Порядок с документами
<br> Мы всегда строго следим за качеством документооборота и всё оформляем официально, что иcключaет спорные ситуации и гарaнтиpует юpидическую защиту для Заказчика.
<br>
<br>- Платите, как Вам удобно
<br>Доступны любые формы оплаты -  наличные, карта, перевод, по счету (для юридических лиц)
</p>";
const BLOCK_5_WORK_HOURS_HTML: &str =
    "<p>Режим работы:<br>- Отдел продаж консультирует Клиентов с 08:00 до 21:00</p>";
const BLOCK_6_ASSORTMENT_SAND_HTML: &str = "<p>Ассортимент товаров в наличии:<br>- Песок: карьерный, сеяный, мытый<br>- Грунт плодородный, ПРС<br>- Грунт глинистый, для отсыпки<br>- Бой бетонный, кирпичный<br>- Асфальтная крошка, отсев</p>";
const BLOCK_6_ASSORTMENT_RUBBLE_HTML: &str = "<p>Ассортимент товаров в наличии:<br>- Щебень: гравийный, гранитный, известняковый, вторичный<br>- Грунт плодородный, ПРС<br>- Грунт глинистый, для отсыпки<br>- Бой бетонный, кирпичный<br>- Асфальтная крошка, отсев</p>";

const BLOCK_1_NEMYTYY_NESEYANYY: &[&str] = &[
    "Карьерный песок немытый для подсыпки, выравнивания и планировки. Подходит для траншей, оснований под плитку и благоустройства. Быстрая доставка, минимальный объем 20 м³",
    "Немытый карьерный песок применяется для подсыпки, выравнивания и планировки территорий. Используется для траншей, оснований под плитку и благоустройства. Доставка от 20 м³",
    "Карьерный песок немытый с быстрой доставкой. Собственный автопарк. Подходит для подсыпки, выравнивания и планировки. Применяется для траншей, оснований под плитку и благоустройства. Минимальный объем 20 м³",
    "Карьерный песок немытый с быстрой доставкой. Собственный транспорт. Подходит для подсыпки, выравнивания и планировки. Применяется для траншей, оснований под плитку и благоустройства. Минимальный объем 20 м³",
    "Карьерный песок немытый с быстрой доставкой. Новые самосвалы. Подходит для подсыпки, выравнивания и планировки. Применяется для траншей, оснований под плитку и благоустройства. Минимальный объем 20 м³",
    "Карьерный песок немытый с быстрой доставкой. Собственный автопарк, новые самосвалы. Подходит для подсыпки, выравнивания и планировки. Применяется для траншей, оснований под плитку и благоустройства. Минимальный объем 20 м³",
    "Карьерный песок немытый с быстрой доставкой. Собственный транспорт, современные самосвалы. Подходит для подсыпки, выравнивания и планировки. Применяется для траншей, оснований под плитку и благоустройства. Минимальный объем 20 м³",
    "Карьерный песок немытый от 20 м³. Используется для подсыпки, выравнивания и планировки. Подходит для траншей, оснований под плитку и благоустройства. Быстрая доставка",
    "Карьерный песок немытый для подсыпки, выравнивания и планировки. Доставка от 20 м³",
    "Качественный карьерный песок немытый для подсыпки, выравнивания и планировки территорий. Подходит для траншей, оснований под плитку и благоустройства. Быстрая доставка, минимальный объем 20 м³",
];

const BLOCK_1_SEYANYY_NEMYTYY: &[&str] = &[
    "Сеяный карьерный песок для подсыпки и оснований. Однородная фракция без крупных включений. Оптимален для подушки под плитку, тротуары, дорожки, обратной засыпки. Доставка от 20 м³",
    "Карьерный песок сеяный применяется для подсыпки и оснований. Однородная фракция без крупных включений. Используется для подушки под плитку, тротуары, дорожки, обратной засыпки. Доставка от 20 м³",
    "Сеяный карьерный песок с быстрой доставкой. Собственный автопарк. Однородная фракция без крупных включений. Оптимален для подушки под плитку, тротуары, дорожки, обратной засыпки. Минимальный объем 20 м³",
    "Сеяный карьерный песок с быстрой доставкой. Собственный транспорт. Однородная фракция без крупных включений. Оптимален для подушки под плитку, тротуары, дорожки, обратной засыпки. Минимальный объем 20 м³",
    "Сеяный карьерный песок с быстрой доставкой. Новые самосвалы. Однородная фракция без крупных включений. Оптимален для подушки под плитку, тротуары, дорожки, обратной засыпки. Минимальный объем 20 м³",
    "Сеяный карьерный песок с быстрой доставкой. Собственный автопарк, новые самосвалы. Однородная фракция без крупных включений. Оптимален для подушки под плитку, тротуары, дорожки, обратной засыпки. Минимальный объем 20 м³",
    "Сеяный карьерный песок с быстрой доставкой. Собственный транспорт, современные самосвалы. Однородная фракция без крупных включений. Оптимален для подушки под плитку, тротуары, дорожки, обратной засыпки. Минимальный объем 20 м³",
    "Сеяный карьерный песок от 20 м³. Однородная фракция без крупных включений. Оптимален для подушки под плитку, тротуары, дорожки, обратной засыпки. Быстрая доставка",
    "Сеяный карьерный песок для подсыпки и оснований. Однородная фракция без крупных включений. Доставка от 20 м³",
    "Качественный сеяный карьерный песок для подсыпки и оснований. Однородная фракция без крупных включений. Оптимален для подушки под плитку, тротуары, дорожки, обратной засыпки. Быстрая доставка, минимальный объем 20 м³",
];

const BLOCK_1_SEYANYY_MYTYY_TEMPLATES: &[&str] = &[
    "Мытый сеяный карьерный песок. Сертифицирован, соответствует ГОСТ. Модуль крупности {module} ({size}). Подходит для бетонных смесей, кладочных и штукатурных работ. Быстрая доставка, напрямую из карьера! Минимальный объем 20 м³",
    "Сеяный мытый карьерный песок применяется для бетонных смесей, кладочных и штукатурных работ. Сертифицирован, соответствует ГОСТ. Модуль крупности {module} ({size}). Доставка напрямую из карьера, от 20 м³",
    "Мытый сеяный карьерный песок с быстрой доставкой. Собственный автопарк. Сертифицирован, соответствует ГОСТ. Модуль крупности {module} ({size}). Подходит для бетонных смесей, кладочных и штукатурных работ. Минимальный объем 20 м³",
    "Мытый сеяный карьерный песок с быстрой доставкой. Собственный транспорт. Сертифицирован, соответствует ГОСТ. Модуль крупности {module} ({size}). Подходит для бетонных смесей, кладочных и штукатурных работ. Минимальный объем 20 м³",
    "Мытый сеяный карьерный песок с быстрой доставкой. Новые самосвалы. Сертифицирован, соответствует ГОСТ. Модуль крупности {module} ({size}). Подходит для бетонных смесей, кладочных и штукатурных работ. Минимальный объем 20 м³",
    "Мытый сеяный карьерный песок с быстрой доставкой. Собственный автопарк, новые самосвалы. Сертифицирован, соответствует ГОСТ. Модуль крупности {module} ({size}). Подходит для бетонных смесей, кладочных и штукатурных работ. Минимальный объем 20 м³",
    "Мытый сеяный карьерный песок с быстрой доставкой. Собственный транспорт, современные самосвалы. Сертифицирован, соответствует ГОСТ. Модуль крупности {module} ({size}). Подходит для бетонных смесей, кладочных и штукатурных работ. Минимальный объем 20 м³",
    "Мытый сеяный карьерный песок от 20 м³. Сертифицирован, соответствует ГОСТ. Модуль крупности {module} ({size}). Подходит для бетонных смесей, кладочных и штукатурных работ. Быстрая доставка, напрямую из карьера",
    "Мытый сеяный карьерный песок. Сертифицирован, соответствует ГОСТ. Модуль крупности {module} ({size}). Доставка от 20 м³",
    "Качественный мытый сеяный карьерный песок. Сертифицирован, соответствует ГОСТ. Модуль крупности {module} ({size}). Подходит для бетонных смесей, кладочных и штукатурных работ. Быстрая доставка, напрямую из карьера! Минимальный объем 20 м³",
    "Мытый сеяный карьерный песок. Модуль крупности {module} ({size}). Сертифицирован, соответствует ГОСТ. Подходит для бетонных смесей, кладочных и штукатурных работ. Быстрая доставка, напрямую из карьера! Минимальный объем 20 м³",
    "Мытый сеяный карьерный песок. Модуль крупности {module} ({size}). Собственный автопарк. Сертифицирован, соответствует ГОСТ. Подходит для бетонных смесей, кладочных и штукатурных работ. Минимальный объем 20 м³",
    "Мытый сеяный карьерный песок. Модуль крупности {module} ({size}). Собственный транспорт, новые самосвалы. Сертифицирован, соответствует ГОСТ. Подходит для бетонных смесей, кладочных и штукатурных работ. Минимальный объем 20 м³",
];

const BLOCK_1_SHEBEN_VTORICHNYI_5_20: &[&str] = &[
    "Вторичный щебень фракции 5–20. Применяется для подстилающих и выравнивающих слоёв, засыпки траншей и котлованов, отсыпки площадок и устройства временных проездов. Быстрая доставка по Москве и области, минимальный объём заказа 20 м³",
    "Щебень вторичный фракции 5–20 мм. Используется для подсыпки, выравнивания и устройства оснований под дорожные и площадочные покрытия. Собственный автопарк, доставка от 20 м³",
    "Вторичный щебень 5–20 мм с быстрой доставкой. Подходит для подсыпки под бетон, тротуары, парковочные и технологические площадки. Минимальный объем поставки — 20 м³",
    "Щебень вторичный фракции 5–20 мм для оснований и подсыпки. Оптимален для подготовки под бетонные и асфальтовые покрытия, дорожки, площадки. Доставка от 20 м³ по Москве и МО",
    "Качественный вторичный щебень 5–20 мм. Применяется для подсыпки и оснований под дорожное и промышленное строительство. Собственный транспорт, оперативная доставка от 20 м³",
];

const BLOCK_1_SHEBEN_VTORICHNYI_40_70: &[&str] = &[
    "Вторичный щебень фракции 40–70. Применяется для отсыпки и поднятия уровня участка, устройства оснований под площадки и проезды, засыпки котлованов и формирования временных дорог. Быстрая доставка по Москве и области, минимальный объём заказа 20 м³",
    "Вторичный щебень фракции 40–70 мм. Используется для устройства оснований под дороги, стоянки, временные и технологические площадки. Собственный автопарк, доставка от 20 м³",
    "Щебень вторичный 40–70 мм с доставкой по Москве и области. Применяется для отсыпки подъездных путей, площадок, укрепления слабых грунтов. Минимальный объем 20 м³",
    "Щебень вторичный крупной фракции 40–70 мм. Подходит для отсыпки въездов, площадок хранения, временных дорог и подготовительных слоев. Быстрая отгрузка от 20 м³",
    "Крупный вторичный щебень 40–70 мм для отсыпки и усиления оснований. Используется в дорожных и общестроительных работах. Доставка самосвалами, минимальный объем 20 м³",
];

const BLOCK_2_NEMYTYY_NESEYANYY_HTML: &str = r#"<ol> <li>Подсыпка и планировка<br> Выравнивание площадок, засыпка траншей, формирование рельефа, черновая подготовка под благоустройство.</li> <li>Подготовка оснований<br> Черновые основания под плитку, брусчатку, дорожные и технические покрытия, подушка под покрытие.</li> <li>Засыпка коммуникаций<br> Используется для подсыпки и защиты инженерных сетей: труб, кабелей, ливневки.</li> <li>Ландшафтные и общестроительные работы<br> Дорожки, газоны, откосы, технические слои, подсыпочные работы.</li> </ol>"#;
const BLOCK_2_NEMYTYY_NESEYANYY_HEADINGS: &[&str] = &[
    "Песок карьерный немытый применяется для:",
    "Для каких работ подходит карьерный песок немытый:",
    "Применение карьерного песка немытого:",
];

const BLOCK_2_SEYANYY_NEMYTYY_HTML: &str = r#"<ol> <li>Подушка под брусчатку и тротуарную плитку<br> Однородная фракция без крупных включений обеспечивает ровное и стабильное основание для укладки плитки и брусчатки.</li> <li>Засыпка инженерных коммуникаций<br> Контролируемое уплотнение и отсутствие мелкого мусора обеспечивают надежную защиту труб, кабелей и ливневых систем.</li> <li>Подушка под основания для покрытий и площадок<br> Равномерный слой без случайных примесей создает стабильное основание под покрытия и площадки.</li> <li>Ландшафтные работы и благоустройство<br> Дорожки, борта, откосы, ровная подсыпка под газоны — везде, где важна предсказуемая фракция и однородность материала.</li> </ol>"#;
const BLOCK_2_SEYANYY_NEMYTYY_HEADINGS: &[&str] = &[
    "Карьерный песок сеяный применяется для:",
    "Где используется сеяный карьерный песок:",
    "Применение карьерного песка сеяного:",
];

const BLOCK_2_SEYANYY_MYTYY_FINE_HTML: &str = r#"<ol> <li>Штукатурные растворы<br> Модуль крупности 1.0–1.5 в нормативных описаниях прямо указан как песок, применяемый в штукатурных составах (внутренних и наружных). Это подтверждается справочниками по модулям крупности и рекомендациями производителей растворов.</li> <li>Кладочные растворы<br> Мелкий песок используется для цементно-песчаных кладочных растворов, особенно для кирпичной кладки, где нужен тонкий, пластичный раствор.</li> <li>Ремонтные и мелкозернистые растворные смеси<br> Производители сухих смесей используют песок МК 1.0–1.5 как наполнитель для мелкозернистых ремонтных и монтажных составов (тонкослойные ремонтные растворы, выравнивающие смеси).</li> <li>Сухие строительные смеси (ССС) мелой фракции<br> Этот модуль крупности применяется как наполнитель в производстве сухих смесей, где требуется мелкая фракция: штукатурные смеси, кладочные смеси, тонкослойные ремонтные составы.</li> </ol>"#;
const BLOCK_2_SEYANYY_MYTYY_FINE_HEADINGS: &[&str] = &[
    "Мытый сеяный песок (мелкий) применяется для:",
    "Применение сеяного мытого песка, модуль 1.0–1.5:",
    "Где используется мытый сеяный песок (мелкий):",
];

const BLOCK_2_SEYANYY_MYTYY_MEDIUM_HTML: &str = r#"<ol> <li>Кладочные растворы<br> Используется для приготовления цементно-песчаных растворов для кирпичной и блочной кладки, обеспечивая достаточную пластичность и прочность состава.</li> <li>Растворы общего строительного назначения<br> Применяется в универсальных цементно-песчаных смесях для монтажных и черновых работ, где требуется стандартная зернистость наполнителя.</li> <li>Замоноличивание и заполнение<br> Подходит для заполнения и уплотнения штроб, швов, технологических пазов и других конструктивных пустот при общестроительных работах.</li> </ol>"#;
const BLOCK_2_SEYANYY_MYTYY_MEDIUM_HEADINGS: &[&str] = &[
    "Мытый сеяный песок (средний) применяется для:",
    "Применение сеяного мытого песка, модуль 1.5–2.0:",
    "Где используется мытый сеяный песок (средний):",
];

const BLOCK_2_SEYANYY_MYTYY_COARSE_HTML: &str = r#"<ol> <li>Бетоны повышенной прочности<br> Применяется в бетонных смесях для конструкционных элементов, фундаментных блоков и дорожных бетонных слоёв. Крупная фракция обеспечивает меньшую усадку, высокую плотность и устойчивость бетона, что недостижимо при использовании мелких песков.</li> <li>Дорожные и площадочные основания<br> Используется в несущих слоях под дороги, парковки, подъездные пути и промышленные площадки. Обеспечивает максимальную дренируемость и стабильность основания, повышает несущую способность покрытия.</li> <li>Дренажные и фильтрующие слои<br> Подходит для дренажных систем, фильтрующих подложек, водоотводных слоёв. Обеспечивает высокую водопроницаемость и предотвращает заиливание, что невозможно при применении мелкого песка.</li> <li>Подушки под основания и фундаментные плиты<br> Используется в несущих песчаных подложках под основания, фундаментные плиты и массивные конструкции. Крупная фракция формирует прочный, влагоустойчивый и стабильно уплотняемый слой.</li> </ol>"#;
const BLOCK_2_SEYANYY_MYTYY_COARSE_HEADINGS: &[&str] = &[
    "Мытый сеяный песок (крупный) применяется для:",
    "Применение сеяного мытого песка, модуль 2.0–2.5:",
    "Где используется мытый сеяный песок (крупный):",
];

const BLOCK_2_SHEBEN_VTORICHNYI_5_20_HTML: &str = r#"<br>
<br> 1. Подстилaющиe и выравнивающие слои
<br> Подготовка основания под бетонные стяжки, плиты, тротуары, дорожки, парковoчные и складские площадки.
<br> 
<br> 2. Засыпка траншей и котлованов
<br> Обратная засыпка и выравнивание траншей под коммуникации, котлованов и локальных понижений рельефа.
<br> 
<br> 3. Основания под площадки и проезды
<br> Формирование несущих слоёв под подъездные пути, внутренние проезды, стоянки и технологические зоны.
<br>
<br> 4. Временные и вспомогательные дорожные конструкции
<br> Устройство временных дорог и проездов для строительной техники, организованных площадок складирования и разгрузки.
<br>
<br> Минимальный объём поставки — 20 м³ (1 самосвал)"#;
const BLOCK_2_SHEBEN_VTORICHNYI_5_20_HEADINGS: &[&str] = &[
    "Вторичный щебень 5–20 применяется для:",
    "Где используется вторичный щебень 5–20:",
    "Применение вторичного щебня фракции 5–20:",
];

const BLOCK_2_SHEBEN_VTORICHNYI_40_70_HTML: &str = r#"<br>
<br> 1. Отсыпка и поднятие уровня участка
<br> Формирование насыпей и поднятие отметки участка, выравнивание рельефа перед устройством оснований и покрытий.
<br> 
<br> 2. Основания под площадки и проезды
<br> Устройство несущих слоёв под площадки хранения, стоянки, подъездные пути и внутренние проезды по участку.
<br> 
<br> 3. Засыпка котлованов и укрепление слабых грунтов
<br> Заполнение котлованов, засыпка выработок и локальных понижений с одновременным уплотнением и усилением основания.
<br> 
<br> 4. Временные и постоянные дороги
<br> Отсыпка временных и вспомогательных дорог для строительной техники, подготовка основания под последующие дорожные слои.
<br>
<br>Минимальный объём поставки — 20 м³ (1 самосвал)"#;
const BLOCK_2_SHEBEN_VTORICHNYI_40_70_HEADINGS: &[&str] = &[
    "Вторичный щебень 40–70 применяется для:",
    "Где используется вторичный щебень 40–70:",
    "Применение вторичного щебня фракции 40–70:",
];

const BLOCK_2_INTRO_KARIER_NESEYAN_NEMYT: &[&str] = &[
    "Карьерный песок — природный песок, добываемый в карьере без просеивания и промывки, со смешанным зерновым составом и естественным содержанием мелких примесей.",
    "Песок карьерный — природный материал из карьера без дополнительной обработки, несеяный, сохраняет разнозернистую фракцию и природные пылевые и глинистые включения.",
    "Природный карьерный песок — нерудный материал, добывающийся прямо из карьера без промывки и просеивания, разнозернистый, с естественными пылевыми и глинистыми примесями.",
];
const BLOCK_2_INTRO_KARIER_SEYAN_NEMYT: &[&str] = &[
    "Карьерный песок сеяный — природный песок, добываемый в карьере, прошедший механическое просеивание для удаления крупных включений, без промывки, с сохранением естественных пылевидных и глинистых примесей.",
    "Сеяный карьерный песок — песок из карьера после просеивания от крупных камней, без промывки, оставляет натуральные мелкие примеси.",
    "Просеянный карьерный песок — природный материал, очищенный механическим путем от крупных включений и мусора, немытый. Процесс просеивания позволяет выровнять фракцию, при этом в составе сохраняются естественное количество природных пылевых и глинистых включений.",
];
const BLOCK_2_INTRO_KARIER_SEYAN_MYT_15: &[&str] = &[
    "Мытый сеяный песок 1.0–1.5 (мелкий) — карьерный песок, добываемый в карьере, прошедший просеивание и промывку, с мелким зерновым составом (модуль крупности 1.0–1.5), минимальным содержанием пылевидных и глинистых примесей, соответствует ГОСТ, сертифицирован.",
    "Мелкий мытый песок 1.0–1.5 — карьерный песок, прошедший промывку и просеивание до однородной мелкой фракции (МК 1.0–1.5) с минимальным содержанием пылевидных и глинистых частиц, соответствует ГОСТ, сертифицирован.",
    "Мытый мелкий песок (модуль 1.0–1.5) - карьерный песок, прошедший просеивание и промывку, с равномерной мелкой зернистостью и сниженным уровнем пыли и глины в соответствии ГОСТ 8736-2014, сертифицирован.",
];
const BLOCK_2_INTRO_KARIER_SEYAN_MYT_2: &[&str] = &[
    "Мытый сеяный песок 1.5–2.0 (средний) — карьерный песок, прошедший просеивание и промывку, со средним зерновым составом (модуль крупности 1.5–2.0), минимальным содержанием пылевидных и глинистых примесей, соответствует ГОСТ, сертифицирован.",
    "Средний мытый песок 1.5–2.0 — карьерный песок после промывки и просеивания, с устойчивой средней фракцией (МК 1.5–2.0) и минимальным содержанием пыли и глинистых включений, соответствует ГОСТ, сертифицирован.",
    "Мытый песок средней фракции (МК 1.5–2.0) - карьерный песок, просеяный и промытый, имеет ровную среднюю зернистость и сниженный уровень пылевых и глинистых частиц. Соответствует ГОСТ 8736-2014 «Песок для строительных работ».",
];
const BLOCK_2_INTRO_KARIER_SEYAN_MYT_25: &[&str] = &[
    "Мытый сеяный карьерный песок 2.0–2.5 (крупный) — карьерный песок, прошедший просеивание и промывку, с крупным зерновым составом (МК 2.0–2.5) и минимальным содержанием пылевидных и глинистых примесей, соответствует ГОСТ, сертифицирован.",
    "Крупный мытый песок 2.0–2.5 — карьерный песок после промывки и просеивания, с однородной крупной фракцией и сниженным содержанием пылевидных и глинистых включений, соответствует ГОСТ, сертифицирован.",
    "Мытый песок крупной фракции (МК 2.0–2.5) - карьерный песок, просеяный и промытый, имеет крупную зернистость и минимальный уровень пылевых и глинистых частиц. Соответствует ГОСТ 8736-2014 «Песок для строительных работ»",
];
const BLOCK_2_INTRO_SHEBEN_5_20: &[&str] = &[
    "Вторичный щебень 5–20 мм — щебень из дроблёного бетона и кирпича после вторичной переработки, отсортированный по мелкой фракции 5–20 мм, без крупных включений.",
];
const BLOCK_2_INTRO_SHEBEN_40_70: &[&str] = &[
    "Вторичный щебень 40–70 мм — щебень из дроблёного бетона и кирпича, образованный в результате вторичной переработки, отсортированный по размерам частиц 40–70 мм.",
    "Вторичный щебень 40–70 мм — щебень из дроблёного бетона и кирпича после вторичной переработки, отсортированный по крупной фракции 40–70 мм, без посторонних крупных включений.",
    "Щебень вторичный фракции 40–70 — переработанный бетон и кирпич, измельчённые и отсортированные по размеру частиц 40–70 мм. Материал очищен от крупного мусора и сторонних примесей.",
];

const TRUCK_BRANDS: &[&str] = &[
    "Shacman",
    "FAW",
    "Sinotruk",
    "Foton",
    "Dongfeng",
    "JAC",
    "Howo",
    "Shaanxi",
    "Beiben",
    "CAMC",
    "Dayun",
    "JMC",
    "Scania",
    "Volvo",
    "Iveco",
    "MAN",
    "Mercedes-Benz",
    "DAF",
    "Renault",
    "Ford",
];

#[cfg(test)]
mod tests {
    use super::generate_description;

    #[test]
    fn print_sample_descriptions() {
        let sand = generate_description(
            Some("Песок карьерный немытый"),
            Some("karier_neseyan_nemyt_pesok"),
            Some("Московская обл., Бронницы, Магистральная ул., 3"),
        );
        let rubble = generate_description(
            Some("Щебень вторичный 40–70"),
            Some("scheben_vtorichnyi_40_70"),
            Some("Московская обл., Подольск, ул. Лапшенкова, 3"),
        );

        println!("--- RUST sand ---\n{}\n", sand);
        println!("--- RUST rubble ---\n{}\n", rubble);
    }
}
