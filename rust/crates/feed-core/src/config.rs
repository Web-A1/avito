use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Не удалось прочитать конфиг {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("Не удалось распарсить конфиг {path}: {source}")]
    Parse {
        path: String,
        #[source]
        source: serde_json::Error,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeWindow {
    pub start: String, // формат HH:MM
    pub end: String,   // формат HH:MM
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedConfig {
    pub time_windows: Vec<TimeWindow>,
    pub min_step_minutes: u16,
    pub max_step_minutes: u16,
}

impl Default for FeedConfig {
    fn default() -> Self {
        Self {
            time_windows: vec![
                TimeWindow {
                    start: "07:00".into(),
                    end: "10:00".into(),
                },
                TimeWindow {
                    start: "19:00".into(),
                    end: "23:59".into(),
                },
            ],
            min_step_minutes: 5,
            max_step_minutes: 30,
        }
    }
}

impl FeedConfig {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, ConfigError> {
        let path_ref = path.as_ref();
        let data = fs::read_to_string(path_ref).map_err(|e| ConfigError::Io {
            path: path_ref.display().to_string(),
            source: e,
        })?;
        serde_json::from_str::<FeedConfig>(&data).map_err(|e| ConfigError::Parse {
            path: path_ref.display().to_string(),
            source: e,
        })
    }
}
