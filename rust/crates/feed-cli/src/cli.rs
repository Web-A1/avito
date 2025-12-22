use clap::Parser;
use dotenvy::dotenv;
use feed_core::{
    read_ads_from_excel, read_plan, validate_plan_counts, validate_plan_step_intervals,
    validate_plan_windows, FeedConfig, PlanValidationError,
};

use crate::photo::{generate_photos, read_photo_mapping, upload_photos};
use crate::util::{cleanup_output, default_date_label, find_single_xlsx, sanitize_label_for_file};
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

    /// Корневой каталог на Я.Диске
    #[arg(long, default_value = "Cursor_for_Avito")]
    disk_root: String,

    /// Каталог вывода (совпадает с JS upload-photos.js --out)
    #[arg(long, default_value = "output")]
    out_dir: PathBuf,

    /// Метка даты для фото/маппинга (если не задана — берется текущее время)
    #[arg(long, default_value = "")]
    date_label: String,

    /// Путь к готовому photos_links_*.json (если нужно прочитать маппинг без запуска upload)
    #[arg(long)]
    photos_mapping: Option<PathBuf>,

    /// Очистка каталога вывода от старых ads/manifest/photos_links
    #[arg(long, default_value_t = false)]
    cleanup: bool,
}

pub fn run() {
    dotenv().ok();
    let args = Args::parse();

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

    // Фото-этапы через JS (опционально) или чтение готового маппинга
    let mut photo_map: Option<HashMap<String, String>> = None;
    if args.photos {
        let date_label = if args.date_label.is_empty() {
            default_date_label()
        } else {
            args.date_label.clone()
        };

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

        match read_photo_mapping(&mapping_path) {
            Ok(mapping) => {
                let count = mapping.items.len();
                println!(
                    "Маппинг фото загружен ({} записей) из {}",
                    count,
                    mapping_path.display()
                );
                let mut map = HashMap::new();
                for item in mapping.items {
                    if let Some(url) = item.public_url.clone() {
                        if let Some(id) = mapping_key(&item) {
                            map.insert(id, url);
                        }
                    }
                }
                photo_map = Some(map);
            }
            Err(e) => eprintln!("Не удалось прочитать маппинг фото: {}", e),
        }
    } else if let Some(mapping_path) = &args.photos_mapping {
        match read_photo_mapping(mapping_path) {
            Ok(mapping) => {
                let count = mapping.items.len();
                println!(
                    "Маппинг фото загружен ({} записей) из {}",
                    count,
                    mapping_path.display()
                );
                let mut map = HashMap::new();
                for item in mapping.items {
                    if let Some(url) = item.public_url.clone() {
                        if let Some(id) = mapping_key(&item) {
                            map.insert(id, url);
                        }
                    }
                }
                photo_map = Some(map);
            }
            Err(e) => eprintln!("Не удалось прочитать маппинг фото: {}", e),
        }
    }

    // Применение правил обновления к старым объявлениям (без генерации текстов)
    let updated_current = if let Some(rules) = update_rules {
        let rules_map = feed_core::build_update_map(&rules, &current_ads);
        let updated = feed_core::apply_updates(current_ads, &rules_map, photo_map.as_ref());
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
    let xml_label = if !args.date_label.is_empty() {
        args.date_label.clone()
    } else {
        default_date_label()
    };
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
fn mapping_key(item: &feed_core::PhotoMappingItem) -> Option<String> {
    if let Some(id) = &item.avito_id {
        return Some(id.clone());
    }
    if let Some(file) = &item.file_name {
        let trimmed = file
            .trim_end_matches(".jpg")
            .trim_end_matches(".jpeg")
            .trim_end_matches(".png");
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}
