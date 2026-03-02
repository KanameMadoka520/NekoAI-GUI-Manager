use reqwest::Client;
use serde_json::{json, Value};
use std::time::Instant;

#[derive(serde::Serialize, Clone)]
pub struct PingResult {
    pub index: usize,
    pub pass: bool,
    pub latency_ms: u64,
    pub status: u16,
    pub error: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct ApiNode {
    pub index: usize,
    pub api_url: String,
    pub api_key: String,
    pub model_name: String,
    pub ai_type: String,
}

#[tauri::command]
pub async fn ping_api(
    url: String,
    key: String,
    model: String,
    ai_type: String,
) -> Result<PingResult, String> {
    do_ping(0, &url, &key, &model, &ai_type).await
}

#[tauri::command]
pub async fn batch_ping_apis(nodes: Vec<ApiNode>) -> Result<Vec<PingResult>, String> {
    let mut results = Vec::new();
    for node in &nodes {
        let result = do_ping(node.index, &node.api_url, &node.api_key, &node.model_name, &node.ai_type).await?;
        results.push(result);
    }
    Ok(results)
}

async fn do_ping(index: usize, url: &str, key: &str, model: &str, ai_type: &str) -> Result<PingResult, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Client build error: {}", e))?;

    let body: Value = match ai_type {
        "anthropic" => json!({
            "model": model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}]
        }),
        "gemini" => json!({
            "contents": [{"parts": [{"text": "hi"}]}],
            "generationConfig": {"maxOutputTokens": 1}
        }),
        _ => json!({
            "model": model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}]
        }),
    };

    let mut req = client.post(url).json(&body);

    match ai_type {
        "anthropic" => {
            req = req
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01");
        }
        "gemini" => {
            req = req.header("x-goog-api-key", key);
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
            let pass = matches!(status, 200 | 401 | 403 | 429);
            Ok(PingResult { index, pass, latency_ms: latency, status, error: None })
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
