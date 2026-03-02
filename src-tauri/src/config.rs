use crate::state::AppState;
use chrono::Local;
use serde_json::Value;
use std::fs;
use tauri::State;

fn config_key_to_filename(key: &str) -> Result<&str, String> {
    match key {
        "runtime" => Ok("runtime_config.json"),
        "api" => Ok("api_config.json"),
        "groupPersonality" => Ok("group_personality.json"),
        "privatePersonality" => Ok("private_personality.json"),
        "commands" => Ok("commands.json"),
        "usage" => Ok("group_usage_counts.json"),
        _ => Err(format!("Unknown config key: {}", key)),
    }
}

#[tauri::command]
pub fn get_config(key: String, state: State<'_, AppState>) -> Result<Value, String> {
    let dir = state.get_plugin_dir()?;
    let filename = config_key_to_filename(&key)?;
    let path = dir.join(filename);

    if !path.exists() {
        return Ok(Value::Null);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", filename, e))
}

#[tauri::command]
pub fn save_config(key: String, data: Value, state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.get_plugin_dir()?;
    let filename = config_key_to_filename(&key)?;
    let path = dir.join(filename);

    // Auto-backup before write
    if path.exists() {
        let backup_dir = dir.join(".backups");
        fs::create_dir_all(&backup_dir)
            .map_err(|e| format!("Failed to create backup dir: {}", e))?;
        let timestamp = Local::now().format("%Y%m%d_%H%M%S");
        let backup_name = format!("{}_{}", timestamp, filename);
        fs::copy(&path, backup_dir.join(&backup_name))
            .map_err(|e| format!("Failed to backup: {}", e))?;
    }

    let content = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write {}: {}", filename, e))
}

#[derive(serde::Serialize)]
pub struct FileHealth {
    pub key: String,
    pub filename: String,
    pub exists: bool,
    pub size: u64,
    pub modified: String,
}

#[derive(serde::Serialize)]
pub struct SystemInfo {
    pub plugin_dir: String,
    pub files: Vec<FileHealth>,
}

#[tauri::command]
pub fn get_system_info(state: State<'_, AppState>) -> Result<SystemInfo, String> {
    let dir = state.get_plugin_dir()?;
    let keys = vec!["runtime", "api", "groupPersonality", "privatePersonality", "commands", "usage"];

    let files: Vec<FileHealth> = keys
        .iter()
        .map(|key| {
            let filename = config_key_to_filename(key).unwrap_or("unknown");
            let path = dir.join(filename);
            let (exists, size, modified) = if let Ok(meta) = fs::metadata(&path) {
                let mtime = meta
                    .modified()
                    .map(|t| {
                        let dt: chrono::DateTime<Local> = t.into();
                        dt.format("%Y-%m-%d %H:%M:%S").to_string()
                    })
                    .unwrap_or_default();
                (true, meta.len(), mtime)
            } else {
                (false, 0, String::new())
            };
            FileHealth { key: key.to_string(), filename: filename.to_string(), exists, size, modified }
        })
        .collect();

    Ok(SystemInfo {
        plugin_dir: dir.to_string_lossy().to_string(),
        files,
    })
}

#[tauri::command]
pub fn set_plugin_dir(dir: String, state: State<'_, AppState>) -> Result<(), String> {
    let path = std::path::PathBuf::from(&dir);
    if !path.exists() {
        return Err(format!("目录不存在: {}", dir));
    }
    if !path.is_dir() {
        return Err(format!("路径不是一个目录: {}", dir));
    }
    state.set_plugin_dir(path)?;
    Ok(())
}
