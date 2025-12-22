use std::path::PathBuf;
use std::process::Command;

use feed_core::PhotoMapping;

/// Вызывает JS-скрипт генерации фото для новых объявлений.
pub fn generate_photos(plan: &PathBuf) -> Result<(), String> {
    let status = Command::new("node")
        .arg("bin/generate-photo-variants.js")
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
    let status = Command::new("node")
        .arg("bin/upload-photos.js")
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
