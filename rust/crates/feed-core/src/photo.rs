use std::path::{Path, PathBuf};

use font8x8::UnicodeFonts;
use image::{
    imageops::{blur, brighten, contrast, crop_imm, flip_horizontal_in_place, resize},
    DynamicImage, GenericImage, GenericImageView, ImageReader, Rgba,
};
use rand::Rng;
use serde::Serialize;

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
}

#[derive(Debug, Clone)]
struct EffectiveWatermark {
    text: String,
    text_color: String,
    text_opacity: f64,
    pattern_opacity: f64,
}

#[derive(Debug, Clone, Copy)]
struct TransformParams {
    crop: f32,
    brighten: i32,
    contrast: f32,
    blur: f32,
    flip: bool,
}

fn ahash(img: &DynamicImage) -> u64 {
    use image::imageops::FilterType;
    let small = DynamicImage::ImageRgba8(resize(img, 8, 8, FilterType::Nearest)).to_luma8();
    let mut total: u32 = 0;
    for &pix in small.as_raw() {
        total += pix as u32;
    }
    let avg = (total as f32 / 64.0) as u8;
    let mut hash: u64 = 0;
    for &pix in small.as_raw() {
        hash <<= 1;
        if pix > avg {
            hash |= 1;
        }
    }
    hash
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
    overrides.iter().find(|o| o.file == name)
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

fn draw_text_bitmap(img: &mut DynamicImage, text: &str, x: u32, y: u32, color: Rgba<u8>) {
    let font = font8x8::BASIC_FONTS;
    let mut cursor_x = x as i32;
    let cursor_y = y as i32;
    for ch in text.chars() {
        if let Some(glyph) = font.get(ch) {
            for (row, bits) in glyph.iter().enumerate() {
                for col in 0..8 {
                    if bits & (1 << col) != 0 {
                        let px = cursor_x + (7 - col as i32);
                        let py = cursor_y + row as i32;
                        if px >= 0 && py >= 0 {
                            let px_u = px as u32;
                            let py_u = py as u32;
                            if px_u < img.width() && py_u < img.height() {
                                img.put_pixel(px_u, py_u, color);
                            }
                        }
                    }
                }
            }
            cursor_x += 8;
        } else {
            cursor_x += 8;
        }
    }
}

fn parse_hex_color(s: &str) -> Option<(u8, u8, u8)> {
    let s = s.trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&s[0..2], 16).ok()?;
    let g = u8::from_str_radix(&s[2..4], 16).ok()?;
    let b = u8::from_str_radix(&s[4..6], 16).ok()?;
    Some((r, g, b))
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

    let mut rng = rand::thread_rng();
    let mut variants = Vec::new();
    let mut seen_hashes: std::collections::HashSet<u64> = std::collections::HashSet::new();
    for idx in 0..count {
        let mut attempts = 0;
        let mut saved = false;
        while attempts < 6 && !saved {
            attempts += 1;
            let mut img = DynamicImage::ImageRgba8(base_img.clone());
            if idx > 0 {
                let t = TransformParams {
                    crop: rng.gen_range(0.0..0.06_f32),
                    brighten: rng.gen_range(-14..=14),
                    contrast: rng.gen_range(-0.15..=0.15),
                    blur: rng.gen_range(0.0..0.7),
                    flip: rng.gen_bool(0.3),
                };
                img = apply_transforms(img, t);
                apply_pattern_overlay(&mut img, effective.pattern_opacity);
            }
            apply_text_to_image(
                &mut img,
                effective.text_opacity,
                &effective.text,
                &effective.text_color,
            )?;

            let hash = ahash(&img);
            if seen_hashes.contains(&hash) && attempts < 6 {
                continue;
            }
            seen_hashes.insert(hash);

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
    let text_color = override_opt
        .text_color
        .clone()
        .or_else(|| opts.text_color.clone())
        .unwrap_or_else(|| "#FFFFFF".to_string());
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
    }
}

fn apply_transforms(img: DynamicImage, params: TransformParams) -> DynamicImage {
    let (w, h) = img.dimensions();
    let crop_x = (w as f32 * params.crop) as u32;
    let crop_y = (h as f32 * params.crop) as u32;
    let crop_w = w.saturating_sub(crop_x);
    let crop_h = h.saturating_sub(crop_y);
    let left = rand::thread_rng().gen_range(0..=crop_x.min(w / 20 + 1));
    let top = rand::thread_rng().gen_range(0..=crop_y.min(h / 20 + 1));
    let cropped = crop_imm(&img, left, top, crop_w.max(16), crop_h.max(16)).to_image();
    let mut out = DynamicImage::ImageRgba8(cropped);
    if params.flip {
        flip_horizontal_in_place(out.as_mut_rgba8().unwrap());
    }
    if params.blur > 0.01 {
        out = DynamicImage::ImageRgba8(blur(&out, params.blur));
    }
    if params.brighten != 0 {
        out = DynamicImage::ImageRgba8(brighten(&out, params.brighten));
    }
    if params.contrast.abs() > f32::EPSILON {
        out = DynamicImage::ImageRgba8(contrast(&out, params.contrast));
    }
    DynamicImage::ImageRgba8(resize(&out, w, h, image::imageops::FilterType::Triangle))
}

fn apply_pattern_overlay(img: &mut DynamicImage, opacity: f64) {
    if opacity <= 0.0 {
        return;
    }
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
            let alpha = (opacity * 255.0) as u8;
            let color = Rgba([r, g, b, alpha]);
            let sx = std::cmp::min(step as u32, w - x);
            let sy = std::cmp::min(step as u32, h - y);
            for px in 0..sx {
                for py in 0..sy {
                    let tx = x + px;
                    let ty = y + py;
                    if tx < w && ty < h {
                        img.put_pixel(tx, ty, color);
                    }
                }
            }
        }
    }
}

fn apply_text_watermark(
    source: &Path,
    out: &Path,
    opacity: f64,
    text: &str,
    color_hex: &str,
) -> Result<(), String> {
    let mut img = ImageReader::open(source)
        .map_err(|e| format!("Не удалось открыть {}: {}", source.display(), e))?
        .decode()
        .map_err(|e| format!("Не удалось декодировать {}: {}", source.display(), e))?;
    apply_text_to_image(&mut img, opacity, text, color_hex)?;
    img.save(out)
        .map_err(|e| format!("Не удалось сохранить {}: {}", out.display(), e))
}

fn apply_text_to_image(
    img: &mut DynamicImage,
    opacity: f64,
    text: &str,
    color_hex: &str,
) -> Result<(), String> {
    let (r, g, b) = parse_hex_color(color_hex).unwrap_or((255, 255, 255));
    let alpha = (opacity.clamp(0.02, 1.0) * 255.0) as u8;
    let color = Rgba([r, g, b, alpha]);
    let (w, h) = img.dimensions();
    let mut rng = rand::thread_rng();
    let positions = [
        (w / 6, h / 6),
        (w / 3, h / 3),
        (w / 2, h / 2),
        (w / 2, h / 4),
    ];
    let &(px, py) = positions
        .get(rng.gen_range(0..positions.len()))
        .unwrap_or(&(w / 3, h / 3));
    draw_text_bitmap(img, text, px, py, color);
    Ok(())
}
