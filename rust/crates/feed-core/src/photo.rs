use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use chrono::{Duration, Local, NaiveDate, NaiveDateTime, Utc};
use image::{
    imageops::{crop_imm, flip_horizontal_in_place, resize},
    DynamicImage, GenericImage, GenericImageView, ImageReader, Rgba,
};
use imageproc::geometric_transformations::{rotate_about_center, Interpolation};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Plan, WatermarkSettings};

#[derive(Debug, Clone, Serialize)]
pub struct PhotoVariant {
    pub source: PathBuf,
    pub file_name: String,
    pub material_id: Option<String>,
    pub address: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PhotoOptions {
    pub out_dir: PathBuf,
    pub pattern_opacity: Option<f64>,
    pub text_opacity: Option<f64>,
    pub text_color: Option<String>,
    pub text_watermark: Option<String>,
    pub watermark_settings: Vec<WatermarkSettings>,
    pub overshoot: Option<f64>,
    pub test_out_dir: Option<PathBuf>,
    pub write_history: bool,
    /// Количество вариантов на исходник (для будущей генерации)
    pub count: u32,
}

impl Default for PhotoOptions {
    fn default() -> Self {
        Self {
            out_dir: PathBuf::from("output/photos"),
            pattern_opacity: None,
            text_opacity: None,
            text_color: None,
            text_watermark: Some("NERUDA".to_string()),
            watermark_settings: Vec::new(),
            overshoot: None,
            test_out_dir: None,
            write_history: true,
            count: 1,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PhotoJob {
    pub source: PathBuf,
    pub count: u32,
    pub material_id: Option<String>,
    pub address: Option<String>,
    pub safe_address: String,
    pub date_begin: String,
    pub date_label: String,
    pub history_dir: Option<PathBuf>,
    pub flagship_source: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct EffectiveWatermark {
    text: String,
    text_color: String,
    text_opacity: f64,
    pattern_opacity: f64,
    text_color_overridden: bool,
}

#[derive(Debug, Clone, Copy)]
struct TransformParams {
    brightness: f32,
    saturation: f32,
    hue_deg: f32,
    contrast: f32,
    flip: bool,
    shift_x: f32,
    shift_y: f32,
    rotate_deg: f32,
    work_w: u32,
    work_h: u32,
    channel_shift: Option<(i32, i32, i32)>,
}

#[derive(Debug, Clone)]
struct GeneratedVariant {
    path: PathBuf,
    hash: String,
    attempts: u32,
    file_name: String,
    elapsed_ms: u128,
}

fn ahash(img: &DynamicImage) -> String {
    use image::imageops::FilterType;
    let small = DynamicImage::ImageRgba8(resize(
        img,
        HASH_SIZE,
        HASH_SIZE,
        FilterType::Nearest,
    ))
    .to_luma8();
    let mut total: u32 = 0;
    for &pix in small.as_raw() {
        total += pix as u32;
    }
    let avg = total as f32 / (HASH_SIZE * HASH_SIZE) as f32;
    let mut bits = String::with_capacity((HASH_SIZE * HASH_SIZE) as usize);
    for &pix in small.as_raw() {
        bits.push(if pix as f32 >= avg { '1' } else { '0' });
    }
    bits
}

fn hamming(a: &str, b: &str) -> u32 {
    if a.len() != b.len() {
        return u32::MAX;
    }
    a.bytes()
        .zip(b.bytes())
        .filter(|(x, y)| x != y)
        .count() as u32
}

const HASH_SIZE: u32 = 32;
const HASH_THRESHOLD: u32 = 10;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PhotoHistoryFile {
    pub version: u32,
    pub ads: Vec<PhotoHistoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PhotoHistoryEntry {
    #[serde(rename = "adId", default)]
    pub ad_id: Option<String>,
    #[serde(default)]
    pub hash: Option<String>,
    #[serde(rename = "materialId", default)]
    pub material_id: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(rename = "dateBegin", default)]
    pub date_begin: Option<String>,
    #[serde(rename = "photoPath", default)]
    pub photo_path: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
}

/// Генерация сетки превью водяного знака с разными opacity.
pub fn generate_preview_grid(
    source: &Path,
    opacities: &[f64],
    opts: &PhotoOptions,
) -> Result<Vec<PhotoVariant>, String> {
    if !source.exists() {
        return Err(format!("Исходник не найден: {}", source.display()));
    }
    if opacities.is_empty() {
        return Err("Список opacity пуст".into());
    }
    if !opts.out_dir.exists() {
        std::fs::create_dir_all(&opts.out_dir)
            .map_err(|e| format!("Не удалось создать {}: {}", opts.out_dir.display(), e))?;
    }

    let base = source
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Некорректное имя файла".to_string())?;
    let stem = Path::new(base)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("photo");
    let ext = Path::new(base)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("jpg");

    let settings = resolve_watermark_settings(source, &opts.watermark_settings);
    let settings_opacity = settings.and_then(|o| o.text_opacity);
    let settings_color = settings.and_then(|o| o.text_color.clone());
    let settings_text = settings.and_then(|o| o.text_watermark.clone());
    let settings_pattern = settings.and_then(|o| o.pattern_opacity);
    let eff = effective_watermark(
        opts,
        &WatermarkSettings {
            file: "".to_string(),
            pattern_opacity: settings_pattern,
            text_opacity: settings_opacity,
            text_watermark: settings_text.clone(),
            text_color: settings_color.clone(),
        },
    );
    let use_ops: Vec<f64> = if let Some(op) = settings_opacity {
        vec![op]
    } else {
        opacities.to_vec()
    };

    let base_img = ImageReader::open(source)
        .map_err(|e| format!("Не удалось открыть {}: {}", source.display(), e))?
        .decode()
        .map_err(|e| format!("Не удалось декодировать {}: {}", source.display(), e))?;

    let mut variants = Vec::new();
    for (i, op) in use_ops.iter().enumerate() {
        let file_name = format!("{}_preview_{:02}_opacity_{:.3}.{}", stem, i + 1, op, ext);
        let mut out_path = opts.out_dir.clone();
        out_path.push(&file_name);

        let mut img = base_img.clone();
        apply_text_to_image(
            &mut img,
            *op,
            settings_text
                .as_deref()
                .or_else(|| Some(&eff.text))
                .unwrap_or("NERUDA"),
            settings_color
                .as_deref()
                .or_else(|| Some(&eff.text_color))
                .unwrap_or("#FFFFFF"),
            settings_color.is_some(),
        )?;
        img.save(&out_path)
            .map_err(|e| format!("Не удалось сохранить {}: {}", out_path.display(), e))?;

        println!("✔️ превью {} с opacity {}", file_name, op);
        variants.push(PhotoVariant {
            source: source.to_path_buf(),
            file_name,
            material_id: None,
            address: None,
            url: Some(out_path.display().to_string()),
        });
    }

    Ok(variants)
}

fn resolve_watermark_settings<'a>(
    source: &Path,
    settings: &'a [WatermarkSettings],
) -> Option<&'a WatermarkSettings> {
    let name = source.file_name()?.to_str()?;
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str());
    let full = source.to_string_lossy();
    settings.iter().find(|o| {
        o.file == name
            || stem.map_or(false, |s| o.file == s)
            || o.file == full.as_ref()
    })
}

fn sanitize_token(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if ch.is_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if ch.is_whitespace() || ch == '-' || ch == '.' || ch == '_' {
            out.push('_');
        }
    }
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out.trim_matches('_').to_string()
}

fn sanitize_for_path(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || ch.is_whitespace()
        {
            out.push('_');
        } else {
            out.push(ch.to_ascii_lowercase());
        }
    }
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out.trim_matches('_').to_string()
}

fn sanitize_ad_id_part(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('_');
        }
    }
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "photo".to_string()
    } else {
        trimmed
    }
}

fn source_base_from_path(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("photo");
    let normalized = sanitize_for_path(stem);
    sanitize_ad_id_part(&normalized)
}

fn format_ad_id_date(dt: &NaiveDateTime) -> String {
    let day = dt.format("%d%m").to_string();
    let full = dt.format("%d%m%y-%H%M%S").to_string();
    let run_id = short_run_id(&full, 4);
    format!("{day}-{run_id}")
}

fn short_run_id(input: &str, len: usize) -> String {
    let mut hash: u64 = 1469598103934665603;
    for b in input.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    let base36 = to_base36(hash);
    if base36.len() <= len {
        base36
    } else {
        base36[base36.len() - len..].to_string()
    }
}

fn to_base36(mut n: u64) -> String {
    if n == 0 {
        return "0".to_string();
    }
    let mut buf = [0u8; 32];
    let mut i = buf.len();
    while n > 0 {
        let rem = (n % 36) as u8;
        let ch = if rem < 10 {
            b'0' + rem
        } else {
            b'a' + (rem - 10)
        };
        i -= 1;
        buf[i] = ch;
        n /= 36;
    }
    String::from_utf8_lossy(&buf[i..]).to_string()
}

fn parse_date_label(label: &str) -> Option<NaiveDateTime> {
    if let Ok(dt) = NaiveDateTime::parse_from_str(label, "%d.%m.%Y %H-%M-%S") {
        Some(dt)
    } else if let Ok(dt) = NaiveDateTime::parse_from_str(label, "%d.%m.%Y %H:%M") {
        Some(dt)
    } else if let Ok(dt) = NaiveDateTime::parse_from_str(label, "%d%m%y-%H%M%S") {
        Some(dt)
    } else if let Ok(d) = NaiveDate::parse_from_str(label, "%d.%m.%Y") {
        d.and_hms_opt(0, 0, 0)
    } else if let Ok(d) = NaiveDate::parse_from_str(label, "%d%m%y") {
        d.and_hms_opt(0, 0, 0)
    } else {
        None
    }
}

fn calculate_inscribed_rectangle(
    width: u32,
    height: u32,
    angle_deg: f32,
    safety: f32,
) -> (u32, u32) {
    let mut angle_abs = angle_deg.abs() % 180.0;
    if angle_abs > 90.0 {
        angle_abs = 180.0 - angle_abs;
    }
    let theta = angle_abs.to_radians();
    let s = theta.sin();
    let c = theta.cos();
    let sin2 = (2.0 * theta).sin();
    let cos2 = c * c - s * s;

    let (w, h) = (width as f32, height as f32);
    let (mut crop_w, mut crop_h) = if w >= h {
        if h <= w * sin2 {
            (h / (2.0 * s), h / (2.0 * c))
        } else {
            ((w * c - h * s) / cos2, (h * c - w * s) / cos2)
        }
    } else if w <= h * sin2 {
        (w / (2.0 * c), w / (2.0 * s))
    } else {
        ((w * c - h * s) / cos2, (h * c - w * s) / cos2)
    };

    crop_w = (crop_w * safety).max(1.0);
    crop_h = (crop_h * safety).max(1.0);
    (crop_w.floor() as u32, crop_h.floor() as u32)
}

fn average_color(img: &DynamicImage) -> Rgba<u8> {
    let (r, g, b) = channel_means(img);
    Rgba([
        r.round().clamp(0.0, 255.0) as u8,
        g.round().clamp(0.0, 255.0) as u8,
        b.round().clamp(0.0, 255.0) as u8,
        255,
    ])
}

fn apply_linear_contrast(img: DynamicImage, contrast: f32) -> DynamicImage {
    let mut out = img.to_rgba8();
    for px in out.pixels_mut() {
        for i in 0..3 {
            let v = px[i] as f32;
            let adjusted = (v - 128.0) * contrast + 128.0;
            px[i] = adjusted.round().clamp(0.0, 255.0) as u8;
        }
    }
    DynamicImage::ImageRgba8(out)
}

fn resolve_city_alias(address: &str) -> Result<String, String> {
    use crate::constants::{CITY_ALIASES, SELLER_ADDRESS_ALIASES};
    if address.trim().is_empty() {
        return Err("Адрес не указан для генерации adId".to_string());
    }
    let cleaned = address.trim();
    let canonical = SELLER_ADDRESS_ALIASES
        .get(cleaned)
        .copied()
        .unwrap_or(cleaned);
    CITY_ALIASES
        .get(canonical)
        .copied()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Адрес не найден в CITY_ALIASES: {}", address))
}

/// Черновой генератор вариантов для одного исходника (count берется из opts или job.count).
pub fn generate_variants(source: &Path, opts: &PhotoOptions) -> Result<Vec<PhotoVariant>, String> {
    let job = PhotoJob {
        source: source.to_path_buf(),
        count: opts.count,
        material_id: None,
        address: None,
        safe_address: String::new(),
        date_begin: String::new(),
        date_label: "".to_string(),
        history_dir: None,
        flagship_source: None,
    };
    generate_job_variants(&job, opts)
}

/// Генерация фото по плану: берём исходники из data/photos/<material>/originals,
/// раскладываем их по адресам и генерируем варианты с нумерацией mat_variant_city_date_idx.
pub fn generate_plan_photos(
    plan: &Plan,
    photos_root: &Path,
    date_label: &str,
    opts: &PhotoOptions,
) -> Result<Vec<PhotoVariant>, String> {
    let jobs = collect_photo_jobs(plan, photos_root, opts.count, date_label)?;
    let mut out = Vec::new();
    for job in jobs {
        let source_name = job
            .source
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");
        let city = city_from_address(job.address.as_deref().unwrap_or(""));
        println!(
            "> {} | {} | количество: {}",
            source_name,
            city,
            job.count
        );
        let mut variants = generate_job_variants(&job, opts)?;
        out.append(&mut variants);
    }
    Ok(out)
}

fn city_from_address(addr: &str) -> String {
    let parts: Vec<String> = addr
        .split(',')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    if parts.len() >= 2 {
        parts[1].clone()
    } else if parts.len() == 1 {
        parts[0].clone()
    } else {
        "-".to_string()
    }
}

/// Собирает задания по плану: распределяет count по адресам и исходникам (originals).
pub fn collect_photo_jobs(
    plan: &Plan,
    photos_root: &Path,
    default_per_location: u32,
    date_label: &str,
) -> Result<Vec<PhotoJob>, String> {
    use std::collections::HashMap;

    let aliases = plan.aliases.clone().unwrap_or_default();
    let mut jobs = Vec::new();
    let mut addr_counts: HashMap<(String, String), u32> = HashMap::new();
    let mut folders: HashMap<String, (String, String, String, PathBuf)> = HashMap::new();
    let plan_date_begin = plan.date_begin.clone();

    for task in &plan.tasks {
        let material_raw = if !task.material_id.is_empty() {
            task.material_id.clone()
        } else {
            task.material.clone().unwrap_or_default()
        };
        let material_id = aliases
            .materials
            .get(&material_raw)
            .cloned()
            .unwrap_or(material_raw);
        let photo_key = task
            .photo_key
            .clone()
            .unwrap_or_else(|| material_id.clone());
        let slots = if let Some(slots) = &task.slots {
            if slots.is_empty() {
                vec![crate::TaskSlot::default()]
            } else {
                slots.clone()
            }
        } else {
            vec![crate::TaskSlot::default()]
        };

        for slot in slots {
            let slot_date_begin = slot
                .date_begin
                .clone()
                .or_else(|| task.date_begin.clone())
                .or_else(|| if plan_date_begin.is_empty() { None } else { Some(plan_date_begin.clone()) })
                .unwrap_or_default();
            let locs = if !slot.locations.is_empty() {
                slot.locations.clone()
            } else if !task.locations.is_empty() {
                task.locations.clone()
            } else if let Some(addrs) = &task.addresses {
                addrs.clone()
            } else {
                vec![crate::Location {
                    address: "default".to_string(),
                    count: default_per_location,
                    percent: None,
                    addr: None,
                }]
            };
            let total_slot_count = if slot.count > 0 {
                slot.count
            } else {
                task.count
            };
            let mut remaining = total_slot_count as i64;
            let mut loc_counts: HashMap<String, u32> = HashMap::new();

            for loc in &locs {
                if loc.count > 0 {
                    loc_counts.insert(loc.address.clone(), loc.count);
                    remaining -= loc.count as i64;
                }
            }

            if remaining > 0 {
                let without_count: Vec<&crate::Location> =
                    locs.iter().filter(|l| l.count == 0).collect();
                if !without_count.is_empty() {
                    let per_loc = remaining as u32 / without_count.len() as u32;
                    let remainder = remaining as u32 % without_count.len() as u32;
                    for (idx, loc) in without_count.iter().enumerate() {
                        let add = per_loc + if idx < remainder as usize { 1 } else { 0 };
                        loc_counts.insert(loc.address.clone(), add);
                    }
                } else if !locs.is_empty() && total_slot_count > 0 {
                    let last_addr = locs
                        .last()
                        .and_then(|l| if l.address.is_empty() { None } else { Some(l.address.clone()) })
                        .unwrap_or_else(|| "default".to_string());
                    let entry = loc_counts.entry(last_addr).or_insert(0);
                    *entry += remaining as u32;
                }
            }

            if loc_counts.is_empty() && total_slot_count == 0 {
                let per_loc = 1u32 / locs.len().max(1) as u32;
                let remainder = 1u32 % locs.len().max(1) as u32;
                for (idx, loc) in locs.iter().enumerate() {
                    let add = per_loc + if idx < remainder as usize { 1 } else { 0 };
                    loc_counts.insert(loc.address.clone(), add);
                }
            }

            let resolved_folder = aliases
                .photos
                .get(&photo_key)
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    let dir = if material_id.is_empty() {
                        photo_key.clone()
                    } else {
                        material_id.clone()
                    };
                    photos_root.join(dir).join("originals")
                });

            for loc in locs {
                let addr_raw = if loc.address.is_empty() {
                    "default".to_string()
                } else {
                    loc.address.clone()
                };
                let addr_formatted = addr_raw.split_whitespace().collect::<Vec<_>>().join(" ");
                let safe_address = if addr_formatted.is_empty() {
                    "default".to_string()
                } else {
                    sanitize_for_path(&addr_formatted)
                };
                let add_count = loc_counts.get(&addr_raw).copied().unwrap_or(0);
                let key = (material_id.clone(), safe_address.clone());
                *addr_counts.entry(key).or_insert(0) += add_count;

                let folder_key = format!("{}|{}", resolved_folder.display(), safe_address);
                folders
                    .entry(folder_key)
                    .or_insert((material_id.clone(), addr_formatted, slot_date_begin.clone(), resolved_folder.clone()));
            }
        }
    }

    for (_key, (material_id, address, date_begin, folder)) in folders {
        if !folder.exists() {
            continue;
        }
        let mut files = Vec::new();
        for entry in std::fs::read_dir(&folder)
            .map_err(|e| format!("Не удалось прочитать {}: {}", folder.display(), e))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                let ext = ext.to_ascii_lowercase();
                if ["jpg", "jpeg", "png", "webp"].contains(&ext.as_str()) {
                    files.push(path);
                }
            }
        }
        files.sort();
        let flagship = files.iter().find(|p| {
            p.file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase().contains("fs"))
                .unwrap_or(false)
        });
        let total = addr_counts
            .get(&(material_id.clone(), sanitize_for_path(&address)))
            .copied()
            .unwrap_or(0);
        if files.is_empty() {
            return Err(format!(
                "Не найдены исходники в {}",
                folder.display()
            ));
        }
        let per_file = total / files.len() as u32;
        let remainder = total % files.len() as u32;
        for (idx, src) in files.iter().enumerate() {
            let add = per_file + if idx < remainder as usize { 1 } else { 0 };
            jobs.push(PhotoJob {
                source: src.clone(),
                count: add,
                material_id: if material_id.is_empty() { None } else { Some(material_id.clone()) },
                address: if address.is_empty() { None } else { Some(address.clone()) },
                safe_address: sanitize_for_path(&address),
                date_begin: date_begin.clone(),
                date_label: date_label.to_string(),
                history_dir: Some(photos_root.join(&material_id).join(sanitize_for_path(&address))),
                flagship_source: flagship.cloned(),
            });
        }
    }

    Ok(jobs)
}

fn generate_job_variants(job: &PhotoJob, opts: &PhotoOptions) -> Result<Vec<PhotoVariant>, String> {
    if !job.source.exists() {
        return Err(format!("Исходник не найден: {}", job.source.display()));
    }
    if job.count == 0 {
        return Ok(Vec::new());
    }
    let count = job.count as usize;
    let base_name = job
        .source
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("photo.jpg");
    let stem = Path::new(base_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("photo");
    let ext = Path::new(base_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("jpg");

    let material_token = job
        .material_id
        .as_deref()
        .map(sanitize_token)
        .unwrap_or_else(|| "mat".to_string());
    let source_base = source_base_from_path(&job.source);
    let use_ad_id = job
        .address
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
        && job.material_id.is_some();
    let city_token = if use_ad_id {
        resolve_city_alias(job.address.as_deref().unwrap_or(""))?
    } else if job.safe_address.is_empty() {
        "city".to_string()
    } else {
        sanitize_token(&job.safe_address)
    };

    let mut out_dir = if let Some(test_dir) = &opts.test_out_dir {
        test_dir.clone()
    } else if use_ad_id {
        if let Some(dir) = job.history_dir.as_ref() {
            dir.join("variants")
        } else {
            opts.out_dir.clone()
        }
    } else {
        opts.out_dir.clone()
    };
    if !use_ad_id {
        if !material_token.is_empty() {
            out_dir.push(&material_token);
        }
        if !city_token.is_empty() {
            out_dir.push(&city_token);
        }
    }
    if !out_dir.exists() {
        std::fs::create_dir_all(&out_dir)
            .map_err(|e| format!("Не удалось создать {}: {}", out_dir.display(), e))?;
    }

    let base_img = ImageReader::open(&job.source)
        .map_err(|e| format!("Не удалось открыть {}: {}", job.source.display(), e))?
        .decode()
        .map_err(|e| format!("Не удалось декодировать {}: {}", job.source.display(), e))?
        .to_rgba8();
    let (base_w, base_h) = base_img.dimensions();
    let small_image = base_w.min(base_h) < 1400;
    let overshoot_safe = opts.overshoot.unwrap_or(0.0).max(0.0) as f32;
    let zoom_boost_base = 1.0_f32 + overshoot_safe.min(0.05);
    let angle_boost_base = 1.0_f32 + overshoot_safe.min(0.05);

    let mut history = if opts.write_history {
        if let Some(dir) = job.history_dir.as_ref() {
            if !dir.exists() {
                std::fs::create_dir_all(dir)
                    .map_err(|e| format!("Не удалось создать {}: {}", dir.display(), e))?;
            }
            load_history(dir)
        } else {
            PhotoHistoryFile::default()
        }
    } else {
        PhotoHistoryFile::default()
    };
    let history_hashes: Vec<String> = history
        .ads
        .iter()
        .filter_map(|ad| ad.hash.clone())
        .collect();
    let has_clean = if use_ad_id {
        history_has_clean(&history.ads, &source_base, &city_token)
    } else {
        false
    };
    let allow_clean = !has_clean;

    let mut rng = rand::thread_rng();
    let base_time = parse_date_label(&job.date_label).unwrap_or_else(|| Local::now().naive_local());
    let max_retries_per_index = 5;
    let max_global_passes = 5;
    let mut aggressive_mode = false;
    let mut generated: Vec<Option<GeneratedVariant>> = vec![None; count];

    let make_file_name = |idx: usize| -> String {
        if use_ad_id {
            let date_token = format_ad_id_date(&(base_time + Duration::seconds(idx as i64)));
            let ad_id = format!(
                "{}_{}_{}_{}",
                source_base,
                city_token,
                date_token,
                idx + 1
            );
            format!("{}.jpg", ad_id)
        } else {
            format!(
                "{}_{}_{}_{}_{}.{}",
                material_token,
                sanitize_token(stem),
                city_token,
                sanitize_token(&job.date_label),
                idx + 1,
                ext
            )
        }
    };

    let mut generate_variant = |idx: usize, base_only: bool, aggressive: bool, attempt: u32| -> Result<GeneratedVariant, String> {
        let gen_start = std::time::Instant::now();
        let mut source_path = job.source.clone();
        if base_only {
            if let Some(flagship) = job.flagship_source.as_ref() {
                let src_stem = job
                    .source
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                let flag_stem = flagship.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                if !src_stem.is_empty() && src_stem == flag_stem {
                    source_path = flagship.clone();
                }
            }
        }
        let settings = resolve_watermark_settings(&source_path, &opts.watermark_settings);
        let effective = effective_watermark(
            opts,
            settings.unwrap_or(&WatermarkSettings::default()),
        );
        if settings.and_then(|o| o.text_opacity).is_none() {
            return Err(format!(
                "Нет фиксированного textOpacity для исходника: {}",
                source_path.display()
            ));
        }

        let mut img = if base_only && source_path != job.source {
            ImageReader::open(&source_path)
                .map_err(|e| format!("Не удалось открыть {}: {}", source_path.display(), e))?
                .decode()
                .map_err(|e| format!("Не удалось декодировать {}: {}", source_path.display(), e))?
                .to_rgba8()
        } else {
            base_img.clone()
        };

        if !base_only {
            let attempt_boost = if aggressive { 1.2_f32 } else { 1.0_f32 };
            let scale_min = if small_image { 0.95 } else { 0.92 };
            let scale_max = if small_image { 1.05 } else { 1.08 };
            let scale = rng.gen_range(scale_min..scale_max);
            let rotate_range =
                (if small_image { 10.0_f32 } else { 15.0_f32 }) * angle_boost_base * attempt_boost;
            let overscale_base = if small_image { 1.02_f32 } else { 1.04_f32 };
            let overscale = (overscale_base * zoom_boost_base * attempt_boost).min(1.12_f32);
            let work_w = ((base_w as f32 * scale * overscale).round().max(32.0)) as u32;
            let work_h = ((base_h as f32 * scale * overscale).round().max(32.0)) as u32;
            let t = TransformParams {
                brightness: rng.gen_range(0.97..1.05_f32),
                saturation: rng.gen_range(0.96..1.05_f32),
                hue_deg: rng.gen_range(-6.0..6.0_f32),
                contrast: rng.gen_range(0.985..1.03_f32),
                flip: rng.gen_bool(0.5),
                shift_x: rng.gen_range(-0.04..0.04_f32),
                shift_y: rng.gen_range(-0.04..0.04_f32),
                rotate_deg: rng.gen_range(-rotate_range..rotate_range),
                work_w,
                work_h,
                channel_shift: if rng.gen_bool(0.25) {
                    Some((
                        rng.gen_range(-1..=1),
                        rng.gen_range(-1..=1),
                        rng.gen_range(-1..=1),
                    ))
                } else {
                    None
                },
            };
            let mut dyn_img = DynamicImage::ImageRgba8(img);
            dyn_img = apply_transforms(dyn_img, t);
            img = dyn_img.to_rgba8();
        }

        // Водяной знак и паттерн наносятся последним шагом.
        let mut dyn_img = DynamicImage::ImageRgba8(img);
        apply_pattern_overlay(&mut dyn_img, effective.pattern_opacity);
        apply_text_to_image(
            &mut dyn_img,
            effective.text_opacity,
            &effective.text,
            &effective.text_color,
            effective.text_color_overridden,
        )?;
        img = dyn_img.to_rgba8();

        let hash = ahash(&DynamicImage::ImageRgba8(img.clone()));
        let file_name = make_file_name(idx);
        let mut out_path = out_dir.clone();
        out_path.push(&file_name);
        DynamicImage::ImageRgba8(img)
            .save(&out_path)
            .map_err(|e| format!("Не удалось сохранить {}: {}", out_path.display(), e))?;
        let elapsed_ms = gen_start.elapsed().as_millis();
        Ok(GeneratedVariant {
            path: out_path,
            hash,
            attempts: attempt,
            file_name,
            elapsed_ms,
        })
    };

    for idx in 0..count {
        let base_only = idx == 0 && allow_clean;
        let gen = generate_variant(idx, base_only, aggressive_mode, 1)?;
        println!(
            "            {} (попытка {}, чистое={}, {} мс)",
            gen.file_name,
            gen.attempts,
            base_only,
            gen.elapsed_ms
        );
        generated[idx] = Some(gen);
    }

    for _ in 0..max_global_passes {
        let mut for_validation = generated.clone();
        if allow_clean {
            if !for_validation.is_empty() {
                for_validation[0] = None;
            }
        }
        let close = find_close_indices(&for_validation, &history_hashes, HASH_THRESHOLD);
        if close.is_empty() {
            break;
        }
        if close[0].1 == 0 {
            aggressive_mode = true;
        }
        let indices: Vec<usize> = close.into_iter().map(|(idx, _)| idx).collect();
        let unique: std::collections::HashSet<usize> = indices.into_iter().collect();
        for idx in unique {
            let attempts = generated[idx].as_ref().map(|g| g.attempts).unwrap_or(0);
            if attempts >= max_retries_per_index {
                continue;
            }
            if let Some(prev) = generated[idx].as_ref() {
                let _ = std::fs::remove_file(&prev.path);
            }
            let gen = generate_variant(idx, idx == 0 && allow_clean, aggressive_mode, attempts + 1)?;
            println!(
                "            {} (перегенерация, попытка {}, {} мс)",
                gen.file_name,
                gen.attempts,
                gen.elapsed_ms
            );
            generated[idx] = Some(gen);
        }
    }

    let mut variants = Vec::new();
    for item in generated.iter().flatten() {
        let ad_id = Path::new(&item.file_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string());
        history.ads.push(PhotoHistoryEntry {
            ad_id,
            hash: Some(item.hash.clone()),
            material_id: job.material_id.clone(),
            address: job.address.clone(),
            date_begin: Some(
                if job.date_begin.is_empty() {
                    job.date_label.clone()
                } else {
                    job.date_begin.clone()
                },
            ),
            photo_path: Some(item.file_name.clone()),
            timestamp: Some(Utc::now().to_rfc3339()),
        });
        variants.push(PhotoVariant {
            source: job.source.clone(),
            file_name: item.file_name.clone(),
            material_id: job.material_id.clone(),
            address: job.address.clone(),
            url: Some(item.path.display().to_string()),
        });
    }

    if opts.write_history {
        if let Some(dir) = job.history_dir.as_ref() {
            save_history_tmp(dir, &history.ads)?;
        }
    }

    Ok(variants)
}

fn effective_watermark(
    opts: &PhotoOptions,
    settings: &WatermarkSettings,
) -> EffectiveWatermark {
    let text = settings
        .text_watermark
        .clone()
        .or_else(|| opts.text_watermark.clone())
        .unwrap_or_else(|| "NERUDA".to_string());
    let text_color_overridden = settings.text_color.is_some();
    let text_color = settings
        .text_color
        .clone()
        .unwrap_or_else(|| "#FFFFFF".to_string());
    let text_opacity = settings
        .text_opacity
        .unwrap_or(0.08_f64)
        .clamp(0.02, 1.0);
    let pattern_opacity = settings
        .pattern_opacity
        .unwrap_or(0.04_f64)
        .clamp(0.0, 0.25);

    EffectiveWatermark {
        text,
        text_color,
        text_opacity,
        pattern_opacity,
        text_color_overridden,
    }
}

fn apply_transforms(img: DynamicImage, params: TransformParams) -> DynamicImage {
    let avg = average_color(&img);
    let mut out = DynamicImage::ImageRgba8(resize(
        &img,
        params.work_w,
        params.work_h,
        image::imageops::FilterType::Triangle,
    ));
    if params.flip {
        flip_horizontal_in_place(out.as_mut_rgba8().unwrap());
    }
    let rotated = rotate_about_center(
        &out.to_rgba8(),
        params.rotate_deg.to_radians(),
        Interpolation::Bilinear,
        avg,
    );

    let (rot_w, rot_h) = rotated.dimensions();
    let (crop_w, crop_h) =
        calculate_inscribed_rectangle(params.work_w, params.work_h, params.rotate_deg, 0.96);
    let safe_w = (crop_w as f32 * 0.95).floor().max(1.0) as u32;
    let safe_h = (crop_h as f32 * 0.95).floor().max(1.0) as u32;
    let center_x = ((rot_w.saturating_sub(safe_w)) as f32) / 2.0;
    let center_y = ((rot_h.saturating_sub(safe_h)) as f32) / 2.0;
    let left = (center_x + params.shift_x * safe_w as f32)
        .round()
        .clamp(0.0, (rot_w.saturating_sub(safe_w)) as f32) as u32;
    let top = (center_y + params.shift_y * safe_h as f32)
        .round()
        .clamp(0.0, (rot_h.saturating_sub(safe_h)) as f32) as u32;
    let cropped = crop_imm(
        &DynamicImage::ImageRgba8(rotated),
        left,
        top,
        safe_w,
        safe_h,
    )
    .to_image();
    let mut out = DynamicImage::ImageRgba8(cropped);

    out = apply_color_modulation(out, params.brightness, params.saturation, params.hue_deg);
    out = apply_linear_contrast(out, params.contrast);
    if let Some(shift) = params.channel_shift {
        out = apply_channel_shift(out, shift);
    }
    out
}

fn apply_pattern_overlay(img: &mut DynamicImage, opacity: f64) {
    if opacity <= 0.0 {
        return;
    }
    let mut rng = rand::thread_rng();
    let kind = rng.gen_range(0..4);
    match kind {
        0 => overlay_noise_blocks(img, opacity),
        1 => overlay_dots(img, opacity),
        2 => overlay_gradient(img, opacity),
        _ => overlay_light_spots(img, opacity),
    }
}

fn overlay_noise_blocks(img: &mut DynamicImage, opacity: f64) {
    let mut rng = rand::thread_rng();
    let (w, h) = img.dimensions();
    let step = std::cmp::max(12, (std::cmp::min(w, h) / 18) as usize);
    for x in (0..w).step_by(step) {
        for y in (0..h).step_by(step) {
            let (r, g, b) = (
                rng.gen_range(0..=20),
                rng.gen_range(0..=20),
                rng.gen_range(0..=20),
            );
            blend_rect(img, x, y, step as u32, step as u32, Rgba([r, g, b, 255]), opacity);
        }
    }
}

fn overlay_dots(img: &mut DynamicImage, opacity: f64) {
    let mut rng = rand::thread_rng();
    let (w, h) = img.dimensions();
    let step = std::cmp::max(20, (std::cmp::min(w, h) / 12) as usize);
    for x in (0..w).step_by(step) {
        for y in (0..h).step_by(step) {
            if rng.gen_bool(0.6) {
                continue;
            }
            let radius = rng.gen_range(2..=5);
            let color = Rgba([
                rng.gen_range(180..=255),
                rng.gen_range(180..=255),
                rng.gen_range(180..=255),
                255,
            ]);
            blend_circle(img, x as i32, y as i32, radius, color, opacity);
        }
    }
}

fn overlay_gradient(img: &mut DynamicImage, opacity: f64) {
    let mut rng = rand::thread_rng();
    let (w, h) = img.dimensions();
    let start = (
        rng.gen_range(0..w.max(1)),
        rng.gen_range(0..h.max(1)),
    );
    let end = (
        rng.gen_range(0..w.max(1)),
        rng.gen_range(0..h.max(1)),
    );
    let base = rng.gen_range(20..=80) as f32;
    let swing = rng.gen_range(40..=120) as f32;
    for y in 0..h {
        for x in 0..w {
            let t = gradient_t(x, y, start, end);
            let shade = (base + swing * t).clamp(0.0, 255.0) as u8;
            let color = Rgba([shade, shade, shade, 255]);
            blend_rect(img, x, y, 1, 1, color, opacity);
        }
    }
}

// overlay_text_pattern удален: логика перенесена в overlay_text_pattern_image.

fn overlay_light_spots(img: &mut DynamicImage, opacity: f64) {
    let mut rng = rand::thread_rng();
    let (w, h) = img.dimensions();
    let spots = rng.gen_range(6..=14);
    for _ in 0..spots {
        let cx = rng.gen_range(0..w.max(1)) as i32;
        let cy = rng.gen_range(0..h.max(1)) as i32;
        let radius = rng.gen_range((w.min(h) / 12).max(12)..=(w.min(h) / 5).max(16)) as i32;
        let color = Rgba([
            rng.gen_range(200..=255),
            rng.gen_range(200..=255),
            rng.gen_range(200..=255),
            255,
        ]);
        blend_soft_circle(img, cx, cy, radius, color, opacity);
    }
}

fn blend_soft_circle(
    img: &mut DynamicImage,
    cx: i32,
    cy: i32,
    radius: i32,
    color: Rgba<u8>,
    opacity: f64,
) {
    let (w, h) = img.dimensions();
    let base_alpha = opacity.clamp(0.0, 1.0) as f32;
    for y in (cy - radius)..=(cy + radius) {
        if y < 0 || y >= h as i32 {
            continue;
        }
        for x in (cx - radius)..=(cx + radius) {
            if x < 0 || x >= w as i32 {
                continue;
            }
            let dx = x - cx;
            let dy = y - cy;
            let dist = ((dx * dx + dy * dy) as f32).sqrt();
            if dist > radius as f32 {
                continue;
            }
            let falloff = (1.0 - dist / radius as f32).powf(2.0);
            let alpha = base_alpha * falloff;
            let base = img.get_pixel(x as u32, y as u32);
            let blended = blend_pixel(base, color, alpha);
            img.put_pixel(x as u32, y as u32, blended);
        }
    }
}

fn blend_rect(
    img: &mut DynamicImage,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    color: Rgba<u8>,
    opacity: f64,
) {
    let (iw, ih) = img.dimensions();
    let alpha = opacity.clamp(0.0, 1.0) as f32;
    for py in y..(y + h).min(ih) {
        for px in x..(x + w).min(iw) {
            let base = img.get_pixel(px, py);
            let blended = blend_pixel(base, color, alpha);
            img.put_pixel(px, py, blended);
        }
    }
}

fn blend_circle(
    img: &mut DynamicImage,
    cx: i32,
    cy: i32,
    radius: i32,
    color: Rgba<u8>,
    opacity: f64,
) {
    let (w, h) = img.dimensions();
    let alpha = opacity.clamp(0.0, 1.0) as f32;
    for y in (cy - radius)..=(cy + radius) {
        if y < 0 || y >= h as i32 {
            continue;
        }
        for x in (cx - radius)..=(cx + radius) {
            if x < 0 || x >= w as i32 {
                continue;
            }
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= radius * radius {
                let base = img.get_pixel(x as u32, y as u32);
                let blended = blend_pixel(base, color, alpha);
                img.put_pixel(x as u32, y as u32, blended);
            }
        }
    }
}

fn blend_pixel(base: Rgba<u8>, overlay: Rgba<u8>, alpha: f32) -> Rgba<u8> {
    let overlay_alpha = (overlay[3] as f32 / 255.0) * alpha;
    if overlay_alpha <= 0.0 {
        return base;
    }
    let base_alpha = base[3] as f32 / 255.0;
    let out_alpha = overlay_alpha + base_alpha * (1.0 - overlay_alpha);
    if out_alpha <= 0.0 {
        return Rgba([0, 0, 0, 0]);
    }
    let r = ((overlay[0] as f32 * overlay_alpha + base[0] as f32 * base_alpha * (1.0 - overlay_alpha))
        / out_alpha) as u8;
    let g = ((overlay[1] as f32 * overlay_alpha + base[1] as f32 * base_alpha * (1.0 - overlay_alpha))
        / out_alpha) as u8;
    let b = ((overlay[2] as f32 * overlay_alpha + base[2] as f32 * base_alpha * (1.0 - overlay_alpha))
        / out_alpha) as u8;
    let a = (out_alpha * 255.0).round().clamp(0.0, 255.0) as u8;
    Rgba([r, g, b, a])
}

fn gradient_t(x: u32, y: u32, start: (u32, u32), end: (u32, u32)) -> f32 {
    let (sx, sy) = (start.0 as f32, start.1 as f32);
    let (ex, ey) = (end.0 as f32, end.1 as f32);
    let (px, py) = (x as f32, y as f32);
    let vx = ex - sx;
    let vy = ey - sy;
    let wx = px - sx;
    let wy = py - sy;
    let denom = vx * vx + vy * vy;
    if denom <= f32::EPSILON {
        return 0.0;
    }
    let t = (wx * vx + wy * vy) / denom;
    t.clamp(0.0, 1.0)
}

fn apply_channel_shift(img: DynamicImage, shift: (i32, i32, i32)) -> DynamicImage {
    let (w, h) = img.dimensions();
    let src = img.to_rgba8();
    let mut out = src.clone();
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let r = sample_channel(&src, x + shift.0, y, 0);
            let g = sample_channel(&src, x + shift.1, y, 1);
            let b = sample_channel(&src, x + shift.2, y, 2);
            let a = sample_channel(&src, x, y, 3);
            out.put_pixel(x as u32, y as u32, Rgba([r, g, b, a]));
        }
    }
    DynamicImage::ImageRgba8(out)
}

fn sample_channel(img: &image::RgbaImage, x: i32, y: i32, idx: usize) -> u8 {
    let (w, h) = img.dimensions();
    let xx = x.clamp(0, (w - 1) as i32) as u32;
    let yy = y.clamp(0, (h - 1) as i32) as u32;
    img.get_pixel(xx, yy)[idx]
}

fn apply_color_modulation(
    img: DynamicImage,
    brightness: f32,
    saturation: f32,
    hue_deg: f32,
) -> DynamicImage {
    let mut out = img.to_rgba8();
    for px in out.pixels_mut() {
        let (r, g, b, a) = (px[0], px[1], px[2], px[3]);
        let (mut h, mut s, mut v) = rgb_to_hsv(r, g, b);
        h = (h + hue_deg) % 360.0;
        if h < 0.0 {
            h += 360.0;
        }
        s = (s * saturation).clamp(0.0, 1.0);
        v = (v * brightness).clamp(0.0, 1.0);
        let (nr, ng, nb) = hsv_to_rgb(h, s, v);
        *px = Rgba([nr, ng, nb, a]);
    }
    DynamicImage::ImageRgba8(out)
}

fn rgb_to_hsv(r: u8, g: u8, b: u8) -> (f32, f32, f32) {
    let rf = r as f32 / 255.0;
    let gf = g as f32 / 255.0;
    let bf = b as f32 / 255.0;
    let max = rf.max(gf.max(bf));
    let min = rf.min(gf.min(bf));
    let delta = max - min;
    let h = if delta == 0.0 {
        0.0
    } else if max == rf {
        60.0 * (((gf - bf) / delta) % 6.0)
    } else if max == gf {
        60.0 * (((bf - rf) / delta) + 2.0)
    } else {
        60.0 * (((rf - gf) / delta) + 4.0)
    };
    let s = if max == 0.0 { 0.0 } else { delta / max };
    (h, s, max)
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (u8, u8, u8) {
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = v - c;
    let (rf, gf, bf) = match h {
        h if (0.0..60.0).contains(&h) => (c, x, 0.0),
        h if (60.0..120.0).contains(&h) => (x, c, 0.0),
        h if (120.0..180.0).contains(&h) => (0.0, c, x),
        h if (180.0..240.0).contains(&h) => (0.0, x, c),
        h if (240.0..300.0).contains(&h) => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let r = ((rf + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    let g = ((gf + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    let b = ((bf + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    (r, g, b)
}

#[allow(dead_code)]
fn apply_text_watermark(
    source: &Path,
    out: &Path,
    opacity: f64,
    text: &str,
    color_hex: &str,
    color_overridden: bool,
) -> Result<(), String> {
    let mut img = ImageReader::open(source)
        .map_err(|e| format!("Не удалось открыть {}: {}", source.display(), e))?
        .decode()
        .map_err(|e| format!("Не удалось декодировать {}: {}", source.display(), e))?;
    apply_text_to_image(&mut img, opacity, text, color_hex, color_overridden)?;
    img.save(out)
        .map_err(|e| format!("Не удалось сохранить {}: {}", out.display(), e))
}

fn apply_text_to_image(
    img: &mut DynamicImage,
    opacity: f64,
    text: &str,
    color_hex: &str,
    color_overridden: bool,
) -> Result<(), String> {
    let use_opacity = opacity.clamp(0.02, 1.0);
    let palette = pick_text_palette(img, color_hex, color_overridden);
    overlay_text_pattern_image(
        img,
        use_opacity,
        text,
        &palette.fill,
        &palette.stroke,
        &palette.mode,
    );
    Ok(())
}

fn overlay_text_pattern_image(
    img: &mut DynamicImage,
    opacity: f64,
    text: &str,
    fill: &str,
    stroke: &str,
    mode: &str,
) {
    let mut rng = rand::thread_rng();
    let (w, h) = img.dimensions();
    let base_dim = w.min(h).max(1) as f32;
    let font_size = ((base_dim / 1200.0) * 40.0).round().max(28.0) as i32;
    let word_width_factor = if mode == "rubble" { 3.2 } else { 4.8 };
    let text_width = font_size as f32 * word_width_factor;
    let tile_w = (text_width * 3.0).round().max(50.0) as i32;
    let tile_h = ((font_size as f32) * 8.4).round().max(70.0) as i32;
    let rotation = if rng.gen_bool(0.5) {
        rng.gen_range(-22.0..-18.0_f32)
    } else {
        rng.gen_range(18.0..22.0_f32)
    };
    let x1 = (tile_w as f32 * 0.25) as i32;
    let y1 = (tile_h as f32 * 0.35) as i32;
    let x2 = (tile_w as f32 * 0.75) as i32;
    let y2 = y1 + (tile_h / 2);
    let svg = build_text_pattern_svg(
        w, h, text, opacity, fill, stroke, rotation, font_size, tile_w, tile_h, x1, y1, x2, y2,
    );
    if let Some(overlay) = render_svg_overlay(&svg, w, h) {
        blend_overlay(img, &overlay, 1.0);
    }
}

fn blend_overlay(base: &mut DynamicImage, overlay: &image::RgbaImage, opacity: f64) {
    let (w, h) = base.dimensions();
    let alpha_scale = opacity.clamp(0.0, 1.0) as f32;
    for y in 0..h {
        for x in 0..w {
            let over = overlay.get_pixel(x, y);
            if over[3] == 0 {
                continue;
            }
            let base_px = base.get_pixel(x, y);
            // resvg/tiny-skia возвращает premultiplied alpha; разворачиваем в straight alpha.
            let over_alpha = over[3] as f32 / 255.0;
            let straight = if over_alpha > 0.0 {
                let inv = (255.0 / over[3] as f32).min(255.0);
                Rgba([
                    (over[0] as f32 * inv).round().clamp(0.0, 255.0) as u8,
                    (over[1] as f32 * inv).round().clamp(0.0, 255.0) as u8,
                    (over[2] as f32 * inv).round().clamp(0.0, 255.0) as u8,
                    over[3],
                ])
            } else {
                *over
            };
            let alpha = over_alpha * alpha_scale;
            let blended = blend_pixel(base_px, straight, alpha);
            base.put_pixel(x, y, blended);
        }
    }
}



struct TextPalette {
    fill: String,
    stroke: String,
    mode: String,
}

fn pick_text_palette(
    img: &DynamicImage,
    forced_color: &str,
    color_overridden: bool,
) -> TextPalette {
    let lc = forced_color.trim().to_lowercase();
    let is_dark_forced = lc == "#000" || lc == "black" || lc == "000000";
    if color_overridden {
        let fill = forced_color.trim().to_string();
        let stroke = if is_dark_forced {
            "rgba(0,0,0,0)".to_string()
        } else {
            "rgba(0,0,0,0)".to_string()
        };
        return TextPalette {
            fill,
            stroke,
            mode: "custom".to_string(),
        };
    }

    let (mean_r, mean_g, mean_b) = channel_means(img);
    let avg = (mean_r + mean_g + mean_b) / 3.0;
    let is_rubble_like =
        avg >= 110.0 && avg <= 170.0 && (mean_r - mean_g).abs() < 20.0 && (mean_g - mean_b).abs() < 20.0;
    let is_warm_sand_like = mean_r > mean_g && mean_g > mean_b && (mean_r - mean_b) > 45.0;

    if is_rubble_like {
        return TextPalette {
            fill: "rgba(255,255,255,1)".to_string(),
            stroke: "rgba(0,0,0,0)".to_string(),
            mode: "rubble".to_string(),
        };
    }

    if is_warm_sand_like {
        return TextPalette {
            fill: "rgba(255,255,255,1)".to_string(),
            stroke: "rgba(0,0,0,0)".to_string(),
            mode: "sand".to_string(),
        };
    }

    if avg >= 170.0 {
        return TextPalette {
            fill: "rgba(255,255,255,1)".to_string(),
            stroke: "rgba(0,0,0,0.6)".to_string(),
            mode: "bright".to_string(),
        };
    }
    if avg <= 110.0 {
        return TextPalette {
            fill: "rgba(255,255,255,1)".to_string(),
            stroke: "rgba(0,0,0,0)".to_string(),
            mode: "dark".to_string(),
        };
    }
    TextPalette {
        fill: "rgba(255,255,255,1)".to_string(),
        stroke: "rgba(0,0,0,0)".to_string(),
        mode: "mid".to_string(),
    }
}

fn channel_means(img: &DynamicImage) -> (f64, f64, f64) {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return (128.0, 128.0, 128.0);
    }
    let step = ((w.min(h) / 80).max(4)) as u32;
    let mut sum_r = 0.0;
    let mut sum_g = 0.0;
    let mut sum_b = 0.0;
    let mut count = 0.0;
    for y in (0..h).step_by(step as usize) {
        for x in (0..w).step_by(step as usize) {
            let px = img.get_pixel(x, y);
            sum_r += px[0] as f64;
            sum_g += px[1] as f64;
            sum_b += px[2] as f64;
            count += 1.0;
        }
    }
    if count > 0.0 {
        (sum_r / count, sum_g / count, sum_b / count)
    } else {
        (128.0, 128.0, 128.0)
    }
}

fn text_svg_color(color: &str) -> String {
    color.trim().to_string()
}

fn build_text_pattern_svg(
    width: u32,
    height: u32,
    text: &str,
    opacity: f64,
    fill_color: &str,
    stroke_color: &str,
    rotation: f32,
    font_size: i32,
    tile_w: i32,
    tile_h: i32,
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
) -> String {
    let fill = text_svg_color(fill_color);
    let stroke = text_svg_color(stroke_color);
    let stroke_opacity = (opacity * 0.75).clamp(0.0, 1.0);
    let stroke_width = 1.8;
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">
  <defs>
    <pattern id="tp" width="{tile_w}" height="{tile_h}" x="0" y="0" patternUnits="userSpaceOnUse" patternTransform="rotate({rotation} {cx} {cy})">
      <text x="{x1}" y="{y1}" text-anchor="middle" font-family="Arial, sans-serif" font-size="{font_size}" fill="{fill}" fill-opacity="{opacity}" stroke="{stroke}" stroke-opacity="{stroke_opacity}" stroke-width="{stroke_width}" paint-order="stroke fill" font-weight="600">{text}</text>
      <text x="{x2}" y="{y2}" text-anchor="middle" font-family="Arial, sans-serif" font-size="{font_size}" fill="{fill}" fill-opacity="{opacity}" stroke="{stroke}" stroke-opacity="{stroke_opacity}" stroke-width="{stroke_width}" paint-order="stroke fill" font-weight="600">{text}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#tp)" />
</svg>"#,
        w = width,
        h = height,
        tile_w = tile_w,
        tile_h = tile_h,
        rotation = rotation,
        cx = tile_w / 2,
        cy = tile_h / 2,
        x1 = x1,
        y1 = y1,
        x2 = x2,
        y2 = y2,
        font_size = font_size,
        fill = fill,
        stroke = stroke,
        opacity = opacity,
        stroke_opacity = stroke_opacity,
        stroke_width = stroke_width,
        text = text,
    )
}

fn fontdb_with_arial() -> std::sync::Arc<usvg::fontdb::Database> {
    static DB: OnceLock<std::sync::Arc<usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        let arial_paths = [
            "/Library/Fonts/Arial.ttf",
            "/Library/Fonts/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ];
        for path in arial_paths {
            let _ = db.load_font_file(std::path::Path::new(path));
        }
        std::sync::Arc::new(db)
    })
    .clone()
}

fn render_svg_overlay(svg: &str, width: u32, height: u32) -> Option<image::RgbaImage> {
    let mut options = usvg::Options::default();
    options.fontdb = fontdb_with_arial();
    let tree = usvg::Tree::from_str(svg, &options).ok()?;
    let mut pixmap = tiny_skia::Pixmap::new(width, height)?;
    let mut pixmap_mut = pixmap.as_mut();
    resvg::render(&tree, tiny_skia::Transform::identity(), &mut pixmap_mut);
    image::RgbaImage::from_raw(width, height, pixmap.data().to_vec())
}

fn history_paths(dir: &Path) -> (PathBuf, PathBuf) {
    (dir.join("hashes.json"), dir.join("hashes.json.tmp"))
}

fn load_history(dir: &Path) -> PhotoHistoryFile {
    let (main_path, tmp_path) = history_paths(dir);
    let mut ads = Vec::new();
    if let Ok(raw) = std::fs::read_to_string(&main_path) {
        ads.extend(parse_history_raw(&raw));
    }
    if let Ok(raw) = std::fs::read_to_string(&tmp_path) {
        ads.extend(parse_history_raw(&raw));
    }
    PhotoHistoryFile { version: 2, ads }
}

fn parse_history_raw(raw: &str) -> Vec<PhotoHistoryEntry> {
    let value: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    if let Some(ads_val) = value.get("ads") {
        if let Ok(entries) = serde_json::from_value::<Vec<PhotoHistoryEntry>>(ads_val.clone()) {
            return entries;
        }
    }
    if let Some(hashes_val) = value.get("hashes") {
        if let Some(list) = hashes_val.as_array() {
            return list
                .iter()
                .filter_map(|v| v.as_str())
                .map(|hash| PhotoHistoryEntry {
                    hash: Some(hash.to_string()),
                    ..PhotoHistoryEntry::default()
                })
                .collect();
        }
    }
    Vec::new()
}

fn save_history_tmp(dir: &Path, ads: &[PhotoHistoryEntry]) -> Result<(), String> {
    let (_, tmp_path) = history_paths(dir);
    let data = PhotoHistoryFile {
        version: 2,
        ads: ads.to_vec(),
    };
    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Не удалось сериализовать историю: {}", e))?;
    std::fs::write(&tmp_path, json)
        .map_err(|e| format!("Не удалось записать {}: {}", tmp_path.display(), e))
}

fn find_close_indices(
    items: &[Option<GeneratedVariant>],
    history: &[String],
    threshold: u32,
) -> Vec<(usize, u32)> {
    let mut result = Vec::new();
    for i in 0..items.len() {
        let Some(item) = &items[i] else { continue };
        let mut min_dist = u32::MAX;
        for h in history {
            min_dist = min_dist.min(hamming(&item.hash, h));
        }
        for j in 0..items.len() {
            if i == j {
                continue;
            }
            if let Some(other) = &items[j] {
                min_dist = min_dist.min(hamming(&item.hash, &other.hash));
            }
        }
        if min_dist < threshold {
            result.push((i, min_dist));
        }
    }
    result.sort_by_key(|(_, dist)| *dist);
    result
}

fn history_has_clean(ads: &[PhotoHistoryEntry], source_base: &str, city: &str) -> bool {
    for ad in ads {
        let name = ad
            .photo_path
            .as_deref()
            .or_else(|| ad.ad_id.as_deref());
        if let Some(stem) = name.and_then(|s| Path::new(s).file_stem()).and_then(|s| s.to_str())
        {
            if let Some((src, cty, counter)) = parse_filename_parts(stem) {
                if src == source_base && cty == city && counter == 1 {
                    return true;
                }
            }
        }
    }
    false
}

fn parse_filename_parts(stem: &str) -> Option<(String, String, u32)> {
    let parts: Vec<&str> = stem.split('_').collect();
    if parts.len() < 4 {
        return None;
    }
    let counter = parts.last()?.parse().ok()?;
    let city = parts.get(parts.len() - 3)?.to_string();
    let source = parts[..parts.len() - 3].join("_");
    Some((source, city, counter))
}
