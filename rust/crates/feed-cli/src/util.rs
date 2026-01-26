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
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("~$") {
                    return false;
                }
            }
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
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Удаляет старые файлы ads_*.xml, ads_*_manifest.json, photos_links_*.json,
/// photos_run_*.json, build-log_*.json и временные каталоги (photos, watermark-previews),
/// кроме списка keep.
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
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if path.is_dir() {
            if name == "photos" || name == "watermark-previews" || name == "photos_preview" {
                let _ = fs::remove_dir_all(&path);
            }
            continue;
        }
        let is_candidate = (name.starts_with("ads_")
            && (name.ends_with(".xml") || name.contains("_manifest.json")))
            || (name.starts_with("photos_links_") && name.ends_with(".json"))
            || (name.starts_with("photos_run_") && name.ends_with(".json"))
            || (name.starts_with("build-log_") && name.ends_with(".json"));
        if is_candidate && !keep.contains(name) {
            let _ = fs::remove_file(&path);
        }
    }
}

fn move_if_exists(src: &PathBuf, dst: &PathBuf) {
    if !src.exists() {
        return;
    }
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::rename(src, dst);
}

/// Складывает артефакты текущего запуска в runs/<label>/ и переносит старые запуски в archive/.
pub fn archive_run_outputs(
    out_dir: &PathBuf,
    file_label: &str,
    date_label: &str,
    pretty_file: Option<&str>,
) {
    let runs_dir = out_dir.join("runs");
    let archive_dir = out_dir.join("archive");
    let _ = std::fs::create_dir_all(&runs_dir);
    let _ = std::fs::create_dir_all(&archive_dir);

    let run_dir = runs_dir.join(file_label);
    let _ = std::fs::create_dir_all(&run_dir);

    move_if_exists(
        &out_dir.join(format!("ads_{}_manifest.json", file_label)),
        &run_dir.join("ads_manifest.json"),
    );
    move_if_exists(
        &out_dir.join(format!("build-log_{}.json", file_label)),
        &run_dir.join("build-log.json"),
    );
    if let Some(pretty_file) = pretty_file {
        move_if_exists(&out_dir.join(pretty_file), &run_dir.join(pretty_file));
    }
    move_if_exists(
        &out_dir.join(format!("photos_run_{}.json", file_label)),
        &run_dir.join("photos_run.json"),
    );
    move_if_exists(
        &out_dir.join(format!("photos_links_{}.json", date_label)),
        &run_dir.join("photos_links.json"),
    );
    // Фолбэк, если label уже санитизированный или передавался без пробела.
    move_if_exists(
        &out_dir.join(format!("photos_links_{}.json", file_label)),
        &run_dir.join("photos_links.json"),
    );

    // Оставляем только текущий запуск в runs/, остальные в archive/.
    let entries = match std::fs::read_dir(&runs_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.file_name().and_then(|s| s.to_str()) == Some(file_label) {
            continue;
        }
        let target = archive_dir.join(path.file_name().unwrap_or_default());
        let _ = std::fs::remove_dir_all(&target);
        let _ = std::fs::rename(&path, target);
    }
}
