use crate::state::AppState;
use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use serde_json::Value;
use std::fs;
use tauri::State;

fn parse_timestamp_to_utc(input: &str) -> Option<DateTime<Utc>> {
    let s = input.trim();
    if s.is_empty() {
        return None;
    }

    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }

    for fmt in [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(s, fmt) {
            if let Some(local_dt) = Local.from_local_datetime(&naive).single() {
                return Some(local_dt.with_timezone(&Utc));
            }
            if let Some(local_dt) = Local.from_local_datetime(&naive).earliest() {
                return Some(local_dt.with_timezone(&Utc));
            }
            if let Some(local_dt) = Local.from_local_datetime(&naive).latest() {
                return Some(local_dt.with_timezone(&Utc));
            }
        }
    }

    None
}

fn categorize_error(reply: &str) -> String {
    let r = reply.to_lowercase();
    if r.contains("403") || r.contains("forbidden") || r.contains("access denied") {
        return "403 Forbidden".to_string();
    }
    if r.contains("429") || r.contains("rate limit") || r.contains("too many request") || r.contains("quota") {
        return "429 Rate Limit".to_string();
    }
    if r.contains("timeout") || r.contains("timed out") || r.contains("超时") || r.contains("etimedout") {
        return "Timeout".to_string();
    }
    if r.contains("500") || r.contains("internal server error") {
        return "500 Server Error".to_string();
    }
    if r.contains("502") || r.contains("bad gateway") {
        return "502 Bad Gateway".to_string();
    }
    if r.contains("503") || r.contains("service unavailable") || r.contains("overloaded") {
        return "503 Unavailable".to_string();
    }
    if r.contains("401") || r.contains("unauthorized") || r.contains("invalid") && r.contains("key") {
        return "401 Unauthorized".to_string();
    }
    if reply.trim().is_empty() {
        return "空回复".to_string();
    }
    if r.contains("content_filter") || r.contains("content filter") || r.contains("safety") {
        return "内容过滤".to_string();
    }
    if r.contains("context_length") || (r.contains("token") && r.contains("limit")) {
        return "Token超限".to_string();
    }
    "其他错误".to_string()
}

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
    pub models: Option<Vec<String>>,
    pub errors_only: Option<bool>,
    pub from_ts: Option<String>,
    pub to_ts: Option<String>,
    pub error_categories: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
pub struct SearchResult {
    pub filename: String,
    pub entries: Vec<Value>,
}

#[derive(serde::Serialize)]
pub struct ApiHistoryMetric {
    pub api_remark: String,
    pub model_name: String,
    pub total: u64,
    pub errors: u64,
    pub error_rate: f64,
    pub timeout_errors: u64,
    pub timeout_rate: f64,
    pub avg_response_time_ms: f64,
    pub jitter_ms: f64,
}

#[tauri::command]
pub fn get_api_history_metrics(state: State<'_, AppState>) -> Result<Vec<ApiHistoryMetric>, String> {
    let dir = state.get_plugin_dir()?;
    let hist_dir = dir.join("chat-history");

    if !hist_dir.exists() {
        return Ok(vec![]);
    }

    let mut by_key: std::collections::BTreeMap<(String, String), (u64, u64, u64, u64, Vec<f64>)> = std::collections::BTreeMap::new();
    let entries = fs::read_dir(&hist_dir).map_err(|e| format!("Read dir error: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let arr: Vec<Value> = match serde_json::from_str(&content) {
            Ok(a) => a,
            Err(_) => continue,
        };

        for item in arr {
            let api_remark = item
                .get("apiRemark")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let model_name = item
                .get("modelName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            if api_remark.is_empty() && model_name.is_empty() {
                continue;
            }

            let is_error = item.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
            let response_time = item.get("responseTime").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let reply_text = item.get("reply").and_then(|v| v.as_str()).unwrap_or("");
            let error_category = categorize_error(reply_text);
            let is_timeout = error_category == "Timeout";

            let k = (api_remark, model_name);
            let row = by_key.entry(k).or_insert((0, 0, 0, 0, Vec::new()));
            row.0 += 1;
            if is_error {
                row.1 += 1;
            }
            if is_timeout {
                row.2 += 1;
            }
            row.3 += response_time.max(0.0).round() as u64;
            if response_time > 0.0 {
                row.4.push(response_time);
            }
        }
    }

    let mut out = Vec::new();
    for ((api_remark, model_name), (total, errors, timeout_errors, response_sum, response_times)) in by_key {
        let error_rate = if total == 0 { 0.0 } else { errors as f64 / total as f64 };
        let timeout_rate = if total == 0 { 0.0 } else { timeout_errors as f64 / total as f64 };
        let avg_response_time_ms = if total == 0 { 0.0 } else { response_sum as f64 / total as f64 };
        let jitter_ms = if response_times.len() <= 1 {
            0.0
        } else {
            let mean = response_times.iter().sum::<f64>() / response_times.len() as f64;
            let variance = response_times
                .iter()
                .map(|v| {
                    let d = v - mean;
                    d * d
                })
                .sum::<f64>()
                / response_times.len() as f64;
            variance.sqrt()
        };
        out.push(ApiHistoryMetric {
            api_remark,
            model_name,
            total,
            errors,
            error_rate,
            timeout_errors,
            timeout_rate,
            avg_response_time_ms,
            jitter_ms,
        });
    }

    Ok(out)
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

    let from_dt = filters
        .from_ts
        .as_ref()
        .and_then(|s| parse_timestamp_to_utc(s));
    let to_dt = filters
        .to_ts
        .as_ref()
        .and_then(|s| parse_timestamp_to_utc(s));

    let models_normalized: Option<Vec<String>> = filters.models.as_ref().map(|models| {
        models
            .iter()
            .map(|m| m.trim().to_lowercase())
            .filter(|m| !m.is_empty())
            .collect::<Vec<_>>()
    });

    let error_categories_normalized: Option<Vec<String>> = filters.error_categories.as_ref().map(|cats| {
        cats
            .iter()
            .map(|c| c.trim().to_lowercase())
            .filter(|c| !c.is_empty())
            .collect::<Vec<_>>()
    });

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
                        if t != ct {
                            return false;
                        }
                    }
                }

                let model_name = entry
                    .get("modelName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_lowercase();

                if let Some(ref m) = filters.model {
                    let m_l = m.trim().to_lowercase();
                    if !m_l.is_empty() && model_name != m_l {
                        return false;
                    }
                }

                if let Some(ref models) = models_normalized {
                    if !models.is_empty() && !models.iter().any(|m| model_name == *m) {
                        return false;
                    }
                }

                let is_error = entry.get("isError").and_then(|v| v.as_bool()).unwrap_or(false);
                if filters.errors_only == Some(true) && !is_error {
                    return false;
                }

                if from_dt.is_some() || to_dt.is_some() {
                    let ts = entry
                        .get("timestamp")
                        .and_then(|v| v.as_str())
                        .and_then(parse_timestamp_to_utc);

                    if let Some(tsv) = ts {
                        if let Some(from) = from_dt {
                            if tsv < from {
                                return false;
                            }
                        }
                        if let Some(to) = to_dt {
                            if tsv > to {
                                return false;
                            }
                        }
                    } else {
                        return false;
                    }
                }

                if let Some(ref categories) = error_categories_normalized {
                    if !categories.is_empty() {
                        let reply = entry.get("reply").and_then(|v| v.as_str()).unwrap_or("");
                        let cat = categorize_error(reply).to_lowercase();
                        if !categories.iter().any(|c| c == &cat) {
                            return false;
                        }
                    }
                }

                if keywords.is_empty() {
                    return true;
                }

                let text = format!(
                    "{} {} {}",
                    entry.get("prompt").and_then(|v| v.as_str()).unwrap_or(""),
                    entry.get("reply").and_then(|v| v.as_str()).unwrap_or(""),
                    entry.get("username").and_then(|v| v.as_str()).unwrap_or("")
                )
                .to_lowercase();
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
pub fn import_history_file(filename: String, data: Value, state: State<'_, AppState>) -> Result<(), String> {
    let dir = state.get_plugin_dir()?;
    if filename.trim().is_empty() {
        return Err("Filename is empty".to_string());
    }
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename".to_string());
    }
    if !filename.ends_with(".json") {
        return Err("Only .json history files are supported for import".to_string());
    }
    if !data.is_array() {
        return Err("Imported history content must be a JSON array".to_string());
    }

    let path = dir.join("chat-history").join(&filename);
    let content = serde_json::to_string_pretty(&data).map_err(|e| format!("Serialize error: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Write error: {}", e))
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
            let mut csv = String::from("timestamp,type,username,userId,channelId,modelName,apiRemark,prompt,reply,isError,promptLength,replyLength,contextLength,responseTime\n");
            for e in &entries {
                let get_str = |k: &str| -> String {
                    e.get(k).and_then(|v| v.as_str()).unwrap_or("").replace('"', "\"\"").to_string()
                };
                let get_num = |k: &str| -> String {
                    e.get(k).and_then(|v| v.as_u64()).map(|n| n.to_string()).unwrap_or_default()
                };
                csv.push_str(&format!(
                    "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",{},{},{},{},{}\n",
                    get_str("timestamp"), get_str("type"), get_str("username"),
                    get_str("userId"), get_str("channelId"), get_str("modelName"),
                    get_str("apiRemark"), get_str("prompt"), get_str("reply"),
                    e.get("isError").and_then(|v| v.as_bool()).unwrap_or(false),
                    get_num("promptLength"), get_num("replyLength"),
                    get_num("contextLength"), get_num("responseTime"),
                ));
            }
            Ok(csv)
        }
        _ => Err(format!("Unsupported format: {}", format)),
    }
}
