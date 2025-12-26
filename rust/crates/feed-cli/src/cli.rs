use clap::Parser;
use dotenvy::dotenv;
use feed_core::{
    read_ads_from_excel, read_plan, validate_plan_counts, validate_plan_step_intervals,
    validate_plan_windows, FeedConfig, PlanValidationError,
};

use crate::photo::{generate_photos, read_photo_mapping, upload_photos};
use crate::util::{cleanup_output, default_date_label, find_single_xlsx, sanitize_label_for_file};
use feed_core::PhotoOptions;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::SystemTime;

#[derive(Parser, Debug)]
#[command(author, version, about)]
pub struct Args {
    /// Путь к плану (plan.json)
    #[arg(long, default_value = "data/plan.json")]
    plan: PathBuf,

    /// Путь к Excel с текущими объявлениями
    #[arg(long, default_value = "data/current")]
    current_dir: PathBuf,

    /// Путь к правилам обновления (update_old_ads.json)
    #[arg(long, default_value = "update_old_ads.json")]
    update_rules: PathBuf,

    /// Путь к конфигу (окон/шага)
    #[arg(long, default_value = "config/feed.json")]
    config: PathBuf,

    /// Запустить этапы фото (generate/upload) через JS
    #[arg(long, default_value_t = false)]
    photos: bool,

    /// Запустить генерацию фото на Rust (замена JS generate-photo-variants.js)
    #[arg(long, default_value_t = false)]
    photos_rust: bool,

    /// Корневой каталог на Я.Диске
    #[arg(long, default_value = "Cursor_for_Avito")]
    disk_root: String,

    /// Каталог вывода (совпадает с JS upload-photos.js --out)
    #[arg(long, default_value = "output")]
    out_dir: PathBuf,

    /// Каталог для сгенерированных фото (используется и для Rust-генератора, и для upload)
    #[arg(long, default_value = "output/photos")]
    photos_dir: PathBuf,

    /// Корень исходников фото (по умолчанию data/photos)
    #[arg(long, default_value = "data/photos")]
    photos_root: PathBuf,

    /// Количество фото на локацию, если не задано в плане
    #[arg(long, default_value_t = 1)]
    photos_default_count: u32,

    /// Прозрачность текстового водяного знака (перекрывает defaults/overrides)
    #[arg(long)]
    photos_text_opacity: Option<f64>,

    /// Прозрачность паттерна/шума (перекрывает defaults/overrides)
    #[arg(long)]
    photos_pattern_opacity: Option<f64>,

    /// Цвет текста водяного знака (#RRGGBB)
    #[arg(long)]
    photos_text_color: Option<String>,

    /// Текст водяного знака
    #[arg(long)]
    photos_text: Option<String>,

    /// Метка даты для фото/маппинга (если не задана — берется текущее время)
    #[arg(long, default_value = "")]
    date_label: String,

    /// Путь к готовому photos_links_*.json (если нужно прочитать маппинг без запуска upload)
    #[arg(long)]
    photos_mapping: Option<PathBuf>,

    /// Использовать встроенную загрузку фото на Я.Диск (без JS upload-photos.js)
    #[arg(long, default_value_t = false)]
    upload_rust: bool,

    /// Очистка каталога вывода от старых ads/manifest/photos_links
    #[arg(long, default_value_t = false)]
    cleanup: bool,

    /// Сгенерировать шаблон watermark-overrides.json (по маске файлов) и выйти
    #[arg(long)]
    make_wm_template: Option<String>,

    /// Превью водяных знаков: исходник
    #[arg(long)]
    photos_preview: Option<PathBuf>,

    /// Список opacity через запятую для превью (по умолчанию 0.04,0.06,0.08,0.10,0.12)
    #[arg(long, default_value = "0.04,0.06,0.08,0.10,0.12")]
    preview_opacities: String,

    /// Куда складывать превью (по умолчанию output/photos_preview)
    #[arg(long, default_value = "output/photos_preview")]
    preview_out: PathBuf,

    /// Сравнить итоговый XML с эталоном (удобно для сверки с JS) после генерации
    #[arg(long)]
    xml_compare: Option<PathBuf>,
}

pub fn run() {
    dotenv().ok();
    let args = Args::parse();

    if let Some(glob) = &args.make_wm_template {
        match feed_core::generate_overrides_template(glob, false) {
            Ok(list) => {
                let path = std::path::PathBuf::from("data/watermark-overrides.json");
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).ok();
                }
                let json = serde_json::to_string_pretty(&list).unwrap_or_else(|_| "[]".to_string());
                match std::fs::write(&path, json) {
                    Ok(_) => {
                        println!(
                            "Шаблон watermark-overrides записан: {} ({} записей)",
                            path.display(),
                            list.len()
                        );
                    }
                    Err(e) => eprintln!("Не удалось записать шаблон overrides: {}", e),
                }
            }
            Err(e) => eprintln!("Ошибка генерации шаблона overrides: {}", e),
        }
        return;
    }

    if let Some(src) = &args.photos_preview {
        let ops = parse_opacities(&args.preview_opacities);
        let overrides_path = std::path::PathBuf::from("data/watermark-overrides.json");
        let overrides = feed_core::load_overrides(&overrides_path).unwrap_or_default();
        let opts = PhotoOptions {
            out_dir: args.preview_out.clone(),
            pattern_opacity: args.photos_pattern_opacity,
            text_opacity: args.photos_text_opacity,
            text_color: args.photos_text_color.clone(),
            text_watermark: args.photos_text.clone().or(Some("NERUDA".into())),
            overrides,
            count: 1,
        };
        match feed_core::generate_preview_grid(src, &ops, &opts) {
            Ok(v) => println!("Сгенерировано превью: {}", v.len()),
            Err(e) => {
                eprintln!("Ошибка превью: {}", e);
                std::process::exit(1);
            }
        }
        return;
    }

    let cfg = FeedConfig::load(&args.config).unwrap_or_else(|_| FeedConfig::default());
    let plan = read_plan(&args.plan).unwrap_or_else(|e| {
        eprintln!("Не удалось прочитать план: {}", e);
        std::process::exit(1);
    });
    if plan.tasks.is_empty() || plan.publication_queue.is_empty() {
        eprintln!("План пустой или отсутствует publicationQueue");
        std::process::exit(1);
    }

    if let Err(e) = validate_plan_counts(&plan) {
        fail(e);
    }
    if let Err(e) = validate_plan_windows(&plan, &cfg) {
        fail(e);
    }
    if let Err(e) = validate_plan_step_intervals(&plan, &cfg) {
        fail(e);
    }

    // Чтение Excel (каркас; ошибки не блокируют валидацию плана)
    let mut current_ads = Vec::new();
    if let Some(path) = find_single_xlsx(&args.current_dir) {
        match read_ads_from_excel(&path) {
            Ok(ads) => current_ads = ads,
            Err(e) => eprintln!(
                "Excel прочитан с ошибкой (не критично для валидаций): {}",
                e
            ),
        }
    }

    // Чтение правил обновления (для будущих шагов)
    let update_rules_path = resolve_optional_parent(&args.update_rules);
    let update_rules = feed_core::read_update_rules(&update_rules_path).ok();

    if args.photos && args.photos_rust {
        eprintln!("Нужно выбрать либо --photos (JS), либо --photos-rust (Rust)");
        std::process::exit(1);
    }
    if args.photos && args.upload_rust {
        eprintln!("Нужно выбрать либо --photos (JS), либо --upload-rust (Rust), но не оба сразу");
        std::process::exit(1);
    }

    let date_label = if args.date_label.is_empty() {
        default_date_label()
    } else {
        args.date_label.clone()
    };

    // Генерация фото на Rust (без загрузки)
    if args.photos_rust {
        let overrides_path = std::path::PathBuf::from("data/watermark-overrides.json");
        let overrides = feed_core::load_overrides(&overrides_path).unwrap_or_else(|e| {
            eprintln!(
                "Не удалось загрузить watermark-overrides.json (используем дефолты): {}",
                e
            );
            Vec::new()
        });
        let opts = PhotoOptions {
            out_dir: args.photos_dir.clone(),
            pattern_opacity: args.photos_pattern_opacity,
            text_opacity: args.photos_text_opacity,
            text_color: args.photos_text_color.clone(),
            text_watermark: args.photos_text.clone(),
            overrides,
            count: args.photos_default_count.max(1),
        };
        match feed_core::generate_plan_photos(&plan, &args.photos_root, &date_label, &opts) {
            Ok(variants) => {
                println!(
                    "Rust: сгенерировано {} фото ({} исходников)",
                    variants.len(),
                    variants
                        .iter()
                        .map(|v| v.source.clone())
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                );
                println!("Каталог фото: {}", args.photos_dir.display());
            }
            Err(e) => {
                eprintln!("Ошибка генерации фото на Rust: {}", e);
                std::process::exit(1);
            }
        }
    }

    // Фото-этапы через JS (опционально), Rust upload или чтение готового маппинга
    let mut photo_map: Option<HashMap<String, String>> = None;
    if args.photos {
        println!("→ Генерация фото через JS...");
        if let Err(e) = generate_photos(&args.plan) {
            fail(PlanValidationError::CountsMismatch(format!(
                "Генерация фото: {}",
                e
            )));
        }

        println!("→ Загрузка фото через JS...");
        if let Err(e) = upload_photos(&args.plan, &args.disk_root, &date_label, &args.out_dir) {
            fail(PlanValidationError::CountsMismatch(format!(
                "Загрузка фото: {}",
                e
            )));
        }

        let mapping_path = if let Some(p) = &args.photos_mapping {
            p.clone()
        } else {
            let mut p = args.out_dir.clone();
            p.push(format!("photos_links_{}.json", date_label));
            p
        };

        photo_map = load_mapping(&mapping_path);
    }

    if args.upload_rust {
        match crate::photo::upload_photos_rust(
            &args.photos_dir,
            &args.disk_root,
            &date_label,
            &args.out_dir,
        ) {
            Ok(mapping) => {
                photo_map = Some(mapping_to_map(mapping));
            }
            Err(e) => {
                eprintln!("Ошибка загрузки фото на Я.Диск: {}", e);
                std::process::exit(1);
            }
        }
    } else if let Some(mapping_path) = &args.photos_mapping {
        photo_map = load_mapping(mapping_path);
    }

    // Применение правил обновления к старым объявлениям (без генерации текстов)
    let updated_current = if let Some(rules) = update_rules {
        let rules_map = feed_core::build_update_map(&rules, &current_ads);
        let updated = feed_core::apply_updates(current_ads, &rules_map, photo_map.as_ref())
            .unwrap_or_else(|e| {
                eprintln!("Ошибка применения правил обновления: {}", e);
                std::process::exit(1);
            });
        println!(
            "Старые объявления после применения правил: {}",
            updated.len()
        );
        updated
    } else {
        current_ads
    };

    // Генерация новых объявлений строго по publicationQueue
    let mut new_ads = Vec::new();
    if let Some(pm) = &photo_map {
        let existing_ids: std::collections::HashSet<String> = updated_current
            .iter()
            .filter_map(|ad| ad.ad_id.clone().or(ad.id.clone()).or(ad.avito_id.clone()))
            .collect();
        match feed_core::generate_new_ads(&plan, pm, &existing_ids) {
            Ok(ads) => {
                println!("Сгенерировано новых объявлений: {}", ads.len());
                new_ads = ads;
            }
            Err(e) => {
                eprintln!("Ошибка генерации новых объявлений: {}", e);
                std::process::exit(1);
            }
        }
        if new_ads.len() >= 2 {
            if let Err(e) = validate_base_price_share(&new_ads) {
                eprintln!("Валидация цен: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        println!("Фото-маппинг не загружен, новые объявления не генерируются");
    }

    let old_count = updated_current.len();
    let new_count = new_ads.len();
    let total_ads = old_count + new_count;
    let all_ads: Vec<feed_core::Ad> = updated_current
        .into_iter()
        .chain(new_ads.into_iter())
        .collect();

    println!(
        "Итоговые объявления для XML: всего {}, старых {}, новых {}",
        total_ads, old_count, new_count
    );

    // Генерация XML и манифеста
    let xml_label = date_label.clone();
    let file_label = sanitize_label_for_file(&xml_label);
    let xml = match feed_core::generate_xml(&all_ads, Some(&xml_label)) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("Ошибка генерации XML: {}", e);
            std::process::exit(1);
        }
    };
    if !args.out_dir.exists() {
        std::fs::create_dir_all(&args.out_dir).ok();
    }
    let xml_path = args.out_dir.join(format!("ads_{}.xml", file_label));
    if let Err(e) = std::fs::write(&xml_path, &xml) {
        eprintln!("Ошибка записи XML: {}", e);
        std::process::exit(1);
    }

    // manifest
    let ad_ids: Vec<String> = all_ads
        .iter()
        .filter_map(|ad| ad.ad_id.clone().or(ad.id.clone()).or(ad.avito_id.clone()))
        .collect();
    let manifest = serde_json::json!({
        "date": xml_label,
        "timestamp": SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs(),
        "count": ad_ids.len(),
        "adIds": ad_ids,
    });
    let manifest_path = args
        .out_dir
        .join(format!("ads_{}_manifest.json", file_label));
    if let Err(e) = std::fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    ) {
        eprintln!("Ошибка записи манифеста: {}", e);
    }

    // build-log
    let build_log = serde_json::json!({
        "status": "success",
        "timestamp": SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs(),
        "counts": { "old": old_count, "new": new_count, "total": total_ads },
        "files": { "xml": xml_path.file_name().unwrap_or_default(), "manifest": manifest_path.file_name().unwrap_or_default() },
    });
    let build_log_path = args.out_dir.join(format!("build-log_{}.json", file_label));
    let _ = std::fs::write(
        &build_log_path,
        serde_json::to_string_pretty(&build_log).unwrap_or_default(),
    );

    // Очистка output от старых файлов
    if args.cleanup {
        cleanup_output(
            &args.out_dir,
            &[
                xml_path.file_name().and_then(|s| s.to_str()).unwrap_or(""),
                manifest_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(""),
            ],
        );
    }

    // Сравнение XML с эталоном (опционально)
    if let Some(ref_path) = &args.xml_compare {
        match compare_xml(&xml_path, ref_path) {
            Ok(true) => println!("XML совпадает с эталоном ({})", ref_path.display()),
            Ok(false) => eprintln!(
                "XML отличается от эталона ({}). Проверьте расхождения.",
                ref_path.display()
            ),
            Err(e) => eprintln!("Сравнение XML не удалось: {}", e),
        }
    }

    println!("XML записан: {}", xml_path.display());
    println!("Манифест записан: {}", manifest_path.display());
    println!("build-log записан: {}", build_log_path.display());
    println!(
        "OK: план валиден (counts/windows/steps). Объявлений собрано: {}.",
        all_ads.len()
    );
}

fn fail(err: PlanValidationError) -> ! {
    eprintln!("Ошибка валидации: {:?}", err);
    std::process::exit(1);
}

/// Если файл по относительному пути не найден, пробуем подняться на уровень выше (удобно при запуске из rust/).
fn resolve_optional_parent(path: &PathBuf) -> PathBuf {
    if path.exists() {
        return path.clone();
    }
    if !path.is_absolute() {
        let mut alt = PathBuf::from("..");
        alt.push(path);
        if alt.exists() {
            return alt;
        }
    }
    path.clone()
}
fn mapping_keys(item: &feed_core::PhotoMappingItem) -> Vec<String> {
    if let Some(id) = &item.avito_id {
        return vec![id.clone()];
    }
    let mut out = Vec::new();
    if let Some(file) = &item.file_name {
        let lower = file.to_ascii_lowercase();
        let trimmed = lower
            .trim_end_matches(".jpg")
            .trim_end_matches(".jpeg")
            .trim_end_matches(".png");
        if !trimmed.is_empty() {
            out.push(trimmed.to_string());
            let parts: Vec<&str> = trimmed.split('_').collect();
            if parts.len() == 5 {
                // JS-формат: matAlias/_variant_/city/date/counter -> нормализуем к mat_city_date_counter
                let alt = format!("{}_{}_{}_{}", parts[0], parts[2], parts[3], parts[4]);
                out.push(alt);
            }
            // Чистое фото (_1) уникально на basename+city
            if let Err(e) = validate_clean_photo_uniqueness(parts) {
                eprintln!("{}", e);
                std::process::exit(1);
            }
        }
    }
    out
}

fn validate_clean_photo_uniqueness(parts: Vec<&str>) -> Result<(), String> {
    // parts: [matAlias, variant, city, date, counter]
    if parts.len() != 5 {
        return Ok(());
    }
    if parts[4] != "1" {
        return Ok(());
    }
    thread_local! {
        static SEEN: std::cell::RefCell<std::collections::HashSet<(String, String)>> = Default::default();
    }
    let key = (format!("{}_{}", parts[0], parts[1]), parts[2].to_string());
    let dup = SEEN.with(|set| {
        let mut s = set.borrow_mut();
        !s.insert(key.clone())
    });
    if dup {
        return Err(format!(
            "Дублирование чистого фото (_1) для исходника {} в городе {}",
            format!("{}_{}", parts[0], parts[1]),
            parts[2]
        ));
    }
    Ok(())
}

fn mapping_to_map(mapping: feed_core::PhotoMapping) -> HashMap<String, String> {
    let count = mapping.items.len();
    println!("Маппинг фото загружен ({} записей)", count,);
    let mut map = HashMap::new();
    for item in mapping.items {
        if let Some(url) = item.public_url.clone() {
            for id in mapping_keys(&item) {
                map.insert(id, url.clone());
            }
        }
    }
    map
}

fn load_mapping(path: &PathBuf) -> Option<HashMap<String, String>> {
    match read_photo_mapping(path) {
        Ok(mapping) => Some(mapping_to_map(mapping)),
        Err(e) => {
            eprintln!("Не удалось прочитать маппинг фото: {}", e);
            None
        }
    }
}

fn parse_opacities(input: &str) -> Vec<f64> {
    input
        .split(',')
        .filter_map(|s| s.trim().parse::<f64>().ok())
        .collect()
}

fn normalize_xml_str(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => {
                in_tag = true;
                out.push('<');
            }
            '>' => {
                in_tag = false;
                out.push('>');
            }
            _ => {
                if in_tag {
                    out.push(ch);
                } else if !ch.is_whitespace() {
                    out.push(ch);
                }
            }
        }
    }
    out
}

fn compare_xml(a: &PathBuf, b: &PathBuf) -> Result<bool, String> {
    let sa = std::fs::read_to_string(a)
        .map_err(|e| format!("Не удалось прочитать {}: {}", a.display(), e))?;
    let sb = std::fs::read_to_string(b)
        .map_err(|e| format!("Не удалось прочитать {}: {}", b.display(), e))?;
    Ok(normalize_xml_str(&sa) == normalize_xml_str(&sb))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn photo_options_default_has_out_dir() {
        let opts = PhotoOptions::default();
        assert!(!opts.out_dir.as_os_str().is_empty());
    }

    #[test]
    fn parse_opacities_parses_numbers() {
        let ops = parse_opacities("0.1, 0.2 ,bad,0.3");
        assert_eq!(ops, vec![0.1, 0.2, 0.3]);
    }

    #[test]
    fn compare_xml_reports_equal() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a.xml");
        let b = tmp.path().join("b.xml");
        std::fs::write(&a, "<root>\n  <x>1</x>\n</root>").unwrap();
        std::fs::write(&b, "<root><x>1</x></root>").unwrap();
        let eq = compare_xml(&a, &b).unwrap();
        assert!(eq);
    }
}

fn validate_base_price_share(ads: &[feed_core::Ad]) -> Result<(), String> {
    use std::collections::HashMap;
    let mut stats: HashMap<(String, String), (u32, u32)> = HashMap::new();
    for ad in ads {
        let mat = ad.material_id.clone().unwrap_or_default();
        let addr = ad.address.clone().unwrap_or_default();
        if mat.is_empty() || addr.is_empty() {
            continue;
        }
        let entry = stats.entry((mat, addr)).or_insert((0, 0));
        if ad.use_base_price.unwrap_or(false) {
            entry.0 += 1;
        }
        entry.1 += 1;
    }
    let mut bad = Vec::new();
    for ((mat, addr), (base, total)) in stats {
        if total == 0 {
            continue;
        }
        let pct = base as f64 / total as f64 * 100.0;
        if pct < 40.0 || pct > 60.0 {
            bad.push(format!(
                "{} @ {}: базовых {:.1}%, ожидается 40-60%",
                mat, addr, pct
            ));
        }
    }
    if bad.is_empty() {
        Ok(())
    } else {
        Err(format!("Доля базовых цен вне допуска:\n{}", bad.join("\n")))
    }
}
