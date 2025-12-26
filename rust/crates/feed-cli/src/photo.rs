use std::path::{Path, PathBuf};
use std::process::Command;

use feed_core::{PhotoMapping, PhotoMappingItem, YandexClient};

/// Вызывает JS-скрипт генерации фото для новых объявлений.
pub fn generate_photos(plan: &PathBuf) -> Result<(), String> {
    let script = find_script("generate-photo-variants.js")?;
    let status = Command::new("node")
        .arg(script)
        .arg("--plan")
        .arg(plan)
        .status()
        .map_err(|e| format!("Не удалось запустить generate-photo-variants.js: {}", e))?;
    if !status.success() {
        return Err(format!(
            "generate-photo-variants.js завершился с кодом {:?}",
            status.code()
        ));
    }
    Ok(())
}

/// Вызывает JS-скрипт загрузки фото на Я.Диск.
pub fn upload_photos(
    plan: &PathBuf,
    disk_root: &str,
    date_label: &str,
    out_dir: &PathBuf,
) -> Result<(), String> {
    let script = find_script("upload-photos.js")?;
    let status = Command::new("node")
        .arg(script)
        .arg("--plan")
        .arg(plan)
        .arg("--root")
        .arg(disk_root)
        .arg("--date")
        .arg(date_label)
        .arg("--out")
        .arg(out_dir)
        .status()
        .map_err(|e| format!("Не удалось запустить upload-photos.js: {}", e))?;
    if !status.success() {
        return Err(format!(
            "upload-photos.js завершился с кодом {:?}",
            status.code()
        ));
    }
    Ok(())
}

/// Чтение маппинга фото (photos_links_*.json).
pub fn read_photo_mapping(path: &PathBuf) -> Result<PhotoMapping, String> {
    feed_core::read_photo_mapping(path)
}

/// Загрузка фото на Яндекс.Диск через Rust-клиент. Собирает mapping file (photos_links_*.json).
pub fn upload_photos_rust(
    photos_dir: &PathBuf,
    disk_root: &str,
    date_label: &str,
    out_dir: &PathBuf,
) -> Result<PhotoMapping, String> {
    let token = std::env::var("YANDEX_DISK_TOKEN")
        .map_err(|_| "Не задан YANDEX_DISK_TOKEN для загрузки на Я.Диск".to_string())?;
    if !photos_dir.exists() {
        return Err(format!(
            "Каталог с фото не найден: {}",
            photos_dir.display()
        ));
    }
    let folder = date_label.replace(' ', "_");
    let disk_prefix = format!("{}/{}", disk_root, folder);
    let client = YandexClient::new(token);

    let files = collect_images(photos_dir)?;
    if files.is_empty() {
        return Err("Не найдено файлов jpg/jpeg/png для загрузки".to_string());
    }
    println!(
        "Загружаем {} файлов на Я.Диск в {}/",
        files.len(),
        disk_prefix
    );

    let mut items = Vec::new();
    for path in files {
        let file_name = path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| format!("Некорректное имя файла: {}", path.display()))?;
        let disk_path = format!("{}/{}", disk_prefix, file_name);
        println!("  uploading {}", file_name);
        match client.upload_and_publish(&path, &disk_path) {
            Ok(res) => {
                println!("  → {} ({} bytes)", file_name, res.size);
                items.push(PhotoMappingItem {
                    avito_id: None,
                    file_name: Some(file_name.to_string()),
                    public_url: Some(res.public_url),
                });
            }
            Err(e) => {
                return Err(format!(
                    "Ошибка загрузки {}: {}",
                    path.display(),
                    e.to_string()
                ))
            }
        }
    }

    let mapping = PhotoMapping {
        date: Some(date_label.to_string()),
        disk_root: Some(disk_root.to_string()),
        disk_path: Some(disk_prefix.clone()),
        items,
    };

    if !out_dir.exists() {
        std::fs::create_dir_all(out_dir).ok();
    }
    let mut mapping_path = out_dir.clone();
    mapping_path.push(format!("photos_links_{}.json", folder));
    let json = serde_json::to_string_pretty(&mapping).map_err(|e| e.to_string())?;
    std::fs::write(&mapping_path, json)
        .map_err(|e| format!("Не удалось записать {}: {}", mapping_path.display(), e))?;
    println!(
        "Маппинг фото сохранён: {} ({} записей)",
        mapping_path.display(),
        mapping.items.len()
    );

    Ok(mapping)
}

fn collect_images(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
        for entry in std::fs::read_dir(dir)
            .map_err(|e| format!("Не удалось прочитать каталог {}: {}", dir.display(), e))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out)?;
            } else if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                let ext_lower = ext.to_ascii_lowercase();
                if ["jpg", "jpeg", "png", "webp"].contains(&ext_lower.as_str()) {
                    out.push(path);
                }
            }
        }
        Ok(())
    }
    walk(root, &mut out)?;
    Ok(out)
}

/// Ищет JS-скрипты относительно текущей директории и корня репо.
fn find_script(name: &str) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    // Текущая директория (при запуске из корня).
    candidates.push(PathBuf::from("bin").join(name));
    // Корень репо: rust/crates/feed-cli/../../../bin
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest_dir.join("../../../bin").join(name));
    // При запуске из rust/: ../bin
    candidates.push(PathBuf::from("../bin").join(name));

    for p in &candidates {
        if p.exists() {
            return Ok(p.to_path_buf());
        }
    }
    Err(format!(
        "Не найден скрипт {} (пробовал в {:?})",
        name, candidates
    ))
}
