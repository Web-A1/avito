use glob::glob;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WatermarkOverride {
    #[serde(rename = "file")]
    pub file: String,
    #[serde(rename = "patternOpacity", default)]
    pub pattern_opacity: Option<f64>,
    #[serde(rename = "textOpacity", default)]
    pub text_opacity: Option<f64>,
    #[serde(rename = "textWatermark", default)]
    pub text_watermark: Option<String>,
    #[serde(rename = "textColor", default)]
    pub text_color: Option<String>,
}

pub fn load_overrides(path: impl AsRef<Path>) -> Result<Vec<WatermarkOverride>, String> {
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Не удалось прочитать overrides: {}", e))?;
    serde_json::from_str::<Vec<WatermarkOverride>>(&data)
        .map_err(|e| format!("Не удалось распарсить overrides: {}", e))
}

/// Собирает шаблон overrides по маске файлов, чтобы удобно заполнить вручную.
pub fn generate_overrides_template(
    input_glob: &str,
    include_existing: bool,
) -> Result<Vec<WatermarkOverride>, String> {
    let mut out = Vec::new();
    for entry in glob(input_glob).map_err(|e| format!("Неверная маска {}: {}", input_glob, e))?
    {
        if let Ok(path) = entry {
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                out.push(WatermarkOverride {
                    file: name.to_string(),
                    pattern_opacity: None,
                    text_opacity: None,
                    text_watermark: None,
                    text_color: None,
                });
            }
        }
    }
    if !include_existing {
        // Убираем дубликаты по имени файла
        out.sort_by(|a, b| a.file.cmp(&b.file));
        out.dedup_by(|a, b| a.file == b.file);
    }
    Ok(out)
}
