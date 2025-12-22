use chrono::Local;
use std::path::PathBuf;

/// Ищет ровно один .xlsx в директории.
pub fn find_single_xlsx(dir: &PathBuf) -> Option<PathBuf> {
    if !dir.exists() {
        return None;
    }
    let entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .map(|ext| ext.to_string_lossy().to_ascii_lowercase() == "xlsx")
                .unwrap_or(false)
        })
        .collect();
    if entries.len() == 1 {
        Some(entries[0].clone())
    } else {
        None
    }
}

/// Формирует метку времени по умолчанию для фото/файлов.
pub fn default_date_label() -> String {
    let now = Local::now();
    now.format("%d.%m.%Y %H-%M-%S").to_string()
}

/// Делает строку безопасной для имени файла.
pub fn sanitize_label_for_file(label: &str) -> String {
    label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

/// Удаляет старые файлы ads_*.xml, ads_*_manifest.json, photos_links_*.json, кроме списка keep.
pub fn cleanup_output(out_dir: &PathBuf, keep_files: &[&str]) {
    use std::fs;
    if !out_dir.exists() {
        return;
    }
    let keep: std::collections::HashSet<String> =
        keep_files.iter().map(|s| s.to_string()).collect();
    let entries = match fs::read_dir(out_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        let is_candidate = (name.starts_with("ads_")
            && (name.ends_with(".xml") || name.contains("_manifest.json")))
            || (name.starts_with("photos_links_") && name.ends_with(".json"));
        if is_candidate && !keep.contains(name) {
            let _ = fs::remove_file(&path);
        }
    }
}
