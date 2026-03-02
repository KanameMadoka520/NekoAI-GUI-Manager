use crate::state::AppState;
use serde_json::Value;
use std::fs;
use tauri::State;

#[derive(serde::Serialize)]
pub struct HistoryFileMeta {
    pub filename: String,
    pub size: u64,
    pub modified: String,
}

#[tauri::command]
pub fn list_history_files(state: State<'_, AppState>) -> Result<Vec<HistoryFileMeta>, String> {
    let dir = state.get_plugin_dir()?;
    let hist_dir = dir.join("chat-history");

    if !hist_dir.exists() {
        return Ok(vec![]);
    }

    let mut results = Vec::new();
    let entries = fs::read_dir(&hist_dir).map_err(|e| format!("Read dir error: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !["json", "log", "txt"].contains(&ext) {
            continue;
        }
        let filename = path.file_name().unwrap().to_string_lossy().to_string();
        let meta = fs::metadata(&path).map_err(|e| format!("Metadata error: {}", e))?;
        let modified = meta
            .modified()
            .map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .unwrap_or_default();

        results.push(HistoryFileMeta { filename, size: meta.len(), modified });
    }

    results.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(results)
}

#[tauri::command]
pub fn get_history_file(filename: String, state: State<'_, AppState>) -> Result<Value, String> {
    let dir = state.get_plugin_dir()?;
    let path = dir.join("chat-history").join(&filename);

    if !path.exists() {
        return Err(format!("File not found: {}", filename));
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Read error: {}", e))?;

    match serde_json::from_str::<Value>(&content) {
        Ok(val) => Ok(val),
        Err(_) => {
            let mut map = serde_json::Map::new();
            map.insert("raw".to_string(), Value::String(content));
            Ok(Value::Object(map))
        }
    }
}

#[derive(serde::Deserialize)]
pub struct SearchFilters {
    pub chat_type: Option<String>,
    pub model: Option<String>,
    pub errors_only: Option<bool>,
}

#[derive(serde::Serialize)]
pub struct SearchResult {
    pub filename: String,
    pub entries: Vec<Value>,
}

#[tauri::command]
pub fn search_all_history(
    query: String,
    filters: SearchFilters,
    state: State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    let dir = state.get_plugin_dir()?;
    let hist_dir = dir.join("chat-history");

    if !hist_dir.exists() {
        return Ok(vec![]);
    }

    let keywords: Vec<String> = query.split_whitespace().map(|s| s.to_lowercase()).collect();
    let mut results = Vec::new();
    let entries = fs::read_dir(&hist_dir).map_err(|e| format!("Read dir error: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let filename = path.file_name().unwrap().to_string_lossy().to_string();
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let arr: Vec<Value> = match serde_json::from_str(&content) {
            Ok(a) => a,
            Err(_) => continue,
        };

        let matched: Vec<Value> = arr
            .into_iter()
            .filter(|entry| {
                if let Some(ref ct) = filters.chat_type {
                    if let Some(t) = entry.get("type").and_then(|v| v.as_str()) {
                        if t != ct { return false; }
                    }
                }
                if let Some(ref m) = filters.model {
                    if let Some(model) = entry.get("modelName").and_then(|v| v.as_str()) {
                        if !model.contains(m.as_str()) { return false; }
                    }
                }
                if filters.errors_only == Some(true) {
                    let is_error = entry.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
                    if !is_error { return false; }
                }
                if keywords.is_empty() {
                    return true;
                }
                let text = format!(
                    "{} {} {}",
                    entry.get("prompt").and_then(|v| v.as_str()).unwrap_or(""),
                    entry.get("reply").and_then(|v| v.as_str()).unwrap_or(""),
                    entry.get("username").and_then(|v| v.as_str()).unwrap_or("")
                ).to_lowercase();
                keywords.iter().all(|kw| text.contains(kw))
            })
            .collect();

        if !matched.is_empty() {
            results.push(SearchResult { filename, entries: matched });
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn export_history(filename: String, format: String, state: State<'_, AppState>) -> Result<String, String> {
    let dir = state.get_plugin_dir()?;
    let path = dir.join("chat-history").join(&filename);
    let content = fs::read_to_string(&path).map_err(|e| format!("Read error: {}", e))?;

    match format.as_str() {
        "json" => Ok(content),
        "csv" => {
            let entries: Vec<Value> = serde_json::from_str(&content)
                .map_err(|e| format!("Parse error: {}", e))?;
            let mut csv = String::from("timestamp,type,username,userId,channelId,modelName,apiRemark,prompt,reply,isError,promptLength,replyLength,contextLength\n");
            for e in &entries {
                let get_str = |k: &str| -> String {
                    e.get(k).and_then(|v| v.as_str()).unwrap_or("").replace('"', "\"\"").to_string()
                };
                let get_num = |k: &str| -> String {
                    e.get(k).and_then(|v| v.as_u64()).map(|n| n.to_string()).unwrap_or_default()
                };
                csv.push_str(&format!(
                    "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",{},{},{},{}\n",
                    get_str("timestamp"), get_str("type"), get_str("username"),
                    get_str("userId"), get_str("channelId"), get_str("modelName"),
                    get_str("apiRemark"), get_str("prompt"), get_str("reply"),
                    e.get("isError").and_then(|v| v.as_bool()).unwrap_or(false),
                    get_num("promptLength"), get_num("replyLength"),
                    get_num("contextLength"),
                ));
            }
            Ok(csv)
        }
        _ => Err(format!("Unsupported format: {}", format)),
    }
}
