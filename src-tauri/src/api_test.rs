use crate::ui_events::emit_ui_event;
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Instant;
use tauri::AppHandle;
use tokio::task::JoinSet;

#[derive(serde::Serialize, Clone)]
pub struct PingResult {
    pub index: usize,
    pub pass: bool,
    pub latency_ms: u64,
    pub status: u16,
    pub error: Option<String>,
}

#[derive(serde::Deserialize, Clone)]
pub struct ApiNode {
    pub index: usize,
    pub api_url: String,
    pub api_key: String,
    pub model_name: String,
    pub ai_type: String,
    #[serde(default)]
    pub xai_web_search_enabled: bool,
}

#[derive(serde::Serialize, Clone)]
struct BatchPingProgress {
    session_id: String,
    result: PingResult,
    done: usize,
    total: usize,
}

#[derive(serde::Serialize, Clone)]
struct BatchPingDone {
    session_id: String,
    results: Vec<PingResult>,
}

#[tauri::command]
pub async fn ping_api(
    url: String,
    key: String,
    model: String,
    ai_type: String,
    xai_web_search_enabled: Option<bool>,
) -> Result<PingResult, String> {
    do_ping(0, &url, &key, &model, &ai_type, xai_web_search_enabled.unwrap_or(false)).await
}

#[tauri::command]
pub async fn batch_ping_apis(nodes: Vec<ApiNode>) -> Result<Vec<PingResult>, String> {
    run_batch(nodes).await
}

#[tauri::command]
pub async fn batch_ping_apis_stream(
    session_id: String,
    nodes: Vec<ApiNode>,
    app: AppHandle,
) -> Result<(), String> {
    let app_handle = app.clone();
    tokio::spawn(async move {
        let total = nodes.len();
        if total == 0 {
            emit_ui_event(
                Some(&app_handle),
                "batch-ping-done",
                &BatchPingDone {
                    session_id,
                    results: Vec::new(),
                },
            );
            return;
        }

        let concurrency = total.min(6).max(1);
        let mut join_set = JoinSet::new();
        let mut queued = 0usize;
        let mut done = 0usize;
        let mut results: Vec<PingResult> = Vec::with_capacity(total);

        while queued < concurrency {
            let node = nodes[queued].clone();
            join_set.spawn(async move {
                let result = do_ping(node.index, &node.api_url, &node.api_key, &node.model_name, &node.ai_type, node.xai_web_search_enabled).await;
                (node.index, result)
            });
            queued += 1;
        }

        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok((_idx, Ok(result))) => {
                    done += 1;
                    results.push(result.clone());
                    emit_ui_event(
                        Some(&app_handle),
                        "batch-ping-progress",
                        &BatchPingProgress {
                            session_id: session_id.clone(),
                            result,
                            done,
                            total,
                        },
                    );
                }
                Ok((idx, Err(err))) => {
                    done += 1;
                    let result = PingResult {
                        index: idx,
                        pass: false,
                        latency_ms: 0,
                        status: 0,
                        error: Some(err),
                    };
                    results.push(result.clone());
                    emit_ui_event(
                        Some(&app_handle),
                        "batch-ping-progress",
                        &BatchPingProgress {
                            session_id: session_id.clone(),
                            result,
                            done,
                            total,
                        },
                    );
                }
                Err(err) => {
                    done += 1;
                    let result = PingResult {
                        index: 0,
                        pass: false,
                        latency_ms: 0,
                        status: 0,
                        error: Some(format!("task join error: {}", err)),
                    };
                    results.push(result.clone());
                    emit_ui_event(
                        Some(&app_handle),
                        "batch-ping-progress",
                        &BatchPingProgress {
                            session_id: session_id.clone(),
                            result,
                            done,
                            total,
                        },
                    );
                }
            }

            if queued < total {
                let node = nodes[queued].clone();
                join_set.spawn(async move {
                    let result = do_ping(node.index, &node.api_url, &node.api_key, &node.model_name, &node.ai_type, node.xai_web_search_enabled).await;
                    (node.index, result)
                });
                queued += 1;
            }
        }

        results.sort_by_key(|r| r.index);
        emit_ui_event(
            Some(&app_handle),
            "batch-ping-done",
            &BatchPingDone {
                session_id,
                results,
            },
        );
    });

    Ok(())
}

async fn run_batch(nodes: Vec<ApiNode>) -> Result<Vec<PingResult>, String> {
    let total = nodes.len();
    if total == 0 {
        return Ok(Vec::new());
    }

    let concurrency = total.min(6).max(1);
    let mut join_set = JoinSet::new();
    let mut queued = 0usize;
    let mut results: Vec<PingResult> = Vec::with_capacity(total);

    while queued < concurrency {
        let node = nodes[queued].clone();
        join_set.spawn(async move {
            let result = do_ping(node.index, &node.api_url, &node.api_key, &node.model_name, &node.ai_type, node.xai_web_search_enabled).await;
            (node.index, result)
        });
        queued += 1;
    }

    while let Some(joined) = join_set.join_next().await {
        match joined {
            Ok((_idx, Ok(result))) => results.push(result),
            Ok((idx, Err(err))) => results.push(PingResult {
                index: idx,
                pass: false,
                latency_ms: 0,
                status: 0,
                error: Some(err),
            }),
            Err(err) => results.push(PingResult {
                index: 0,
                pass: false,
                latency_ms: 0,
                status: 0,
                error: Some(format!("task join error: {}", err)),
            }),
        }

        if queued < total {
            let node = nodes[queued].clone();
            join_set.spawn(async move {
                let result = do_ping(node.index, &node.api_url, &node.api_key, &node.model_name, &node.ai_type, node.xai_web_search_enabled).await;
                (node.index, result)
            });
            queued += 1;
        }
    }

    results.sort_by_key(|r| r.index);
    Ok(results)
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

async fn do_ping(index: usize, url: &str, key: &str, model: &str, ai_type: &str, xai_web_search_enabled: bool) -> Result<PingResult, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Client build error: {}", e))?;

    let ai = resolve_ai_type(ai_type, url);
    let request_url = normalize_request_url(url, &ai, key);

    let body: Value = match ai.as_str() {
        "anthropic" => json!({
            "model": model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]
        }),
        "responses" => {
            let mut payload = json!({
                "model": model,
                "input": "hi",
                "max_output_tokens": 1,
                "store": false
            });
            if xai_web_search_enabled {
                payload["tools"] = json!([{ "type": "web_search" }]);
            }
            payload
        }
        "gemini" => json!({
            "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
            "generationConfig": {"maxOutputTokens": 1}
        }),
        _ => json!({
            "model": model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}]
        }),
    };

    let mut req = client.post(&request_url).json(&body);

    match ai.as_str() {
        "anthropic" => {
            req = req
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01");
        }
        "gemini" => {
            req = req
                .header("x-goog-api-key", key)
                .header("Authorization", format!("Bearer {}", key));
        }
        _ => {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }

    let start = Instant::now();
    match req.send().await {
        Ok(resp) => {
            let latency = start.elapsed().as_millis() as u64;
            let status = resp.status().as_u16();
            let is_xai_web_search_check = ai == "responses" && xai_web_search_enabled;
            let pass = if is_xai_web_search_check {
                matches!(status, 200 | 401 | 403 | 429)
            } else {
                matches!(status, 200 | 400 | 401 | 403 | 422 | 429)
            };
            let body = resp.text().await.unwrap_or_default();
            let compact_body = body.split_whitespace().collect::<Vec<_>>().join(" ");
            let error = if pass {
                None
            } else if compact_body.is_empty() {
                Some(format!("HTTP {}", status))
            } else {
                Some(compact_body.chars().take(300).collect())
            };
            Ok(PingResult { index, pass, latency_ms: latency, status, error })
        }
        Err(e) => {
            let latency = start.elapsed().as_millis() as u64;
            Ok(PingResult {
                index,
                pass: false,
                latency_ms: latency,
                status: 0,
                error: Some(e.to_string()),
            })
        }
    }
}
