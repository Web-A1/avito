use glob::glob;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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

#[derive(Debug, Clone, Deserialize, Default)]
struct WatermarkOverrideFields {
    #[serde(rename = "patternOpacity", default)]
    pattern_opacity: Option<f64>,
    #[serde(rename = "textOpacity", default)]
    text_opacity: Option<f64>,
    #[serde(rename = "textWatermark", default)]
    text_watermark: Option<String>,
    #[serde(rename = "textColor", default)]
    text_color: Option<String>,
}

pub fn load_overrides(path: impl AsRef<Path>) -> Result<Vec<WatermarkOverride>, String> {
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Не удалось прочитать overrides: {}", e))?;
    let raw: Value =
        serde_json::from_str(&data).map_err(|e| format!("Не удалось распарсить overrides: {}", e))?;

    match raw {
        Value::Array(_) => serde_json::from_value::<Vec<WatermarkOverride>>(raw)
            .map_err(|e| format!("Не удалось распарсить overrides: {}", e)),
        Value::Object(map) => {
            let files_value = map.get("files").cloned().unwrap_or(Value::Object(map));
            let files_map = match files_value {
                Value::Object(inner) => inner,
                _ => return Ok(Vec::new()),
            };

            let mut out = Vec::new();
            for (file, value) in files_map {
                let fields = serde_json::from_value::<WatermarkOverrideFields>(value)
                    .unwrap_or_default();
                out.push(WatermarkOverride {
                    file,
                    pattern_opacity: fields.pattern_opacity,
                    text_opacity: fields.text_opacity,
                    text_watermark: fields.text_watermark,
                    text_color: fields.text_color,
                });
            }
            Ok(out)
        }
        _ => Ok(Vec::new()),
    }
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
