use crate::data_root::ensure_subdir;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::State;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ApiHealthWeights {
    pub live_weight: u32,
    pub history_weight: u32,
    pub timeout_weight: u32,
    pub jitter_weight: u32,
}

fn default_api_health_weights() -> ApiHealthWeights {
    ApiHealthWeights {
        live_weight: 60,
        history_weight: 0,
        timeout_weight: 20,
        jitter_weight: 20,
    }
}

fn prefs_dir() -> Result<PathBuf, String> {
    ensure_subdir("preferences")
}

fn api_health_weights_path() -> Result<PathBuf, String> {
    Ok(prefs_dir()?.join("api-health-weights.json"))
}

fn normalize_weights(input: ApiHealthWeights) -> ApiHealthWeights {
    let live = input.live_weight.min(100);
    let timeout = input.timeout_weight.min(100);
    let jitter = input.jitter_weight.min(100);
    let history = 100u32.saturating_sub(live.saturating_add(timeout).saturating_add(jitter));

    ApiHealthWeights {
        live_weight: live,
        history_weight: history,
        timeout_weight: timeout,
        jitter_weight: jitter,
    }
}

fn read_runtime_weights(plugin_dir: &std::path::Path) -> Result<Option<ApiHealthWeights>, String> {
    let path = plugin_dir.join("runtime_config.json");
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read runtime_config.json: {}", e))?;
    let data: Value = serde_json::from_str(&content).map_err(|e| format!("Failed to parse runtime_config.json: {}", e))?;
    let Some(obj) = data.get("apiHealthWeights").and_then(|v| v.as_object()) else {
        return Ok(None);
    };

    let live = obj.get("liveWeight").and_then(|v| v.as_u64()).unwrap_or(60) as u32;
    let history = obj.get("historyWeight").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let timeout = obj.get("timeoutWeight").and_then(|v| v.as_u64()).unwrap_or(20) as u32;
    let jitter = obj.get("jitterWeight").and_then(|v| v.as_u64()).unwrap_or(20) as u32;

    Ok(Some(normalize_weights(ApiHealthWeights {
        live_weight: live,
        history_weight: history,
        timeout_weight: timeout,
        jitter_weight: jitter,
    })))
}

fn write_api_health_weights_file(weights: &ApiHealthWeights) -> Result<(), String> {
    let path = api_health_weights_path()?;
    let content = serde_json::to_string_pretty(weights).map_err(|e| format!("Failed to serialize api health weights: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

#[tauri::command]
pub fn get_api_health_weights(state: State<'_, AppState>) -> Result<ApiHealthWeights, String> {
    let path = api_health_weights_path()?;
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
        let parsed: ApiHealthWeights = serde_json::from_str(&content).map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;
        return Ok(normalize_weights(parsed));
    }

    if let Ok(plugin_dir) = state.get_plugin_dir() {
        if let Some(migrated) = read_runtime_weights(&plugin_dir)? {
            write_api_health_weights_file(&migrated)?;
            return Ok(migrated);
        }
    }

    let defaults = default_api_health_weights();
    write_api_health_weights_file(&defaults)?;
    Ok(defaults)
}

#[tauri::command]
pub fn save_api_health_weights(weights: ApiHealthWeights) -> Result<(), String> {
    let normalized = normalize_weights(weights);
    write_api_health_weights_file(&normalized)?;
    Ok(())
}
