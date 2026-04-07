use crate::data_root::{ensure_subdir, now_id, read_json_file};
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::task::JoinSet;

const MAX_API_COUNT: usize = 5;
const MAX_CANDIDATE_COUNT: usize = 6;
const MAX_CASE_COUNT: usize = 20;
const MAX_ROUNDS: u32 = 5;
const MAX_TOTAL_RUNS: usize = 320;

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

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityEvalCandidate {
    pub index: usize,
    pub remark: String,
    pub prompt: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityEvalCase {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub context_text: Option<String>,
    pub latest_user_message: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunPersonalityEvalExperimentRequest {
    pub mode: String,
    pub apis: Vec<ApiNodePayload>,
    pub api_params: ApiParamsPayload,
    pub candidates: Vec<PersonalityEvalCandidate>,
    pub cases: Vec<PersonalityEvalCase>,
    pub rounds: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityEvalApiNodeRecord {
    pub index: usize,
    pub remark: String,
    pub model_name: String,
    pub ai_type: String,
    pub url_redacted: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityEvalExecutionResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub http_status: u16,
    pub response_text: String,
    pub response_chars: usize,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityEvalRunKey {
    pub api_index: usize,
    pub candidate_index: usize,
    pub case_id: String,
    pub round: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityEvalHumanScore {
    pub dims: HashMap<String, u8>,
    pub note: String,
    pub scored_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityEvalRunRecord {
    pub key: PersonalityEvalRunKey,
    pub api_node: PersonalityEvalApiNodeRecord,
    pub candidate: PersonalityEvalCandidate,
    pub case_id: String,
    pub round: u32,
    pub result: PersonalityEvalExecutionResult,
    pub score: Option<PersonalityEvalHumanScore>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityEvalExperimentRecord {
    pub schema_version: u32,
    pub id: String,
    pub created_at: String,
    pub mode: String,
    pub api_params_snapshot: ApiParamsPayload,
    pub apis: Vec<PersonalityEvalApiNodeRecord>,
    pub candidates: Vec<PersonalityEvalCandidate>,
    pub cases: Vec<PersonalityEvalCase>,
    pub rounds: u32,
    pub runs: Vec<PersonalityEvalRunRecord>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersonalityEvalExperimentSummary {
    pub id: String,
    pub created_at: String,
    pub mode: String,
    pub total_runs: usize,
    pub scored_runs: usize,
    pub api_count: usize,
    pub candidate_count: usize,
    pub case_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalProgressEvent {
    pub session_id: String,
    pub done: usize,
    pub total: usize,
    pub ok: usize,
    pub failed: usize,
    pub last: Option<EvalProgressLast>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalProgressLast {
    pub api_label: String,
    pub candidate_label: String,
    pub case_name: String,
    pub round: u32,
    pub ok: bool,
    pub latency_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EvalDoneEvent {
    pub session_id: String,
    pub experiment_id: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SetPersonalityEvalScoreRequest {
    pub experiment_id: String,
    pub run_key: PersonalityEvalRunKey,
    pub score: PersonalityEvalHumanScore,
}

fn experiments_dir() -> Result<PathBuf, String> {
    ensure_subdir("personality-eval-lab/experiments")
}

fn experiment_path(id: &str) -> Result<PathBuf, String> {
    Ok(experiments_dir()?.join(format!("{}.json", id)))
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

fn resolve_ai_type(ai_type: &str, url: &str) -> String {
    let raw = ai_type.to_lowercase();
    if raw == "response" || raw == "responses" || raw == "openai-response" {
        return "responses".to_string();
    }

    if raw == "openai" && url.to_lowercase().contains("/responses") {
        return "responses".to_string();
    }

    raw
}

fn extract_text_blocks(blocks: &[Value]) -> String {
    blocks
        .iter()
        .filter_map(|block| {
            block
                .get("text")
                .and_then(|v| v.as_str())
                .or_else(|| block.get("output_text").and_then(|v| v.as_str()))
        })
        .map(|text| text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn extract_anthropic_text(body: &Value) -> String {
    body.get("content")
        .and_then(|v| v.as_array())
        .map(|blocks| extract_text_blocks(blocks))
        .filter(|text| !text.is_empty())
        .unwrap_or_default()
}

fn extract_responses_text(body: &Value) -> String {
    if let Some(text) = body.get("output_text").and_then(|v| v.as_str()) {
        let text = text.trim();
        if !text.is_empty() {
            return text.to_string();
        }
    }

    body.get("output")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .flat_map(|item| {
                    let mut texts = Vec::new();
                    if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            texts.push(trimmed.to_string());
                        }
                    }
                    if let Some(blocks) = item.get("content").and_then(|v| v.as_array()) {
                        let block_text = extract_text_blocks(blocks);
                        if !block_text.is_empty() {
                            texts.push(block_text);
                        }
                    }
                    texts
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn extract_gemini_text(body: &Value) -> String {
    body.get("candidates")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|x| x.get("content"))
        .and_then(|x| x.get("parts"))
        .and_then(|v| v.as_array())
        .map(|parts| extract_text_blocks(parts))
        .unwrap_or_default()
}

fn extract_openai_text(body: &Value) -> String {
    let content = body
        .get("choices")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|x| x.get("message"))
        .and_then(|x| x.get("content"));

    match content {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Array(blocks)) => extract_text_blocks(blocks),
        _ => String::new(),
    }
}

fn validate_scale(payload: &RunPersonalityEvalExperimentRequest) -> Result<(), String> {
    let api_count = payload.apis.len();
    let candidate_count = payload.candidates.len();
    let case_count = payload.cases.len();
    let rounds = payload.rounds;

    if api_count == 0 || candidate_count == 0 || case_count == 0 || rounds == 0 {
        return Err("评测实验参数不完整：API/人格/用例/轮次不能为空".to_string());
    }

    if api_count > MAX_API_COUNT {
        return Err(format!("实验规模超限：API 数量 {} > {}", api_count, MAX_API_COUNT));
    }
    if candidate_count > MAX_CANDIDATE_COUNT {
        return Err(format!("实验规模超限：人格数量 {} > {}", candidate_count, MAX_CANDIDATE_COUNT));
    }
    if case_count > MAX_CASE_COUNT {
        return Err(format!("实验规模超限：用例数量 {} > {}", case_count, MAX_CASE_COUNT));
    }
    if rounds > MAX_ROUNDS {
        return Err(format!("实验规模超限：轮次数 {} > {}", rounds, MAX_ROUNDS));
    }

    let total = api_count
        .saturating_mul(candidate_count)
        .saturating_mul(case_count)
        .saturating_mul(rounds as usize);
    if total > MAX_TOTAL_RUNS {
        return Err(format!("实验总任务数超限：{} > {}（请减少 API/人格/用例/轮次）", total, MAX_TOTAL_RUNS));
    }

    Ok(())
}

async fn execute_once(
    client: &Client,
    api_node: &ApiNodePayload,
    api_params: &ApiParamsPayload,
    prompt: &str,
    context_text: Option<&str>,
    latest_user_message: &str,
) -> PersonalityEvalExecutionResult {
    let ai_type = resolve_ai_type(&api_node.ai_type, &api_node.api_url);
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
        "responses" => {
            let mut input = Vec::new();
            if !context_text.is_empty() {
                input.push(json!({
                    "role": "user",
                    "content": [{ "type": "input_text", "text": context_text }]
                }));
            }
            input.push(json!({
                "role": "user",
                "content": [{ "type": "input_text", "text": latest_user_message }]
            }));

            (
                json!({
                    "model": api_node.model_name,
                    "instructions": prompt,
                    "input": input,
                    "temperature": temperature,
                    "max_output_tokens": api_params.max_tokens.unwrap_or(32000),
                    "store": false,
                }),
                vec![("Authorization".to_string(), format!("Bearer {}", api_node.api_key))],
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
                        "anthropic" => extract_anthropic_text(&body),
                        "responses" => extract_responses_text(&body),
                        "gemini" => extract_gemini_text(&body),
                        _ => extract_openai_text(&body),
                    };

                    let normalized = response_text
                        .replace("<think>", "")
                        .replace("</think>", "")
                        .trim()
                        .to_string();

                    PersonalityEvalExecutionResult {
                        ok,
                        latency_ms: latency,
                        http_status: status,
                        response_chars: normalized.chars().count(),
                        response_text: normalized,
                        error: if ok { None } else { Some(body.to_string()) },
                    }
                }
                Err(e) => PersonalityEvalExecutionResult {
                    ok: false,
                    latency_ms: latency,
                    http_status: status,
                    response_text: String::new(),
                    response_chars: 0,
                    error: Some(format!("Parse response failed: {}", e)),
                },
            }
        }
        Err(e) => PersonalityEvalExecutionResult {
            ok: false,
            latency_ms: started.elapsed().as_millis() as u64,
            http_status: 0,
            response_text: String::new(),
            response_chars: 0,
            error: Some(e.to_string()),
        },
    }
}

fn to_summary(record: &PersonalityEvalExperimentRecord) -> PersonalityEvalExperimentSummary {
    let total = record.runs.len();
    let scored = record.runs.iter().filter(|r| r.score.is_some()).count();
    PersonalityEvalExperimentSummary {
        id: record.id.clone(),
        created_at: record.created_at.clone(),
        mode: record.mode.clone(),
        total_runs: total,
        scored_runs: scored,
        api_count: record.apis.len(),
        candidate_count: record.candidates.len(),
        case_count: record.cases.len(),
    }
}

#[tauri::command]
pub async fn run_personality_eval_experiment_stream(
    session_id: String,
    payload: RunPersonalityEvalExperimentRequest,
    app: AppHandle,
) -> Result<(), String> {
    validate_scale(&payload)?;

    let app_handle = app.clone();
    tokio::spawn(async move {
        let experiment_id = now_id("eval");
        let mode = payload.mode.clone();
        let apis_payload = payload.apis.clone();
        let candidates_payload = payload.candidates.clone();
        let cases_payload = payload.cases.clone();
        let api_params_snapshot = payload.api_params.clone();
        let rounds = payload.rounds;

        let total = apis_payload.len()
            * candidates_payload.len()
            * cases_payload.len()
            * (rounds as usize);

        let client = match Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .danger_accept_invalid_certs(true)
            .build()
        {
            Ok(c) => c,
            Err(_) => {
                let _ = app_handle.emit_all(
                    "eval-done",
                    EvalDoneEvent { session_id, experiment_id: String::new() },
                );
                return;
            }
        };

        let apis: Vec<PersonalityEvalApiNodeRecord> = apis_payload
            .iter()
            .map(|n| PersonalityEvalApiNodeRecord {
                index: n.index,
                remark: n.remark.clone(),
                model_name: n.model_name.clone(),
                ai_type: n.ai_type.clone(),
                url_redacted: redact_url(&n.api_url),
            })
            .collect();

        let mut runs: Vec<PersonalityEvalRunRecord> = Vec::with_capacity(total);

        let concurrency = total.min(4).max(1);
        let mut join_set: JoinSet<(PersonalityEvalRunRecord, String, String)> = JoinSet::new();

        let mut done = 0usize;
        let mut ok_count = 0usize;
        let mut failed_count = 0usize;

        let mut queued = 0usize;
        let mut tasks: Vec<(usize, usize, usize, u32)> = Vec::with_capacity(total);
        for (api_i, _api) in apis_payload.iter().enumerate() {
            for (cand_i, _cand) in candidates_payload.iter().enumerate() {
                for (case_i, _case_item) in cases_payload.iter().enumerate() {
                    for round in 1..=rounds {
                        tasks.push((api_i, cand_i, case_i, round));
                    }
                }
            }
        }

        while queued < concurrency {
            let (api_i, cand_i, case_i, round) = tasks[queued];
            let client = client.clone();
            let api_node = apis_payload[api_i].clone();
            let cand = candidates_payload[cand_i].clone();
            let case = cases_payload[case_i].clone();
            let api_params = api_params_snapshot.clone();
            let api_label = format!("#{} {} / {}", api_node.index, api_node.remark, api_node.model_name);
            let candidate_label = format!("#{} {}", cand.index, cand.remark);

            join_set.spawn(async move {
                let context = case
                    .context_text
                    .as_deref()
                    .map(str::trim)
                    .filter(|x| !x.is_empty());
                let latest = case.latest_user_message.trim().to_string();

                let result = execute_once(
                    &client,
                    &api_node,
                    &api_params,
                    &cand.prompt,
                    context,
                    &latest,
                )
                .await;

                let run = PersonalityEvalRunRecord {
                    key: PersonalityEvalRunKey {
                        api_index: api_node.index,
                        candidate_index: cand.index,
                        case_id: case.id.clone(),
                        round,
                    },
                    api_node: PersonalityEvalApiNodeRecord {
                        index: api_node.index,
                        remark: api_node.remark.clone(),
                        model_name: api_node.model_name.clone(),
                        ai_type: api_node.ai_type.clone(),
                        url_redacted: redact_url(&api_node.api_url),
                    },
                    candidate: cand,
                    case_id: case.id,
                    round,
                    result,
                    score: None,
                };

                (run, api_label, candidate_label)
            });

            queued += 1;
        }

        while let Some(joined) = join_set.join_next().await {
            if let Ok((run, api_label, candidate_label)) = joined {
                done += 1;
                if run.result.ok {
                    ok_count += 1;
                } else {
                    failed_count += 1;
                }

                let case_name = cases_payload
                    .iter()
                    .find(|c| c.id == run.case_id)
                    .map(|c| c.name.clone())
                    .unwrap_or_else(|| preview(&run.case_id, 16));

                let last = EvalProgressLast {
                    api_label,
                    candidate_label,
                    case_name,
                    round: run.round,
                    ok: run.result.ok,
                    latency_ms: run.result.latency_ms,
                };

                runs.push(run);

                let _ = app_handle.emit_all(
                    "eval-progress",
                    EvalProgressEvent {
                        session_id: session_id.clone(),
                        done,
                        total,
                        ok: ok_count,
                        failed: failed_count,
                        last: Some(last),
                    },
                );

                if queued < tasks.len() {
                    let (api_i, cand_i, case_i, round) = tasks[queued];
                    let client = client.clone();
                    let api_node = apis_payload[api_i].clone();
                    let cand = candidates_payload[cand_i].clone();
                    let case = cases_payload[case_i].clone();
                    let api_params = api_params_snapshot.clone();
                    let api_label = format!("#{} {} / {}", api_node.index, api_node.remark, api_node.model_name);
                    let candidate_label = format!("#{} {}", cand.index, cand.remark);

                    join_set.spawn(async move {
                        let context = case
                            .context_text
                            .as_deref()
                            .map(str::trim)
                            .filter(|x| !x.is_empty());
                        let latest = case.latest_user_message.trim().to_string();

                        let result = execute_once(
                            &client,
                            &api_node,
                            &api_params,
                            &cand.prompt,
                            context,
                            &latest,
                        )
                        .await;

                        let run = PersonalityEvalRunRecord {
                            key: PersonalityEvalRunKey {
                                api_index: api_node.index,
                                candidate_index: cand.index,
                                case_id: case.id.clone(),
                                round,
                            },
                            api_node: PersonalityEvalApiNodeRecord {
                                index: api_node.index,
                                remark: api_node.remark.clone(),
                                model_name: api_node.model_name.clone(),
                                ai_type: api_node.ai_type.clone(),
                                url_redacted: redact_url(&api_node.api_url),
                            },
                            candidate: cand,
                            case_id: case.id,
                            round,
                            result,
                            score: None,
                        };

                        (run, api_label, candidate_label)
                    });

                    queued += 1;
                }
            }
        }

        runs.sort_by(|a, b| {
            (a.key.api_index, a.key.candidate_index, a.case_id.clone(), a.round)
                .cmp(&(b.key.api_index, b.key.candidate_index, b.case_id.clone(), b.round))
        });

        let record = PersonalityEvalExperimentRecord {
            schema_version: 1,
            id: experiment_id.clone(),
            created_at: Utc::now().to_rfc3339(),
            mode,
            api_params_snapshot,
            apis,
            candidates: candidates_payload,
            cases: cases_payload,
            rounds,
            runs,
        };

        if let Ok(path) = experiment_path(&record.id) {
            if let Ok(content) = serde_json::to_string_pretty(&record) {
                let _ = fs::write(path, content);
            }
        }

        let _ = app_handle.emit_all(
            "eval-done",
            EvalDoneEvent { session_id, experiment_id },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn list_personality_eval_experiments(limit: Option<usize>) -> Result<Vec<PersonalityEvalExperimentSummary>, String> {
    let dir = experiments_dir()?;
    let mut records: Vec<PersonalityEvalExperimentRecord> = Vec::new();

    for entry in fs::read_dir(dir).map_err(|e| format!("Read experiments dir failed: {}", e))?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        if let Ok(value) = read_json_file(&path) {
            if let Ok(record) = serde_json::from_value::<PersonalityEvalExperimentRecord>(value) {
                records.push(record);
            }
        }
    }

    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let max = limit.unwrap_or(20);
    Ok(records.into_iter().take(max).map(|x| to_summary(&x)).collect())
}

#[tauri::command]
pub fn get_personality_eval_experiment(id: String) -> Result<PersonalityEvalExperimentRecord, String> {
    let path = experiment_path(&id)?;
    let value = read_json_file(&path)?;
    serde_json::from_value(value).map_err(|e| format!("Parse experiment failed: {}", e))
}

#[tauri::command]
pub fn set_personality_eval_score(payload: SetPersonalityEvalScoreRequest) -> Result<(), String> {
    let path = experiment_path(&payload.experiment_id)?;
    if !path.exists() {
        return Err(format!("实验不存在: {}", payload.experiment_id));
    }

    let value = read_json_file(&path)?;
    let mut record: PersonalityEvalExperimentRecord = serde_json::from_value(value)
        .map_err(|e| format!("Parse experiment failed: {}", e))?;

    let mut found = false;
    for run in record.runs.iter_mut() {
        if run.key.api_index == payload.run_key.api_index
            && run.key.candidate_index == payload.run_key.candidate_index
            && run.key.case_id == payload.run_key.case_id
            && run.key.round == payload.run_key.round
        {
            run.score = Some(payload.score.clone());
            found = true;
            break;
        }
    }

    if !found {
        return Err("找不到要评分的运行记录".to_string());
    }

    let content = serde_json::to_string_pretty(&record).map_err(|e| format!("Serialize experiment failed: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Write experiment failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_personality_eval_experiment(id: String) -> Result<(), String> {
    let path = experiment_path(&id)?;
    if !path.exists() {
        return Err(format!("实验不存在: {}", id));
    }
    fs::remove_file(&path).map_err(|e| format!("删除实验失败: {}", e))?;
    Ok(())
}
