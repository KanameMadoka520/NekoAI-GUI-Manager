use crate::data_root::{ensure_subdir, now_id, read_json_file};
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiNodePayload {
    pub index: usize,
    pub api_url: String,
    pub api_key: String,
    pub model_name: String,
    pub remark: String,
    pub ai_type: String,
}

#[derive(Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApiParamsPayload {
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    pub anthropic_max_tokens: Option<u32>,
    pub gemini_max_tokens: Option<u32>,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityAbCandidate {
    pub index: usize,
    pub remark: String,
    pub prompt: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityAbRunRequest {
    pub mode: String,
    pub api_node: ApiNodePayload,
    pub api_params: ApiParamsPayload,
    pub context_text: Option<String>,
    pub latest_user_message: String,
    pub candidate_a: PersonalityAbCandidate,
    pub candidate_b: PersonalityAbCandidate,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityAbExecutionResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub http_status: u16,
    pub response_text: String,
    pub response_chars: usize,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityAbApiNodeRecord {
    pub index: usize,
    pub remark: String,
    pub model_name: String,
    pub ai_type: String,
    pub url_redacted: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityAbRecord {
    pub schema_version: u32,
    pub id: String,
    pub created_at: String,
    pub mode: String,
    pub input: PersonalityAbInput,
    pub api_node: PersonalityAbApiNodeRecord,
    pub api_params_snapshot: ApiParamsPayload,
    pub candidate_a: PersonalityAbCandidate,
    pub candidate_b: PersonalityAbCandidate,
    pub result_a: PersonalityAbExecutionResult,
    pub result_b: PersonalityAbExecutionResult,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityAbInput {
    pub context_text: String,
    pub latest_user_message: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityAbTestSummary {
    pub id: String,
    pub created_at: String,
    pub mode: String,
    pub api_label: String,
    pub pair_label: String,
    pub latest_user_message_preview: String,
    pub a_ok: bool,
    pub b_ok: bool,
}

fn tests_dir() -> Result<PathBuf, String> {
    ensure_subdir("personality-ab-tests")
}

fn record_path(id: &str) -> Result<PathBuf, String> {
    Ok(tests_dir()?.join(format!("{}.json", id)))
}

fn redact_url(url: &str) -> String {
    if let Some((base, _)) = url.split_once("key=") {
        let trimmed = base.trim_end_matches('&').trim_end_matches('?');
        return format!("{}?key=***", trimmed);
    }
    url.to_string()
}

fn preview(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    let mut chars = trimmed.chars();
    let head: String = chars.by_ref().take(limit).collect();
    if chars.next().is_some() {
        format!("{}...", head)
    } else {
        head
    }
}

fn latest_message_content(payload: &PersonalityAbRunRequest) -> String {
    payload.latest_user_message.trim().to_string()
}

fn context_content(payload: &PersonalityAbRunRequest) -> Option<String> {
    payload
        .context_text
        .as_deref()
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_request_url(url: &str, ai_type: &str, key: &str) -> String {
    if ai_type == "gemini" && url.contains("generativelanguage.googleapis.com") && !url.contains("key=") {
        if url.contains('?') {
            format!("{}&key={}", url, key)
        } else {
            format!("{}?key={}", url, key)
        }
    } else {
        url.to_string()
    }
}

async fn execute_candidate(
    client: &Client,
    api_node: &ApiNodePayload,
    api_params: &ApiParamsPayload,
    prompt: &str,
    context_text: Option<&str>,
    latest_user_message: &str,
) -> PersonalityAbExecutionResult {
    let ai_type = api_node.ai_type.to_lowercase();
    let request_url = normalize_request_url(&api_node.api_url, &ai_type, &api_node.api_key);
    let temperature = api_params.temperature.unwrap_or(0.65);
    let context_text = context_text.unwrap_or("").trim();

    let (payload, headers): (Value, Vec<(String, String)>) = match ai_type.as_str() {
        "anthropic" => {
            let mut messages = Vec::new();
            if !context_text.is_empty() {
                messages.push(json!({
                    "role": "user",
                    "content": [{ "type": "text", "text": context_text }]
                }));
            }
            messages.push(json!({
                "role": "user",
                "content": [{ "type": "text", "text": latest_user_message }]
            }));

            (
                json!({
                    "model": api_node.model_name,
                    "system": prompt,
                    "messages": messages,
                    "max_tokens": api_params.anthropic_max_tokens.unwrap_or(4096),
                    "temperature": temperature,
                }),
                vec![
                    ("x-api-key".to_string(), api_node.api_key.clone()),
                    ("anthropic-version".to_string(), "2023-06-01".to_string()),
                ],
            )
        }
        "gemini" => {
            let mut contents = Vec::new();
            if !context_text.is_empty() {
                contents.push(json!({
                    "role": "user",
                    "parts": [{ "text": context_text }]
                }));
            }
            contents.push(json!({
                "role": "user",
                "parts": [{ "text": latest_user_message }]
            }));

            (
                json!({
                    "contents": contents,
                    "systemInstruction": { "parts": [{ "text": prompt }] },
                    "generationConfig": {
                        "temperature": temperature,
                        "maxOutputTokens": api_params.gemini_max_tokens.unwrap_or(8192),
                    }
                }),
                vec![
                    ("x-goog-api-key".to_string(), api_node.api_key.clone()),
                    ("Authorization".to_string(), format!("Bearer {}", api_node.api_key)),
                ],
            )
        }
        _ => {
            let mut messages = vec![json!({ "role": "system", "content": prompt })];
            if !context_text.is_empty() {
                messages.push(json!({ "role": "user", "content": context_text }));
            }
            messages.push(json!({ "role": "user", "content": latest_user_message }));

            (
                json!({
                    "model": api_node.model_name,
                    "messages": messages,
                    "stream": false,
                    "temperature": temperature,
                    "max_tokens": api_params.max_tokens.unwrap_or(32000),
                }),
                vec![("Authorization".to_string(), format!("Bearer {}", api_node.api_key))],
            )
        }
    };

    let mut request = client
        .post(&request_url)
        .header("Content-Type", "application/json")
        .header("User-Agent", "NekoAI-GUI-Manager/1.0")
        .json(&payload);

    for (k, v) in headers {
        request = request.header(k, v);
    }

    let started = std::time::Instant::now();
    match request.send().await {
        Ok(resp) => {
            let latency = started.elapsed().as_millis() as u64;
            let status = resp.status().as_u16();
            let ok = resp.status().is_success();
            match resp.json::<Value>().await {
                Ok(body) => {
                    let response_text = match ai_type.as_str() {
                        "anthropic" => body
                            .get("content")
                            .and_then(|v| v.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|x| x.get("text"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        "gemini" => body
                            .get("candidates")
                            .and_then(|v| v.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|x| x.get("content"))
                            .and_then(|x| x.get("parts"))
                            .and_then(|v| v.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|x| x.get("text"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        _ => body
                            .get("choices")
                            .and_then(|v| v.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|x| x.get("message"))
                            .and_then(|x| x.get("content"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    };

                    let normalized = response_text.replace("<think>", "").replace("</think>", "").trim().to_string();
                    PersonalityAbExecutionResult {
                        ok,
                        latency_ms: latency,
                        http_status: status,
                        response_chars: normalized.chars().count(),
                        response_text: normalized,
                        error: if ok { None } else { Some(body.to_string()) },
                    }
                }
                Err(e) => PersonalityAbExecutionResult {
                    ok: false,
                    latency_ms: latency,
                    http_status: status,
                    response_text: String::new(),
                    response_chars: 0,
                    error: Some(format!("Parse response failed: {}", e)),
                },
            }
        }
        Err(e) => PersonalityAbExecutionResult {
            ok: false,
            latency_ms: started.elapsed().as_millis() as u64,
            http_status: 0,
            response_text: String::new(),
            response_chars: 0,
            error: Some(e.to_string()),
        },
    }
}

fn to_summary(record: &PersonalityAbRecord) -> PersonalityAbTestSummary {
    PersonalityAbTestSummary {
        id: record.id.clone(),
        created_at: record.created_at.clone(),
        mode: record.mode.clone(),
        api_label: format!("#{} {} / {}", record.api_node.index, record.api_node.remark, record.api_node.model_name),
        pair_label: format!("{} vs {}", record.candidate_a.remark, record.candidate_b.remark),
        latest_user_message_preview: preview(&record.input.latest_user_message, 32),
        a_ok: record.result_a.ok,
        b_ok: record.result_b.ok,
    }
}

#[tauri::command]
pub async fn run_personality_ab_test(payload: PersonalityAbRunRequest) -> Result<PersonalityAbRecord, String> {
    let latest_user_message = latest_message_content(&payload);
    if latest_user_message.is_empty() {
        return Err("最新用户消息不能为空".to_string());
    }
    if payload.api_node.api_url.trim().is_empty() || payload.api_node.api_key.trim().is_empty() || payload.api_node.model_name.trim().is_empty() {
        return Err("所选 API 节点信息不完整".to_string());
    }

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Failed to build http client: {}", e))?;

    let context = context_content(&payload);
    let result_a = execute_candidate(
        &client,
        &payload.api_node,
        &payload.api_params,
        &payload.candidate_a.prompt,
        context.as_deref(),
        &latest_user_message,
    ).await;

    let result_b = execute_candidate(
        &client,
        &payload.api_node,
        &payload.api_params,
        &payload.candidate_b.prompt,
        context.as_deref(),
        &latest_user_message,
    ).await;

    let record = PersonalityAbRecord {
        schema_version: 1,
        id: now_id("abtest"),
        created_at: Utc::now().to_rfc3339(),
        mode: payload.mode.clone(),
        input: PersonalityAbInput {
            context_text: context.unwrap_or_default(),
            latest_user_message,
        },
        api_node: PersonalityAbApiNodeRecord {
            index: payload.api_node.index,
            remark: payload.api_node.remark.clone(),
            model_name: payload.api_node.model_name.clone(),
            ai_type: payload.api_node.ai_type.clone(),
            url_redacted: redact_url(&payload.api_node.api_url),
        },
        api_params_snapshot: payload.api_params.clone(),
        candidate_a: payload.candidate_a.clone(),
        candidate_b: payload.candidate_b.clone(),
        result_a,
        result_b,
    };

    let path = record_path(&record.id)?;
    let content = serde_json::to_string_pretty(&record).map_err(|e| format!("Serialize record failed: {}", e))?;
    fs::write(path, content).map_err(|e| format!("Write record failed: {}", e))?;
    Ok(record)
}

#[tauri::command]
pub fn list_personality_ab_tests(limit: Option<usize>) -> Result<Vec<PersonalityAbTestSummary>, String> {
    let dir = tests_dir()?;
    let mut records: Vec<PersonalityAbRecord> = Vec::new();

    for entry in fs::read_dir(dir).map_err(|e| format!("Read tests dir failed: {}", e))?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        if let Ok(value) = read_json_file(&path) {
            if let Ok(record) = serde_json::from_value::<PersonalityAbRecord>(value) {
                records.push(record);
            }
        }
    }

    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let max = limit.unwrap_or(20);
    Ok(records.into_iter().take(max).map(|x| to_summary(&x)).collect())
}

#[tauri::command]
pub fn get_personality_ab_test(id: String) -> Result<PersonalityAbRecord, String> {
    let path = record_path(&id)?;
    let value = read_json_file(&path)?;
    serde_json::from_value(value).map_err(|e| format!("Parse record failed: {}", e))
}

#[tauri::command]
pub fn delete_personality_ab_test(id: String) -> Result<(), String> {
    let path = record_path(&id)?;
    if !path.exists() {
        return Err(format!("测试记录不存在: {}", id));
    }
    fs::remove_file(&path).map_err(|e| format!("删除测试记录失败: {}", e))?;
    Ok(())
}
