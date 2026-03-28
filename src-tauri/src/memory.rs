use crate::state::AppState;
use serde_json::Value;
use std::fs;
use tauri::State;

#[derive(serde::Serialize)]
pub struct MemoryMeta {
    pub id: String,
    pub filename: String,
    pub size: u64,
    pub modified: String,
    pub count: usize,
}

fn mem_type_to_dir(mem_type: &str) -> Result<&str, String> {
    match mem_type {
        "group" => Ok("memory/group"),
        "private" => Ok("memory/private"),
        _ => Err(format!("Unknown memory type: {}", mem_type)),
    }
}

#[tauri::command]
pub fn list_memory(mem_type: String, state: State<'_, AppState>) -> Result<Vec<MemoryMeta>, String> {
    let dir = state.get_plugin_dir()?;
    let sub = mem_type_to_dir(&mem_type)?;
    let mem_dir = dir.join(sub);

    if !mem_dir.exists() {
        return Ok(vec![]);
    }

    let mut results = Vec::new();
    let entries = fs::read_dir(&mem_dir).map_err(|e| format!("Failed to read dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let filename = path.file_name().unwrap().to_string_lossy().to_string();
        let id = path.file_stem().unwrap().to_string_lossy().to_string();
        let meta = fs::metadata(&path).map_err(|e| format!("Metadata error: {}", e))?;
        let modified = meta
            .modified()
            .map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .unwrap_or_default();

        let count = fs::read_to_string(&path)
            .ok()
            .and_then(|c| serde_json::from_str::<Value>(&c).ok())
            .and_then(|v| v.as_array().map(|a| a.len()))
            .unwrap_or(0);

        results.push(MemoryMeta { id, filename, size: meta.len(), modified, count });
    }

    results.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(results)
}

#[tauri::command]
pub fn get_memory(mem_type: String, id: String, state: State<'_, AppState>) -> Result<Value, String> {
    let dir = state.get_plugin_dir()?;
    let sub = mem_type_to_dir(&mem_type)?;
    let path = dir.join(sub).join(format!("{}.json", id));

    if !path.exists() {
        return Ok(Value::Array(vec![]));
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Read error: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Parse error: {}", e))
}

#[tauri::command]
pub fn save_memory(mem_type: String, id: String, data: Value, state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.get_plugin_dir()?;
    let sub = mem_type_to_dir(&mem_type)?;
    let mem_dir = dir.join(sub);
    fs::create_dir_all(&mem_dir).map_err(|e| format!("Mkdir error: {}", e))?;

    let path = mem_dir.join(format!("{}.json", id));
    let content = serde_json::to_string_pretty(&data).map_err(|e| format!("Serialize error: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Write error: {}", e))
}

#[tauri::command]
pub fn delete_memory(mem_type: String, id: String, state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.get_plugin_dir()?;
    let sub = mem_type_to_dir(&mem_type)?;
    let path = dir.join(sub).join(format!("{}.json", id));

    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Delete error: {}", e))?;
    }
    Ok(())
}
