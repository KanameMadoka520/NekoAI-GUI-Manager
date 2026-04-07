use crate::data_root::{ensure_subdir, now_id, read_json_file};
use crate::state::AppState;
use chrono::{Local, Utc};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::State;

const SNAPSHOT_KEYS: [&str; 7] = [
    "runtime_config.json",
    "runtime_schema.json",
    "api_config.json",
    "image_api_config.json",
    "group_personality.json",
    "private_personality.json",
    "commands.json",
];

fn plugin_file(path_root: &Path, filename: &str) -> PathBuf {
    path_root.join(filename)
}

fn read_file_if_exists(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    read_json_file(path).map(Some)
}

fn write_json(path: &Path, data: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(data).map_err(|e| format!("Serialize failed: {}", e))?;
    fs::write(path, content).map_err(|e| format!("Write {} failed: {}", path.display(), e))
}

fn default_fixable_file_content(filename: &str) -> Option<Value> {
    match filename {
        // 图像节点配置缺失时，安全地补一个空数组即可。
        // 这样不会伪造示例 key，也能让 activeImageApiIndex 的自检/修复回到正常状态。
        "image_api_config.json" => Some(json!([])),
        _ => None,
    }
}

fn snapshot_manifest_path(snapshot_dir: &Path) -> PathBuf {
    snapshot_dir.join("manifest.json")
}

fn ensure_snapshot_of_plugin(plugin_dir: &Path, reason: &str, operator: Option<String>) -> Result<String, String> {
    let snapshots_dir = ensure_subdir("snapshots")?;
    let snapshot_id = now_id("snapshot");
    let snapshot_dir = snapshots_dir.join(&snapshot_id);
    fs::create_dir_all(&snapshot_dir).map_err(|e| format!("Create snapshot dir failed: {}", e))?;

    let mut included: Vec<String> = Vec::new();

    for filename in SNAPSHOT_KEYS {
        let src = plugin_file(plugin_dir, filename);
        if src.exists() {
            let dst = snapshot_dir.join(filename);
            fs::copy(&src, &dst).map_err(|e| format!("Copy {} failed: {}", filename, e))?;
            included.push(filename.to_string());
        }
    }

    let manifest = json!({
        "snapshot_id": snapshot_id,
        "created_at": Utc::now().to_rfc3339(),
        "created_at_local": Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        "reason": reason,
        "operator": operator.unwrap_or_else(|| "unknown".to_string()),
        "files": included,
    });

    write_json(&snapshot_manifest_path(&snapshot_dir), &manifest)?;
    Ok(snapshot_id)
}

pub fn auto_snapshot_on_save(plugin_dir: &Path, key: &str) -> Result<String, String> {
    ensure_snapshot_of_plugin(plugin_dir, &format!("auto-save:{}", key), Some("gui".to_string()))
}

pub fn append_audit_log(action: &str, target: &str, status: &str, detail: Option<Value>) -> Result<(), String> {
    let audit_dir = ensure_subdir("audit")?;
    let filename = format!("audit-{}.jsonl", Local::now().format("%Y-%m"));
    let path = audit_dir.join(filename);

    let line = json!({
        "ts": Utc::now().to_rfc3339(),
        "ts_local": Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        "action": action,
        "target": target,
        "status": status,
        "detail": detail.unwrap_or(Value::Null),
    });

    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Open audit log failed: {}", e))?;

    let s = serde_json::to_string(&line).map_err(|e| format!("Serialize audit line failed: {}", e))?;
    writeln!(f, "{}", s).map_err(|e| format!("Write audit log failed: {}", e))?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct SnapshotMeta {
    pub snapshot_id: String,
    pub created_at: String,
    pub reason: String,
    pub operator: String,
    pub files: Vec<String>,
}

#[derive(serde::Serialize)]
pub struct SnapshotDiff {
    pub left: String,
    pub right: String,
    pub changed_files: Vec<String>,
    pub changed_keys_by_file: BTreeMap<String, Vec<String>>,
}

fn collect_top_level_diff_keys(a: &Value, b: &Value) -> Vec<String> {
    match (a.as_object(), b.as_object()) {
        (Some(oa), Some(ob)) => {
            let mut keys = BTreeSet::new();
            for k in oa.keys() {
                keys.insert(k.clone());
            }
            for k in ob.keys() {
                keys.insert(k.clone());
            }
            keys.into_iter().filter(|k| oa.get(k) != ob.get(k)).collect()
        }
        _ => {
            if a == b {
                Vec::new()
            } else {
                vec!["$root".to_string()]
            }
        }
    }
}

fn read_snapshot_manifest(snapshot_id: &str) -> Result<Value, String> {
    let snapshots_dir = ensure_subdir("snapshots")?;
    let manifest_path = snapshots_dir.join(snapshot_id).join("manifest.json");
    read_json_file(&manifest_path)
}

#[tauri::command]
pub fn list_snapshots() -> Result<Vec<SnapshotMeta>, String> {
    let snapshots_dir = ensure_subdir("snapshots")?;
    let mut out: Vec<SnapshotMeta> = Vec::new();

    let entries = fs::read_dir(&snapshots_dir).map_err(|e| format!("Read snapshots dir failed: {}", e))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        let m = read_json_file(&manifest_path)?;
        out.push(SnapshotMeta {
            snapshot_id: m.get("snapshot_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            created_at: m.get("created_at").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            reason: m.get("reason").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            operator: m.get("operator").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
            files: m
                .get("files")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default(),
        });
    }

    out.sort_by(|a, b| b.snapshot_id.cmp(&a.snapshot_id));
    Ok(out)
}

#[tauri::command]
pub fn create_snapshot(reason: Option<String>, operator: Option<String>, state: State<'_, AppState>) -> Result<String, String> {
    let plugin_dir = state.get_plugin_dir()?;
    let id = ensure_snapshot_of_plugin(
        &plugin_dir,
        reason.as_deref().unwrap_or("manual"),
        Some(operator.unwrap_or_else(|| "gui".to_string())),
    )?;
    let _ = append_audit_log("snapshot.create", &id, "ok", None);
    Ok(id)
}

#[tauri::command]
pub fn rollback_snapshot(snapshot_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let plugin_dir = state.get_plugin_dir()?;
    let snapshots_dir = ensure_subdir("snapshots")?;
    let snapshot_dir = snapshots_dir.join(&snapshot_id);
    if !snapshot_dir.exists() {
        return Err(format!("Snapshot not found: {}", snapshot_id));
    }

    for filename in SNAPSHOT_KEYS {
        let src = snapshot_dir.join(filename);
        if src.exists() {
            let dst = plugin_file(&plugin_dir, filename);
            fs::copy(&src, &dst).map_err(|e| format!("Restore {} failed: {}", filename, e))?;
        }
    }

    let _ = append_audit_log("snapshot.rollback", &snapshot_id, "ok", None);
    Ok(())
}

#[tauri::command]
pub fn diff_snapshots(left_snapshot_id: String, right_snapshot_id: String) -> Result<SnapshotDiff, String> {
    let snapshots_dir = ensure_subdir("snapshots")?;
    let left_dir = snapshots_dir.join(&left_snapshot_id);
    let right_dir = snapshots_dir.join(&right_snapshot_id);

    if !left_dir.exists() || !right_dir.exists() {
        return Err("Snapshot not found".to_string());
    }

    let mut changed_files: Vec<String> = Vec::new();
    let mut changed_keys_by_file: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for filename in SNAPSHOT_KEYS {
        let l = read_file_if_exists(&left_dir.join(filename))?;
        let r = read_file_if_exists(&right_dir.join(filename))?;
        if l != r {
            changed_files.push(filename.to_string());
            let keys = match (l, r) {
                (Some(a), Some(b)) => collect_top_level_diff_keys(&a, &b),
                _ => vec!["$file_presence".to_string()],
            };
            changed_keys_by_file.insert(filename.to_string(), keys);
        }
    }

    Ok(SnapshotDiff {
        left: left_snapshot_id,
        right: right_snapshot_id,
        changed_files,
        changed_keys_by_file,
    })
}

#[derive(serde::Serialize)]
pub struct DeployPackageResult {
    pub package_name: String,
    pub package_path: String,
}

#[tauri::command]
pub fn export_deploy_package(name: Option<String>, state: State<'_, AppState>) -> Result<DeployPackageResult, String> {
    let plugin_dir = state.get_plugin_dir()?;
    let deploy_dir = ensure_subdir("deploy-packages")?;

    let package_name = name.unwrap_or_else(|| format!("deploy-{}", Local::now().format("%Y%m%d-%H%M%S")));
    let package_path = deploy_dir.join(&package_name);
    fs::create_dir_all(&package_path).map_err(|e| format!("Create package dir failed: {}", e))?;

    let mut files_included: Vec<String> = Vec::new();

    for filename in SNAPSHOT_KEYS {
        let src = plugin_file(&plugin_dir, filename);
        if src.exists() {
            let dst = package_path.join(filename);
            fs::copy(&src, &dst).map_err(|e| format!("Copy {} failed: {}", filename, e))?;
            files_included.push(filename.to_string());
        }
    }

    let manifest = json!({
        "package_name": package_name,
        "created_at": Utc::now().to_rfc3339(),
        "plugin_dir": plugin_dir.to_string_lossy().to_string(),
        "files": files_included,
        "format": "directory",
    });
    write_json(&package_path.join("manifest.json"), &manifest)?;

    let _ = append_audit_log("deploy.export", &package_name, "ok", Some(manifest));

    Ok(DeployPackageResult {
        package_name,
        package_path: package_path.to_string_lossy().to_string(),
    })
}

fn env_template_path(env: &str) -> Result<PathBuf, String> {
    let allowed = ["dev", "test", "prod"];
    if !allowed.contains(&env) {
        return Err(format!("Unsupported env: {}", env));
    }
    Ok(ensure_subdir("env-templates")?.join(format!("{}.json", env)))
}

fn collect_current_bundle(plugin_dir: &Path) -> Result<Value, String> {
    let mut obj = serde_json::Map::new();
    for filename in SNAPSHOT_KEYS {
        if let Some(v) = read_file_if_exists(&plugin_file(plugin_dir, filename))? {
            obj.insert(filename.to_string(), v);
        }
    }
    Ok(Value::Object(obj))
}

#[tauri::command]
pub fn save_current_as_env_template(env: String, state: State<'_, AppState>) -> Result<(), String> {
    let plugin_dir = state.get_plugin_dir()?;
    let current = collect_current_bundle(&plugin_dir)?;
    let data = json!({
        "env": env,
        "updated_at": Utc::now().to_rfc3339(),
        "bundle": current,
    });
    let path = env_template_path(data.get("env").and_then(|v| v.as_str()).unwrap_or(""))?;
    write_json(&path, &data)?;
    let _ = append_audit_log("env.save", &path.to_string_lossy(), "ok", None);
    Ok(())
}

#[tauri::command]
pub fn preview_env_template(env: String, state: State<'_, AppState>) -> Result<Value, String> {
    let plugin_dir = state.get_plugin_dir()?;
    let path = env_template_path(&env)?;
    if !path.exists() {
        return Err(format!("Template not found for env: {}", env));
    }

    let tpl = read_json_file(&path)?;
    let bundle = tpl.get("bundle").and_then(|v| v.as_object()).ok_or_else(|| "Invalid template bundle".to_string())?;

    let current = collect_current_bundle(&plugin_dir)?;
    let current_obj = current.as_object().cloned().unwrap_or_default();

    let mut changed = Vec::new();
    for filename in SNAPSHOT_KEYS {
        let a = current_obj.get(filename);
        let b = bundle.get(filename);
        if a != b {
            changed.push(filename.to_string());
        }
    }

    Ok(json!({
        "env": env,
        "template_path": path.to_string_lossy().to_string(),
        "changed_files": changed,
    }))
}

#[tauri::command]
pub fn apply_env_template(env: String, state: State<'_, AppState>) -> Result<(), String> {
    let plugin_dir = state.get_plugin_dir()?;
    let path = env_template_path(&env)?;
    if !path.exists() {
        return Err(format!("Template not found for env: {}", env));
    }

    let tpl = read_json_file(&path)?;
    let bundle = tpl.get("bundle").and_then(|v| v.as_object()).ok_or_else(|| "Invalid template bundle".to_string())?;

    for filename in SNAPSHOT_KEYS {
        if let Some(v) = bundle.get(filename) {
            write_json(&plugin_file(&plugin_dir, filename), v)?;
        }
    }

    let _ = ensure_snapshot_of_plugin(&plugin_dir, &format!("apply-env:{}", env), Some("gui".to_string()));
    let _ = append_audit_log("env.apply", &env, "ok", None);
    Ok(())
}

#[derive(serde::Serialize)]
pub struct SelfCheckItem {
    pub code: String,
    pub level: String,
    pub message: String,
    pub fixable: bool,
}

#[derive(serde::Serialize)]
pub struct SelfCheckReport {
    pub ok: bool,
    pub plugin_dir: String,
    pub generated_at: String,
    pub items: Vec<SelfCheckItem>,
    pub report_path: String,
}

fn push_item(items: &mut Vec<SelfCheckItem>, code: &str, level: &str, message: String, fixable: bool) {
    items.push(SelfCheckItem {
        code: code.to_string(),
        level: level.to_string(),
        message,
        fixable,
    });
}

fn collect_unknown_runtime_paths(runtime: &Value, schema: &Value) -> Vec<String> {
    let mut unknown = BTreeSet::new();

    let Some(runtime_obj) = runtime.as_object() else {
        return vec!["$root".to_string()];
    };
    let Some(schema_obj) = schema.as_object() else {
        return Vec::new();
    };

    let exact_paths: BTreeSet<String> = schema_obj
        .get("fields")
        .and_then(|v| v.as_object())
        .map(|fields| fields.keys().cloned().collect())
        .unwrap_or_default();

    let wildcard_roots: BTreeSet<String> = schema_obj
        .get("allowAdditionalPaths")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .filter(|path| path.ends_with(".*"))
                .map(|path| path.trim_end_matches(".*").to_string())
                .collect()
        })
        .unwrap_or_default();

    for (key, value) in runtime_obj {
        if key == "_comments" {
            continue;
        }

        if exact_paths.contains(key) {
            continue;
        }

        let nested_known: Vec<&String> = exact_paths.iter().filter(|path| path.starts_with(&format!("{}.", key))).collect();
        if !nested_known.is_empty() && value.is_object() {
            if let Some(nested_obj) = value.as_object() {
                for nested_key in nested_obj.keys() {
                    let nested_path = format!("{}.{}", key, nested_key);
                    if exact_paths.contains(&nested_path) || wildcard_roots.contains(key) {
                        continue;
                    }
                    unknown.insert(nested_path);
                }
            }
            continue;
        }

        unknown.insert(key.to_string());
    }

    unknown.into_iter().collect()
}

fn collect_deprecated_runtime_paths(runtime: &Value, schema: &Value) -> Vec<String> {
    let Some(runtime_obj) = runtime.as_object() else {
        return Vec::new();
    };
    let Some(schema_obj) = schema.as_object() else {
        return Vec::new();
    };
    let Some(deprecated_obj) = schema_obj.get("deprecatedFields").and_then(|v| v.as_object()) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for (path, info) in deprecated_obj {
        let parts: Vec<&str> = path.split('.').collect();
        let mut current = Some(runtime_obj as &serde_json::Map<String, Value>);
        let mut value: Option<&Value> = None;

        for (index, part) in parts.iter().enumerate() {
            let Some(obj) = current else {
                value = None;
                break;
            };
            let next = obj.get(*part);
            if index == parts.len() - 1 {
                value = next;
            } else {
                current = next.and_then(|v| v.as_object());
            }
        }

        if value.is_none() {
            continue;
        }

        let replaced_by = info.get("replacedBy").and_then(|v| v.as_str()).unwrap_or("");
        let note = info.get("note").and_then(|v| v.as_str()).unwrap_or("");

        let mut message = path.to_string();
        if !replaced_by.is_empty() {
            message.push_str(&format!(" -> {}", replaced_by));
        }
        if !note.is_empty() {
            message.push_str(&format!(" ({})", note));
        }
        out.push(message);
    }

    out.sort();
    out
}

#[tauri::command]
pub fn run_startup_self_check(state: State<'_, AppState>) -> Result<SelfCheckReport, String> {
    let plugin_dir = state.get_plugin_dir()?;
    let mut items: Vec<SelfCheckItem> = Vec::new();

    for filename in SNAPSHOT_KEYS {
        let p = plugin_file(&plugin_dir, filename);
        if !p.exists() {
            push_item(
                &mut items,
                "file.missing",
                "error",
                format!("缺失文件: {}", filename),
                default_fixable_file_content(filename).is_some(),
            );
            continue;
        }

        match read_json_file(&p) {
            Ok(_) => {}
            Err(e) => {
                push_item(
                    &mut items,
                    "json.invalid",
                    "error",
                    format!("JSON 解析失败 {}: {}", filename, e),
                    false,
                );
            }
        }
    }

    let runtime_path = plugin_file(&plugin_dir, "runtime_config.json");
    if runtime_path.exists() {
        if let Ok(rt) = read_json_file(&runtime_path) {
            let active_api = rt.get("activeApiIndex").and_then(|v| v.as_i64());
            let active_image_api = rt.get("activeImageApiIndex").and_then(|v| v.as_i64());
            let active_gp = rt.get("activeGroupPersonalityIndex").and_then(|v| v.as_i64());
            let active_pp = rt.get("activePrivatePersonalityIndex").and_then(|v| v.as_i64());

            let api_len = read_file_if_exists(&plugin_file(&plugin_dir, "api_config.json"))?
                .and_then(|v| v.as_array().map(|a| a.len() as i64))
                .unwrap_or(0);
            let image_api_len = read_file_if_exists(&plugin_file(&plugin_dir, "image_api_config.json"))?
                .and_then(|v| v.as_array().map(|a| a.len() as i64))
                .unwrap_or(0);
            let gp_len = read_file_if_exists(&plugin_file(&plugin_dir, "group_personality.json"))?
                .and_then(|v| v.as_array().map(|a| a.len() as i64))
                .unwrap_or(0);
            let pp_len = read_file_if_exists(&plugin_file(&plugin_dir, "private_personality.json"))?
                .and_then(|v| v.as_array().map(|a| a.len() as i64))
                .unwrap_or(0);

            if let Some(i) = active_api {
                if i < 0 || i >= api_len.max(1) {
                    push_item(&mut items, "index.activeApiIndex", "warn", format!("activeApiIndex 越界: {}", i), true);
                }
            } else {
                push_item(&mut items, "type.activeApiIndex", "error", "activeApiIndex 类型错误或缺失".to_string(), true);
            }

            if let Some(i) = active_image_api {
                if i < 0 || i >= image_api_len.max(1) {
                    push_item(&mut items, "index.activeImageApiIndex", "warn", format!("activeImageApiIndex 越界: {}", i), true);
                }
            } else {
                push_item(&mut items, "type.activeImageApiIndex", "error", "activeImageApiIndex 类型错误或缺失".to_string(), true);
            }

            if let Some(i) = active_gp {
                if i < 0 || i >= gp_len.max(1) {
                    push_item(&mut items, "index.activeGroupPersonalityIndex", "warn", format!("activeGroupPersonalityIndex 越界: {}", i), true);
                }
            } else {
                push_item(&mut items, "type.activeGroupPersonalityIndex", "error", "activeGroupPersonalityIndex 类型错误或缺失".to_string(), true);
            }

            if let Some(i) = active_pp {
                if i < 0 || i >= pp_len.max(1) {
                    push_item(&mut items, "index.activePrivatePersonalityIndex", "warn", format!("activePrivatePersonalityIndex 越界: {}", i), true);
                }
            } else {
                push_item(&mut items, "type.activePrivatePersonalityIndex", "error", "activePrivatePersonalityIndex 类型错误或缺失".to_string(), true);
            }

            let schema_path = plugin_file(&plugin_dir, "runtime_schema.json");
            if schema_path.exists() {
                if let Ok(schema) = read_json_file(&schema_path) {
                    let unknown_paths = collect_unknown_runtime_paths(&rt, &schema);
                    if !unknown_paths.is_empty() {
                        push_item(
                            &mut items,
                            "schema.unknown-fields",
                            "warn",
                            format!(
                                "runtime_config.json 存在 {} 个未在 runtime_schema.json 中声明的字段: {}",
                                unknown_paths.len(),
                                unknown_paths.iter().take(6).cloned().collect::<Vec<_>>().join(", ")
                            ),
                            false,
                        );
                    }

                    let deprecated_paths = collect_deprecated_runtime_paths(&rt, &schema);
                    if !deprecated_paths.is_empty() {
                        push_item(
                            &mut items,
                            "schema.deprecated-fields",
                            "warn",
                            format!(
                                "runtime_config.json 存在 {} 个已废弃字段: {}",
                                deprecated_paths.len(),
                                deprecated_paths.iter().take(4).cloned().collect::<Vec<_>>().join(", ")
                            ),
                            false,
                        );
                    }
                }
            }
        }
    }

    let ok = !items.iter().any(|x| x.level == "error");

    let diagnostics_dir = ensure_subdir("diagnostics")?;
    let report_name = format!("self-check-{}.json", Local::now().format("%Y%m%d-%H%M%S"));
    let report_path = diagnostics_dir.join(report_name);

    let report_json = json!({
        "ok": ok,
        "plugin_dir": plugin_dir.to_string_lossy().to_string(),
        "generated_at": Utc::now().to_rfc3339(),
        "items": items,
    });
    write_json(&report_path, &report_json)?;

    let _ = append_audit_log(
        "self-check.run",
        "startup",
        if ok { "ok" } else { "warn" },
        Some(json!({ "report_path": report_path.to_string_lossy().to_string() })),
    );

    Ok(SelfCheckReport {
        ok,
        plugin_dir: plugin_dir.to_string_lossy().to_string(),
        generated_at: Utc::now().to_rfc3339(),
        items,
        report_path: report_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn apply_self_check_fixes(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let plugin_dir = state.get_plugin_dir()?;
    let runtime_path = plugin_file(&plugin_dir, "runtime_config.json");
    if !runtime_path.exists() {
        return Ok(vec!["runtime_config.json 不存在，跳过修复".to_string()]);
    }

    let mut changed: Vec<String> = Vec::new();

    for filename in SNAPSHOT_KEYS {
        let path = plugin_file(&plugin_dir, filename);
        if path.exists() {
            continue;
        }
        if let Some(default_content) = default_fixable_file_content(filename) {
            write_json(&path, &default_content)?;
            changed.push(format!("创建缺失文件: {}", filename));
        }
    }

    let mut rt = read_json_file(&runtime_path)?;

    let api_len = read_file_if_exists(&plugin_file(&plugin_dir, "api_config.json"))?
        .and_then(|v| v.as_array().map(|a| a.len() as i64))
        .unwrap_or(0);
    let image_api_len = read_file_if_exists(&plugin_file(&plugin_dir, "image_api_config.json"))?
        .and_then(|v| v.as_array().map(|a| a.len() as i64))
        .unwrap_or(0);
    let gp_len = read_file_if_exists(&plugin_file(&plugin_dir, "group_personality.json"))?
        .and_then(|v| v.as_array().map(|a| a.len() as i64))
        .unwrap_or(0);
    let pp_len = read_file_if_exists(&plugin_file(&plugin_dir, "private_personality.json"))?
        .and_then(|v| v.as_array().map(|a| a.len() as i64))
        .unwrap_or(0);

    let clamp = |v: i64, len: i64| -> i64 {
        if len <= 0 { 0 } else { v.max(0).min(len - 1) }
    };

    if let Some(obj) = rt.as_object_mut() {
        let api_raw = obj.get("activeApiIndex").and_then(|v| v.as_i64());
        let api_old = api_raw.unwrap_or(0);
        let api_new = clamp(api_old, api_len);
        if api_raw.is_none() || api_old != api_new {
            obj.insert("activeApiIndex".to_string(), json!(api_new));
            changed.push(format!("activeApiIndex: {} -> {}", api_old, api_new));
        }

        let image_api_raw = obj.get("activeImageApiIndex").and_then(|v| v.as_i64());
        let image_api_old = image_api_raw.unwrap_or(0);
        let image_api_new = clamp(image_api_old, image_api_len);
        if image_api_raw.is_none() || image_api_old != image_api_new {
            obj.insert("activeImageApiIndex".to_string(), json!(image_api_new));
            changed.push(format!("activeImageApiIndex: {} -> {}", image_api_old, image_api_new));
        }

        let gp_raw = obj
            .get("activeGroupPersonalityIndex")
            .and_then(|v| v.as_i64());
        let gp_old = gp_raw.unwrap_or(0);
        let gp_new = clamp(gp_old, gp_len);
        if gp_raw.is_none() || gp_old != gp_new {
            obj.insert("activeGroupPersonalityIndex".to_string(), json!(gp_new));
            changed.push(format!("activeGroupPersonalityIndex: {} -> {}", gp_old, gp_new));
        }

        let pp_raw = obj
            .get("activePrivatePersonalityIndex")
            .and_then(|v| v.as_i64());
        let pp_old = pp_raw.unwrap_or(0);
        let pp_new = clamp(pp_old, pp_len);
        if pp_raw.is_none() || pp_old != pp_new {
            obj.insert("activePrivatePersonalityIndex".to_string(), json!(pp_new));
            changed.push(format!("activePrivatePersonalityIndex: {} -> {}", pp_old, pp_new));
        }
    }

    if !changed.is_empty() {
        write_json(&runtime_path, &rt)?;
        let _ = append_audit_log(
            "self-check.fix",
            "runtime_config.json",
            "ok",
            Some(json!({ "changes": changed })),
        );
    }

    Ok(changed)
}

#[tauri::command]
pub fn list_audit_logs(limit: Option<usize>) -> Result<Vec<Value>, String> {
    let audit_dir = ensure_subdir("audit")?;
    let mut files: Vec<PathBuf> = fs::read_dir(&audit_dir)
        .map_err(|e| format!("Read audit dir failed: {}", e))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("jsonl"))
        .collect();

    files.sort();
    files.reverse();

    let mut rows: Vec<Value> = Vec::new();
    for file in files {
        let content = fs::read_to_string(&file).map_err(|e| format!("Read audit file failed: {}", e))?;
        for line in content.lines() {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                rows.push(v);
            }
        }
    }

    let lim = limit.unwrap_or(200);
    if rows.len() > lim {
        rows.truncate(lim);
    }

    Ok(rows)
}
