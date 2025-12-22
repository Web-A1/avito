use std::fs;
use std::path::Path;

use serde::de::DeserializeOwned;

use crate::{PhotoMapping, Plan, UpdateRules};

/// Универсальная загрузка JSON-файла в структуру.
pub fn read_json_file<T: DeserializeOwned>(path: impl AsRef<Path>) -> Result<T, String> {
    let path_ref = path.as_ref();
    let data = fs::read_to_string(path_ref)
        .map_err(|e| format!("Не удалось прочитать {}: {}", path_ref.display(), e))?;
    serde_json::from_str::<T>(&data)
        .map_err(|e| format!("Не удалось распарсить {}: {}", path_ref.display(), e))
}

/// Чтение плана из файла.
pub fn read_plan(path: impl AsRef<Path>) -> Result<Plan, String> {
    read_json_file(path)
}

/// Чтение правил обновления.
pub fn read_update_rules(path: impl AsRef<Path>) -> Result<UpdateRules, String> {
    read_json_file(path)
}

/// Чтение маппинга фото (photos_links_*.json).
pub fn read_photo_mapping(path: impl AsRef<Path>) -> Result<PhotoMapping, String> {
    read_json_file(path)
}
