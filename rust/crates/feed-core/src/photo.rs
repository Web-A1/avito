use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use chrono::Utc;
use image::{
    imageops::{blur, contrast, crop_imm, flip_horizontal_in_place, resize},
    DynamicImage, GenericImage, GenericImageView, ImageReader, Rgba,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Plan, WatermarkOverride};

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
    pub overrides: Vec<WatermarkOverride>,
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
            overrides: Vec::new(),
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
    pub date_label: String,
    pub history_dir: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct EffectiveWatermark {
    text: String,
    text_color: String,
    text_opacity: f64,
    pattern_opacity: f64,
    text_opacity_overridden: bool,
    text_color_overridden: bool,
}

#[derive(Debug, Clone, Copy)]
struct TransformParams {
    crop: f32,
    brightness: f32,
    saturation: f32,
    hue_deg: f32,
    contrast: f32,
    blur: f32,
    flip: bool,
    scale: f32,
    shift_x: f32,
    shift_y: f32,
    channel_shift: Option<(i32, i32, i32)>,
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

    let wm_override = resolve_override(source, &opts.overrides);
    let override_opacity = wm_override.and_then(|o| o.text_opacity);
    let override_color = wm_override.and_then(|o| o.text_color.clone());
    let override_text = wm_override.and_then(|o| o.text_watermark.clone());
    let override_pattern = wm_override.and_then(|o| o.pattern_opacity);
    let eff = effective_watermark(
        opts,
        &WatermarkOverride {
            file: "".to_string(),
            pattern_opacity: override_pattern,
            text_opacity: override_opacity,
            text_watermark: override_text.clone(),
            text_color: override_color.clone(),
        },
    );
    let use_ops: Vec<f64> = if let Some(op) = override_opacity {
        vec![op]
    } else {
        opacities.to_vec()
    };

    let mut variants = Vec::new();
    for (i, op) in use_ops.iter().enumerate() {
        let file_name = format!("{}_preview_{:02}_opacity_{:.3}.{}", stem, i + 1, op, ext);
        let mut out_path = opts.out_dir.clone();
        out_path.push(&file_name);

        apply_text_watermark(
            source,
            &out_path,
            *op,
            override_text
                .as_deref()
                .or_else(|| Some(&eff.text))
                .unwrap_or("NERUDA"),
            override_color
                .as_deref()
                .or_else(|| Some(&eff.text_color))
                .unwrap_or("#FFFFFF"),
            override_color.is_some(),
        )?;

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

fn resolve_override<'a>(
    source: &Path,
    overrides: &'a [WatermarkOverride],
) -> Option<&'a WatermarkOverride> {
    let name = source.file_name()?.to_str()?;
    let stem = Path::new(name).file_stem().and_then(|s| s.to_str());
    let full = source.to_string_lossy();
    overrides.iter().find(|o| {
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
        if matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            out.push('_');
        } else if ch.is_whitespace() {
            out.push('_');
        } else {
            out.push(ch);
        }
    }
    while out.contains("__") {
        out = out.replace("__", "_");
    }
    out.trim_matches('_').to_string()
}

/// Черновой генератор вариантов для одного исходника (count берется из opts или job.count).
pub fn generate_variants(source: &Path, opts: &PhotoOptions) -> Result<Vec<PhotoVariant>, String> {
    let job = PhotoJob {
        source: source.to_path_buf(),
        count: opts.count,
        material_id: None,
        address: None,
        safe_address: String::new(),
        date_label: "".to_string(),
        history_dir: None,
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
        let mut variants = generate_job_variants(&job, opts)?;
        out.append(&mut variants);
    }
    Ok(out)
}

/// Собирает задания по плану: распределяет count по адресам и исходникам (originals).
pub fn collect_photo_jobs(
    plan: &Plan,
    photos_root: &Path,
    default_per_location: u32,
    date_label: &str,
) -> Result<Vec<PhotoJob>, String> {
    let aliases = plan.aliases.clone().unwrap_or_default();
    let mut jobs = Vec::new();

    for task in &plan.tasks {
        let material = aliases
            .materials
            .get(&task.material_id)
            .cloned()
            .unwrap_or_else(|| task.material_id.clone());
        let locations = if !task.locations.is_empty() {
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
        let loc_len = std::cmp::max(1, locations.len());
        let originals = list_originals(photos_root, &material)?;
        if originals.is_empty() {
            return Err(format!(
                "Не найдены исходники в {}/{}",
                photos_root.display(),
                material
            ));
        }
        for loc in locations {
            let resolved_address = aliases
                .addresses
                .get(&loc.address)
                .cloned()
                .unwrap_or_else(|| loc.address.clone());
            let target = if loc.count > 0 {
                loc.count
            } else if task.count > 0 {
                std::cmp::max(1, task.count / loc_len as u32)
            } else {
                std::cmp::max(1, default_per_location)
            };
            let safe_address = if resolved_address.is_empty() {
                "default".to_string()
            } else {
                sanitize_for_path(&resolved_address.to_lowercase())
            };
            let per_file = std::cmp::max(1, target as usize / originals.len());
            let remainder = target as usize % originals.len();
            for (idx, src) in originals.iter().enumerate() {
                let add = per_file as u32 + if idx < remainder { 1 } else { 0 };
                if add == 0 {
                    continue;
                }
                jobs.push(PhotoJob {
                    source: src.clone(),
                    count: add,
                    material_id: Some(material.clone()),
                    address: Some(resolved_address.clone()),
                    safe_address: safe_address.clone(),
                    date_label: date_label.to_string(),
                    history_dir: Some(photos_root.join(&material).join(&safe_address)),
                });
            }
        }
    }

    Ok(jobs)
}

fn list_originals(root: &Path, material: &str) -> Result<Vec<PathBuf>, String> {
    let dir = root.join(material).join("originals");
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| format!("Не удалось прочитать {}: {}", dir.display(), e))?
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
    Ok(files)
}

fn generate_job_variants(job: &PhotoJob, opts: &PhotoOptions) -> Result<Vec<PhotoVariant>, String> {
    if !job.source.exists() {
        return Err(format!("Исходник не найден: {}", job.source.display()));
    }
    if job.count == 0 && opts.count == 0 {
        return Ok(Vec::new());
    }
    let count = if job.count > 0 { job.count } else { opts.count };
    let eff_override = resolve_override(&job.source, &opts.overrides).cloned();
    let effective = effective_watermark(opts, &eff_override.unwrap_or_default());

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
    let variant_token = {
        let v = sanitize_token(stem);
        if v.is_empty() {
            "variant".to_string()
        } else {
            v
        }
    };
    let city_token = {
        let v = if job.safe_address.is_empty() {
            "city".to_string()
        } else {
            sanitize_token(&job.safe_address)
        };
        if v.is_empty() {
            "city".to_string()
        } else {
            v
        }
    };
    let date_token = {
        let v = if job.date_label.is_empty() {
            "date".to_string()
        } else {
            sanitize_token(&job.date_label)
        };
        if v.is_empty() {
            "date".to_string()
        } else {
            v
        }
    };

    let mut out_dir = opts.out_dir.clone();
    if !material_token.is_empty() {
        out_dir.push(&material_token);
    }
    if !city_token.is_empty() {
        out_dir.push(&city_token);
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

    let mut history = if let Some(dir) = job.history_dir.as_ref() {
        if !dir.exists() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("Не удалось создать {}: {}", dir.display(), e))?;
        }
        load_history(dir)
    } else {
        PhotoHistoryFile::default()
    };
    let history_hashes: Vec<String> = history
        .ads
        .iter()
        .filter_map(|ad| ad.hash.clone())
        .collect();
    let has_clean = history_has_clean(&history.ads, &variant_token, &city_token);
    let allow_clean = !has_clean;

    let mut rng = rand::thread_rng();
    let mut variants = Vec::new();
    let mut seen_hashes: Vec<String> = Vec::new();
    for idx in 0..count {
        let mut attempts = 0;
        let mut saved = false;
        while attempts < 6 && !saved {
            attempts += 1;
            let mut img = DynamicImage::ImageRgba8(base_img.clone());
            let needs_transform = idx > 0 || !allow_clean;
            if needs_transform {
                let t = TransformParams {
                    crop: rng.gen_range(0.0..0.06_f32),
                    brightness: rng.gen_range(0.94..1.08_f32),
                    saturation: rng.gen_range(0.93..1.08_f32),
                    hue_deg: rng.gen_range(-12.0..12.0_f32),
                    contrast: rng.gen_range(-0.15..=0.15),
                    blur: rng.gen_range(0.0..0.7),
                    flip: rng.gen_bool(0.3),
                    scale: rng.gen_range(0.92..1.08_f32),
                    shift_x: rng.gen_range(-0.04..0.04_f32),
                    shift_y: rng.gen_range(-0.04..0.04_f32),
                    channel_shift: if rng.gen_bool(0.5) {
                        Some((
                            rng.gen_range(-2..=2),
                            rng.gen_range(-2..=2),
                            rng.gen_range(-2..=2),
                        ))
                    } else {
                        None
                    },
                };
                img = apply_transforms(img, t);
                apply_pattern_overlay(&mut img, effective.pattern_opacity);
            }
        apply_text_to_image(
            &mut img,
            effective.text_opacity,
            &effective.text,
            &effective.text_color,
            effective.text_opacity_overridden,
            effective.text_color_overridden,
        )?;

            let hash = ahash(&img);
            if is_too_close(&hash, &seen_hashes, &history_hashes) && attempts < 6 {
                continue;
            }
            seen_hashes.push(hash.clone());

            let file_name = format!(
                "{}_{}_{}_{}_{}.{}",
                material_token,
                variant_token,
                city_token,
                date_token,
                idx + 1,
                ext
            );
            let mut out_path = out_dir.clone();
            out_path.push(&file_name);
            img.save(&out_path)
                .map_err(|e| format!("Не удалось сохранить {}: {}", out_path.display(), e))?;
            let ad_id = Path::new(&file_name)
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string());
            history.ads.push(PhotoHistoryEntry {
                ad_id,
                hash: Some(hash),
                material_id: job.material_id.clone(),
                address: job.address.clone(),
                date_begin: Some(job.date_label.clone()),
                photo_path: Some(file_name.clone()),
                timestamp: Some(Utc::now().to_rfc3339()),
            });
            variants.push(PhotoVariant {
                source: job.source.clone(),
                file_name,
                material_id: job.material_id.clone(),
                address: job.address.clone(),
                url: Some(out_path.display().to_string()),
            });
            saved = true;
        }
        if !saved {
            return Err(format!(
                "Не удалось получить уникальный вариант для {} ({} попыток)",
                job.source.display(),
                attempts
            ));
        }
    }

    if let Some(dir) = job.history_dir.as_ref() {
        save_history_tmp(dir, &history.ads)?;
        save_history(dir, &history.ads)?;
        clear_history_tmp(dir)?;
    }

    Ok(variants)
}

fn effective_watermark(
    opts: &PhotoOptions,
    override_opt: &WatermarkOverride,
) -> EffectiveWatermark {
    let text = override_opt
        .text_watermark
        .clone()
        .or_else(|| opts.text_watermark.clone())
        .unwrap_or_else(|| "NERUDA".to_string());
    let text_color_overridden = override_opt.text_color.is_some() || opts.text_color.is_some();
    let text_color = override_opt
        .text_color
        .clone()
        .or_else(|| opts.text_color.clone())
        .unwrap_or_else(|| "#FFFFFF".to_string());
    let text_opacity_overridden = override_opt.text_opacity.is_some() || opts.text_opacity.is_some();
    let text_opacity = override_opt
        .text_opacity
        .or(opts.text_opacity)
        .unwrap_or(0.08_f64)
        .clamp(0.02, 0.8);
    let pattern_opacity = override_opt
        .pattern_opacity
        .or(opts.pattern_opacity)
        .unwrap_or(0.04_f64)
        .clamp(0.0, 0.25);

    EffectiveWatermark {
        text,
        text_color,
        text_opacity,
        pattern_opacity,
        text_opacity_overridden,
        text_color_overridden,
    }
}

fn apply_transforms(img: DynamicImage, params: TransformParams) -> DynamicImage {
    let (w, h) = img.dimensions();
    let scale = params.scale.max(0.5);
    let scaled_w = (w as f32 * scale).round().max(16.0) as u32;
    let scaled_h = (h as f32 * scale).round().max(16.0) as u32;
    let mut out = DynamicImage::ImageRgba8(resize(
        &img,
        scaled_w,
        scaled_h,
        image::imageops::FilterType::Triangle,
    ));
    if params.flip {
        flip_horizontal_in_place(out.as_mut_rgba8().unwrap());
    }
    let crop_x = (scaled_w as f32 * params.crop) as u32;
    let crop_y = (scaled_h as f32 * params.crop) as u32;
    let crop_w = w.min(scaled_w.saturating_sub(crop_x));
    let crop_h = h.min(scaled_h.saturating_sub(crop_y));
    let left_max = scaled_w.saturating_sub(crop_w);
    let top_max = scaled_h.saturating_sub(crop_h);
    let left = ((left_max as f32 * (0.5 + params.shift_x).clamp(0.0, 1.0)) as u32).min(left_max);
    let top = ((top_max as f32 * (0.5 + params.shift_y).clamp(0.0, 1.0)) as u32).min(top_max);
    let cropped = crop_imm(&out, left, top, crop_w.max(16), crop_h.max(16)).to_image();
    let mut out = DynamicImage::ImageRgba8(cropped);
    if params.blur > 0.01 {
        out = DynamicImage::ImageRgba8(blur(&out, params.blur));
    }
    out = apply_color_modulation(out, params.brightness, params.saturation, params.hue_deg);
    if params.contrast.abs() > f32::EPSILON {
        out = DynamicImage::ImageRgba8(contrast(&out, params.contrast));
    }
    if let Some(shift) = params.channel_shift {
        out = apply_channel_shift(out, shift);
    }
    DynamicImage::ImageRgba8(resize(&out, w, h, image::imageops::FilterType::Triangle))
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
    apply_text_to_image(&mut img, opacity, text, color_hex, true, color_overridden)?;
    img.save(out)
        .map_err(|e| format!("Не удалось сохранить {}: {}", out.display(), e))
}

fn apply_text_to_image(
    img: &mut DynamicImage,
    opacity: f64,
    text: &str,
    color_hex: &str,
    opacity_overridden: bool,
    color_overridden: bool,
) -> Result<(), String> {
    let use_opacity = if opacity_overridden {
        opacity
    } else {
        adaptive_text_opacity(img)
    };
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
            let alpha = (over[3] as f32 / 255.0) * alpha_scale;
            let blended = blend_pixel(base_px, *over, alpha);
            base.put_pixel(x, y, blended);
        }
    }
}


fn adaptive_text_opacity(img: &DynamicImage) -> f64 {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return 0.08;
    }
    let step = ((w.min(h) / 80).max(4)) as u32;
    let mut total = 0.0;
    let mut count = 0.0;
    for y in (0..h).step_by(step as usize) {
        for x in (0..w).step_by(step as usize) {
            let px = img.get_pixel(x, y);
            let lum = (0.2126 * px[0] as f64 + 0.7152 * px[1] as f64 + 0.0722 * px[2] as f64)
                / 255.0;
            total += lum * 255.0;
            count += 1.0;
        }
    }
    let avg = if count > 0.0 { total / count } else { 128.0 };
    let opacity = if avg <= 180.0 {
        let ratio = avg / 180.0;
        0.070 + ratio.powf(2.7) * 0.080
    } else {
        let ratio = ((avg - 180.0) / 60.0).min(1.0);
        0.17 + ratio * 0.05
    };
    opacity.clamp(0.04, 0.30)
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
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">
  <defs>
    <pattern id="tp" width="{tile_w}" height="{tile_h}" x="0" y="0" patternUnits="userSpaceOnUse" patternTransform="rotate({rotation} {cx} {cy})">
      <text x="{x1}" y="{y1}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="{font_size}" fill="{fill}" fill-opacity="{opacity}" stroke="{stroke}" stroke-opacity="0" stroke-width="0" paint-order="stroke fill" font-weight="700">{text}</text>
      <text x="{x2}" y="{y2}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="{font_size}" fill="{fill}" fill-opacity="{opacity}" stroke="{stroke}" stroke-opacity="0" stroke-width="0" paint-order="stroke fill" font-weight="700">{text}</text>
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
        text = text,
    )
}

fn fontdb_with_inter() -> std::sync::Arc<usvg::fontdb::Database> {
    static DB: OnceLock<std::sync::Arc<usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        db.load_system_fonts();
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("assets/Inter-Regular.ttf");
        let _ = db.load_font_file(path);
        std::sync::Arc::new(db)
    })
    .clone()
}

fn render_svg_overlay(svg: &str, width: u32, height: u32) -> Option<image::RgbaImage> {
    let mut options = usvg::Options::default();
    options.fontdb = fontdb_with_inter();
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

fn save_history(dir: &Path, ads: &[PhotoHistoryEntry]) -> Result<(), String> {
    let (main_path, _) = history_paths(dir);
    let data = PhotoHistoryFile {
        version: 2,
        ads: ads.to_vec(),
    };
    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Не удалось сериализовать историю: {}", e))?;
    std::fs::write(&main_path, json)
        .map_err(|e| format!("Не удалось записать {}: {}", main_path.display(), e))
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

fn clear_history_tmp(dir: &Path) -> Result<(), String> {
    let (_, tmp_path) = history_paths(dir);
    if tmp_path.exists() {
        std::fs::remove_file(&tmp_path)
            .map_err(|e| format!("Не удалось удалить {}: {}", tmp_path.display(), e))?;
    }
    Ok(())
}

fn is_too_close(hash: &str, seen: &[String], history: &[String]) -> bool {
    for other in seen.iter().chain(history.iter()) {
        if hamming(hash, other) <= HASH_THRESHOLD {
            return true;
        }
    }
    false
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
