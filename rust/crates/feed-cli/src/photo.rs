use std::path::{Path, PathBuf};
use std::time::Duration;
use std::process::Command;

use feed_core::{PhotoMapping, PhotoMappingItem, PhotoVariant, Plan, YandexClient};

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
    plan: &Plan,
    photos_root: &PathBuf,
    disk_root: &str,
    date_label: &str,
    out_dir: &PathBuf,
    photos_manifest: Option<&PathBuf>,
) -> Result<PhotoMapping, String> {
    let token = std::env::var("YANDEX_DISK_TOKEN")
        .map_err(|_| "Не задан YANDEX_DISK_TOKEN для загрузки на Я.Диск".to_string())?;
    if !photos_root.exists() {
        return Err(format!(
            "Каталог с фото не найден: {}",
            photos_root.display()
        ));
    }
    let folder = date_label.replace(' ', "_");
    let disk_prefix = format!("{}/{}", disk_root, folder);
    let client = YandexClient::new(token).with_retries(20, Duration::from_millis(1000));

    let files = if let Some(manifest) = photos_manifest {
        collect_manifest_files(manifest)?
    } else {
        collect_plan_variant_files(photos_root, plan)?
    };
    if files.is_empty() {
        return Err("Не найдено файлов jpg/jpeg/png для загрузки".to_string());
    }
    println!(
        "Загружаем {} файлов на Я.Диск в {}/",
        files.len(),
        disk_prefix
    );

    let (items, uploaded, failed) =
        upload_files_parallel(files, &client, &disk_prefix, 4, 2, 2);

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
    mapping_path.push(format!("photos_links_{}.json", date_label));
    let json = serde_json::to_string_pretty(&mapping).map_err(|e| e.to_string())?;
    std::fs::write(&mapping_path, json)
        .map_err(|e| format!("Не удалось записать {}: {}", mapping_path.display(), e))?;
    println!(
        "Маппинг фото сохранён: {} ({} записей)",
        mapping_path.display(),
        mapping.items.len()
    );
    if !failed.is_empty() {
        eprintln!("⚠️  Не опубликовано: {} файлов", failed.len());
    }

    cleanup_uploaded_files(&uploaded, &failed);

    Ok(mapping)
}

pub fn clean_photos_root(photos_root: &PathBuf) {
    if !photos_root.exists() {
        return;
    }
    let mut stack = vec![photos_root.clone()];
    let mut removed_variants = 0usize;
    let mut removed_hashes = 0usize;

    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = match path.file_name().and_then(|s| s.to_str()) {
                Some(v) => v,
                None => continue,
            };
            if path.is_dir() {
                if name == "variants" {
                    if std::fs::remove_dir_all(&path).is_ok() {
                        removed_variants += 1;
                    } else {
                        eprintln!("⚠️  Не удалось удалить папку {}", path.display());
                    }
                } else {
                    stack.push(path);
                }
            } else if name == "hashes.json" {
                if std::fs::remove_file(&path).is_ok() {
                    removed_hashes += 1;
                } else {
                    eprintln!("⚠️  Не удалось удалить файл {}", path.display());
                }
            }
        }
    }

    if removed_variants > 0 || removed_hashes > 0 {
        println!(
            "Очистка photos_root: удалено папок variants: {}, hashes.json: {}",
            removed_variants, removed_hashes
        );
    }
}

#[derive(serde::Serialize)]
struct PhotosManifest<'a> {
    date_label: &'a str,
    files: Vec<String>,
}

pub fn write_photos_manifest(
    path: &PathBuf,
    date_label: &str,
    variants: &[PhotoVariant],
) -> Result<(), String> {
    let files: Vec<String> = variants
        .iter()
        .filter_map(|v| v.url.clone())
        .collect();
    let manifest = PhotosManifest { date_label, files };
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Deserialize)]
struct PhotosManifestIn {
    files: Vec<String>,
}

fn collect_manifest_files(path: &PathBuf) -> Result<Vec<PathBuf>, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Не удалось прочитать manifest {}: {}", path.display(), e))?;
    let manifest: PhotosManifestIn =
        serde_json::from_str(&raw).map_err(|e| format!("Некорректный manifest: {}", e))?;
    let mut out = Vec::new();
    for f in manifest.files {
        let p = PathBuf::from(f);
        if p.exists() {
            out.push(p);
        } else {
            eprintln!("⚠️  Файл из manifest не найден: {}", p.display());
        }
    }
    Ok(out)
}

fn upload_files_parallel(
    files: Vec<PathBuf>,
    client: &YandexClient,
    disk_prefix: &str,
    upload_concurrency: usize,
    publish_concurrency: usize,
    upload_retries: usize,
) -> (Vec<PhotoMappingItem>, Vec<PathBuf>, Vec<PathBuf>) {
    use std::sync::{atomic::{AtomicUsize, Ordering}, Arc, Mutex};
    let upload_idx = Arc::new(AtomicUsize::new(0));
    let files = Arc::new(files);
    let uploaded_tasks: Arc<Mutex<Vec<(PathBuf, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let failed_upload: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));

    let mut handles = Vec::new();
    for _ in 0..upload_concurrency {
        let upload_idx = Arc::clone(&upload_idx);
        let files = Arc::clone(&files);
        let uploaded_tasks = Arc::clone(&uploaded_tasks);
        let failed_upload = Arc::clone(&failed_upload);
        let client = client.clone();
        let disk_prefix = disk_prefix.to_string();
        let upload_retries = upload_retries;
        let handle = std::thread::spawn(move || {
            loop {
                let i = upload_idx.fetch_add(1, Ordering::SeqCst);
                if i >= files.len() {
                    break;
                }
                let path = files[i].clone();
                let file_name = match path.file_name().and_then(|s| s.to_str()) {
                    Some(v) => v.to_string(),
                    None => {
                        eprintln!("⚠️  Некорректное имя файла: {}", path.display());
                        failed_upload.lock().unwrap().push(path);
                        continue;
                    }
                };
                let disk_path = format!("{}/{}", disk_prefix, file_name);
                println!("  uploading {}", file_name);
                if let Ok(true) = client.resource_exists(&disk_path) {
                    println!("  → {} (уже на диске, skip upload)", file_name);
                    uploaded_tasks.lock().unwrap().push((path.clone(), disk_path));
                    continue;
                }
                let mut attempt = 0;
                let mut done = false;
                while attempt <= upload_retries && !done {
                    match client.upload_only(&path, &disk_path) {
                        Ok(res) => {
                            println!("  → {} ({} bytes)", file_name, res.size);
                            uploaded_tasks.lock().unwrap().push((path.clone(), res.disk_path));
                            done = true;
                        }
                        Err(e) => {
                            attempt += 1;
                            if attempt > upload_retries {
                                eprintln!("⚠️  Upload failed {}: {}", path.display(), e);
                                failed_upload.lock().unwrap().push(path.clone());
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(
                                1500 * attempt as u64,
                            ));
                        }
                    }
                }
            }
        });
        handles.push(handle);
    }
    for h in handles {
        let _ = h.join();
    }

    let mut uploaded_tasks = Arc::try_unwrap(uploaded_tasks).unwrap().into_inner().unwrap();
    let mut failed_upload = Arc::try_unwrap(failed_upload).unwrap().into_inner().unwrap();

    if !failed_upload.is_empty() {
        eprintln!(
            "⚠️  Повторная попытка upload для {} файлов (serial)",
            failed_upload.len()
        );
        let mut remaining = Vec::new();
        for path in failed_upload.drain(..) {
            let file_name = match path.file_name().and_then(|s| s.to_str()) {
                Some(v) => v.to_string(),
                None => {
                    remaining.push(path);
                    continue;
                }
            };
            let disk_path = format!("{}/{}", disk_prefix, file_name);
            std::thread::sleep(std::time::Duration::from_secs(5));
            match client.upload_only(&path, &disk_path) {
                Ok(res) => {
                    println!("  → {} ({} bytes) [retry]", file_name, res.size);
                    uploaded_tasks.push((path, res.disk_path));
                }
                Err(e) => {
                    eprintln!("⚠️  Upload failed (retry) {}: {}", path.display(), e);
                    remaining.push(path);
                }
            }
        }
        failed_upload = remaining;
    }

    let publish_idx = Arc::new(AtomicUsize::new(0));
    let uploaded_tasks = Arc::new(uploaded_tasks);
    let items: Arc<Mutex<Vec<PhotoMappingItem>>> = Arc::new(Mutex::new(Vec::new()));
    let uploaded_files: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
    let failed_publish: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));

    let mut pub_handles = Vec::new();
    for _ in 0..publish_concurrency {
        let publish_idx = Arc::clone(&publish_idx);
        let uploaded_tasks = Arc::clone(&uploaded_tasks);
        let items = Arc::clone(&items);
        let uploaded_files = Arc::clone(&uploaded_files);
        let failed_publish = Arc::clone(&failed_publish);
        let client = client.clone();
        let handle = std::thread::spawn(move || {
            loop {
                let i = publish_idx.fetch_add(1, Ordering::SeqCst);
                if i >= uploaded_tasks.len() {
                    break;
                }
                let (path, disk_path) = uploaded_tasks[i].clone();
                let file_name = match path.file_name().and_then(|s| s.to_str()) {
                    Some(v) => v.to_string(),
                    None => {
                        failed_publish.lock().unwrap().push(path);
                        continue;
                    }
                };
                match client.publish_and_get_public_url(&disk_path) {
                    Ok(url) => {
                        items.lock().unwrap().push(PhotoMappingItem {
                            avito_id: None,
                            file_name: Some(file_name),
                            public_url: Some(url),
                        });
                        uploaded_files.lock().unwrap().push(path);
                    }
                    Err(e) => {
                        eprintln!("⚠️  Publish failed {}: {}", disk_path, e);
                        failed_publish.lock().unwrap().push(path);
                    }
                }
            }
        });
        pub_handles.push(handle);
    }
    for h in pub_handles {
        let _ = h.join();
    }

    let items = Arc::try_unwrap(items).unwrap().into_inner().unwrap();
    let uploaded_files = Arc::try_unwrap(uploaded_files).unwrap().into_inner().unwrap();
    let failed_publish = Arc::try_unwrap(failed_publish).unwrap().into_inner().unwrap();
    let mut failed = failed_upload;
    failed.extend(failed_publish);
    (items, uploaded_files, failed)
}

fn cleanup_uploaded_files(files: &[PathBuf], failed: &[PathBuf]) {
    if files.is_empty() {
        return;
    }
    let mut dirs = std::collections::HashSet::new();
    for file in files {
        if let Some(dir) = file.parent() {
            dirs.insert(dir.to_path_buf());
        }
    }
    let mut failed_dirs = std::collections::HashSet::new();
    for file in failed {
        if let Some(dir) = file.parent() {
            failed_dirs.insert(dir.to_path_buf());
        }
    }

    let mut removed_dirs = 0usize;
    for dir in dirs {
        if dir.file_name().and_then(|s| s.to_str()) != Some("variants") {
            continue;
        }
        if failed_dirs.contains(&dir) {
            eprintln!(
                "⚠️  Пропуск удаления {} (есть ошибки загрузки/публикации)",
                dir.display()
            );
            continue;
        }
        if let Err(e) = std::fs::remove_dir_all(&dir) {
            eprintln!("⚠️  Не удалось удалить папку {}: {}", dir.display(), e);
        } else {
            removed_dirs += 1;
            if let Some(parent) = dir.parent() {
                remove_empty_dirs(parent);
            }
        }
    }
    if removed_dirs > 0 {
        println!("Локальные папки variants удалены: {}", removed_dirs);
    }
}

fn remove_empty_dirs(start: &Path) {
    let mut current = start.to_path_buf();
    loop {
        let entries = match std::fs::read_dir(&current) {
            Ok(e) => e,
            Err(_) => break,
        };
        if entries.count() != 0 {
            break;
        }
        if let Err(e) = std::fs::remove_dir(&current) {
            eprintln!("⚠️  Не удалось удалить папку {}: {}", current.display(), e);
            break;
        }
        if let Some(parent) = current.parent() {
            current = parent.to_path_buf();
        } else {
            break;
        }
    }
}

fn collect_plan_variant_files(root: &Path, plan: &Plan) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    let mut materials = std::collections::HashSet::new();
    let alias_map = plan.aliases.as_ref().map(|a| &a.materials);

    for task in &plan.tasks {
        let mat = match alias_map.and_then(|m| m.get(&task.material_id)) {
            Some(v) => v.as_str(),
            None => task.material_id.as_str(),
        };
        if !mat.is_empty() {
            materials.insert(mat.to_string());
        }
    }

    for material_id in materials {
        let material_dir = root.join(&material_id);
        if !material_dir.exists() {
            eprintln!("Нет папки с материалом: {}", material_dir.display());
            continue;
        }
        let address_dirs = std::fs::read_dir(&material_dir)
            .map_err(|e| format!("Не удалось прочитать каталог {}: {}", material_dir.display(), e))?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .map(|e| e.path());
        for address_dir in address_dirs {
            let variants_dir = address_dir.join("variants");
            if !variants_dir.exists() {
                continue;
            }
            let entries = std::fs::read_dir(&variants_dir)
                .map_err(|e| format!("Не удалось прочитать каталог {}: {}", variants_dir.display(), e))?;
            for entry in entries {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                        let ext_lower = ext.to_ascii_lowercase();
                        if ["jpg", "jpeg", "png"].contains(&ext_lower.as_str()) {
                            out.push(path);
                        }
                    }
                }
            }
        }
    }

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
