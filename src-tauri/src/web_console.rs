use crate::api_test;
use crate::config;
use crate::data_root::ensure_subdir;
use crate::gui_prefs::{self, ApiHealthWeights};
use crate::history;
use crate::memory;
use crate::ops;
use crate::personality_ab;
use crate::personality_eval;
use crate::state::{AppState, WebConsoleRuntime, WebConsoleSession};
use crate::ui_events::subscribe_ui_events;
use async_stream::stream;
use axum::extract::{ConnectInfo, Path as AxumPath, Query, State as AxumState};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Json};
use axum::routing::{get, post};
use axum::Router;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::convert::Infallible;
use std::fs;
use std::net::{IpAddr, SocketAddr, TcpListener as StdTcpListener};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower_http::services::{ServeDir, ServeFile};

const DEFAULT_WEB_CONSOLE_HOST: &str = "127.0.0.1";
const LOCAL_BROWSER_HOST: &str = "127.0.0.1";
const DEFAULT_WEB_CONSOLE_PORT: u16 = 32191;
const DEFAULT_WEB_CONSOLE_SESSION_TTL_MINUTES: u32 = 720;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebConsoleSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_web_console_host")]
    pub host: String,
    #[serde(default = "default_web_console_port")]
    pub port: u16,
    #[serde(default)]
    pub allow_remote_access: bool,
    #[serde(default)]
    pub auth_enabled: bool,
    #[serde(default)]
    pub allow_read_only_login: bool,
    #[serde(default)]
    pub force_read_only: bool,
    #[serde(default)]
    pub allowed_remote_addrs: Vec<String>,
    #[serde(default = "default_web_console_session_ttl_minutes")]
    pub session_ttl_minutes: u32,
    #[serde(default)]
    pub password_hash: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebConsoleStatus {
    pub enabled: bool,
    pub running: bool,
    pub host: String,
    pub port: u16,
    pub url: String,
    pub plugin_dir: Option<String>,
    pub allow_remote_access: bool,
    pub auth_enabled: bool,
    pub has_password: bool,
    pub allow_read_only_login: bool,
    pub force_read_only: bool,
    pub allowed_remote_addrs: Vec<String>,
    pub session_ttl_minutes: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebConsoleSessionStatus {
    auth_enabled: bool,
    has_password: bool,
    authenticated: bool,
    read_only: bool,
    allow_read_only_login: bool,
    force_read_only: bool,
    expires_at: Option<String>,
    session_ttl_minutes: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebConsoleLoginResult {
    token: String,
    read_only: bool,
    expires_at: String,
    session_ttl_minutes: u32,
}

#[derive(Clone)]
struct WebConsoleContext {
    app: AppHandle,
}

fn default_web_console_host() -> String {
    DEFAULT_WEB_CONSOLE_HOST.to_string()
}

fn default_web_console_port() -> u16 {
    DEFAULT_WEB_CONSOLE_PORT
}

fn default_web_console_session_ttl_minutes() -> u32 {
    DEFAULT_WEB_CONSOLE_SESSION_TTL_MINUTES
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetPluginDirParams {
    dir: String,
}

#[derive(Deserialize)]
struct OpenPathParams {
    path: String,
}

#[derive(Deserialize)]
struct GetConfigParams {
    key: String,
}

#[derive(Deserialize)]
struct SaveConfigParams {
    key: String,
    data: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveApiHealthWeightsParams {
    weights: ApiHealthWeights,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryTypeParams {
    mem_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryItemParams {
    mem_type: String,
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveMemoryParams {
    mem_type: String,
    id: String,
    data: Value,
}

#[derive(Deserialize)]
struct HistoryFileParams {
    filename: String,
}

#[derive(Deserialize)]
struct SearchHistoryParams {
    query: String,
    filters: history::SearchFilters,
}

#[derive(Deserialize)]
struct ExportHistoryParams {
    filename: String,
    format: String,
}

#[derive(Deserialize)]
struct ImportHistoryParams {
    filename: String,
    data: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PingApiParams {
    url: String,
    key: String,
    model: String,
    ai_type: String,
    xai_web_search_enabled: Option<bool>,
}

#[derive(Deserialize)]
struct BatchPingParams {
    nodes: Vec<api_test::ApiNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchPingStreamParams {
    session_id: String,
    nodes: Vec<api_test::ApiNode>,
}

#[derive(Deserialize)]
struct PersonalityAbRunParams {
    payload: personality_ab::PersonalityAbRunRequest,
}

#[derive(Deserialize)]
struct LimitParams {
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct IdParams {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersonalityEvalRunParams {
    session_id: String,
    payload: personality_eval::RunPersonalityEvalExperimentRequest,
}

#[derive(Deserialize)]
struct PersonalityEvalScoreParams {
    payload: personality_eval::SetPersonalityEvalScoreRequest,
}

#[derive(Deserialize)]
struct CreateSnapshotParams {
    reason: Option<String>,
    operator: Option<String>,
}

#[derive(Deserialize)]
struct RollbackSnapshotParams {
    snapshot_id: String,
}

#[derive(Deserialize)]
struct DiffSnapshotsParams {
    left_snapshot_id: String,
    right_snapshot_id: String,
}

#[derive(Deserialize)]
struct ExportDeployPackageParams {
    name: Option<String>,
}

#[derive(Deserialize)]
struct EnvParams {
    env: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SessionQueryParams {
    token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebConsoleLoginParams {
    password: String,
    read_only: Option<bool>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WebConsoleLogoutParams {
    token: Option<String>,
}

fn default_web_console_settings() -> WebConsoleSettings {
    WebConsoleSettings {
        enabled: false,
        host: default_web_console_host(),
        port: DEFAULT_WEB_CONSOLE_PORT,
        allow_remote_access: false,
        auth_enabled: false,
        allow_read_only_login: true,
        force_read_only: false,
        allowed_remote_addrs: Vec::new(),
        session_ttl_minutes: DEFAULT_WEB_CONSOLE_SESSION_TTL_MINUTES,
        password_hash: String::new(),
    }
}

fn settings_dir() -> Result<PathBuf, String> {
    ensure_subdir("preferences")
}

fn web_console_settings_path() -> Result<PathBuf, String> {
    Ok(settings_dir()?.join("web-console.json"))
}

fn normalize_port(port: u16) -> u16 {
    if port < 1024 {
        DEFAULT_WEB_CONSOLE_PORT
    } else {
        port
    }
}

fn normalize_host(host: String) -> String {
    let trimmed = host.trim();
    if trimmed.is_empty() {
        return DEFAULT_WEB_CONSOLE_HOST.to_string();
    }
    trimmed.to_string()
}

fn normalize_allowed_remote_addrs(list: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for item in list {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value = trimmed.to_string();
        if !out.contains(&value) {
            out.push(value);
        }
    }
    out
}

fn normalize_session_ttl_minutes(value: u32) -> u32 {
    value.clamp(10, 60 * 24 * 14)
}

fn format_http_host(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') && !host.ends_with(']') {
        format!("[{}]", host)
    } else {
        host.to_string()
    }
}

fn browser_access_host(host: &str) -> String {
    let normalized = host.trim();
    if normalized == "0.0.0.0" {
        return LOCAL_BROWSER_HOST.to_string();
    }
    if normalized.is_empty() {
        return DEFAULT_WEB_CONSOLE_HOST.to_string();
    }
    normalized.to_string()
}

fn build_browser_url(host: &str, port: u16) -> String {
    format!("http://{}:{}/", format_http_host(&browser_access_host(host)), port)
}

fn is_local_only_host(host: &str) -> bool {
    let normalized = host.trim().to_ascii_lowercase();
    matches!(normalized.as_str(), "" | "127.0.0.1" | "localhost" | "::1" | "[::1]")
}

fn normalize_settings(settings: WebConsoleSettings) -> WebConsoleSettings {
    let force_read_only = settings.force_read_only;
    WebConsoleSettings {
        enabled: settings.enabled,
        host: normalize_host(settings.host),
        port: normalize_port(settings.port),
        allow_remote_access: settings.allow_remote_access,
        auth_enabled: settings.auth_enabled,
        allow_read_only_login: force_read_only || settings.allow_read_only_login,
        force_read_only,
        allowed_remote_addrs: normalize_allowed_remote_addrs(settings.allowed_remote_addrs),
        session_ttl_minutes: normalize_session_ttl_minutes(settings.session_ttl_minutes),
        password_hash: settings.password_hash.trim().to_string(),
    }
}

fn sha256_hex(input: &str) -> String {
    let digest = Sha256::digest(input.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

fn has_password(settings: &WebConsoleSettings) -> bool {
    !settings.password_hash.trim().is_empty()
}

fn issue_session_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        token.push_str(&format!("{:02x}", byte));
    }
    token
}

fn session_expiry_epoch(settings: &WebConsoleSettings) -> i64 {
    chrono::Utc::now().timestamp() + i64::from(settings.session_ttl_minutes) * 60
}

fn epoch_to_iso(epoch: i64) -> Option<String> {
    chrono::NaiveDateTime::from_timestamp_opt(epoch, 0)
        .map(|naive| chrono::DateTime::<chrono::Utc>::from_utc(naive, chrono::Utc).to_rfc3339())
}

fn load_web_console_settings() -> Result<WebConsoleSettings, String> {
    let path = web_console_settings_path()?;
    if !path.exists() {
        let defaults = default_web_console_settings();
        write_web_console_settings(&defaults)?;
        return Ok(defaults);
    }

    let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let parsed: WebConsoleSettings = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;
    let normalized = normalize_settings(parsed);
    write_web_console_settings(&normalized)?;
    Ok(normalized)
}

fn write_web_console_settings(settings: &WebConsoleSettings) -> Result<(), String> {
    let path = web_console_settings_path()?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize web console settings: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn append_web_console_log(message: &str) {
    let Ok(path) = web_console_settings_path() else {
        return;
    };
    let log_path = path.with_file_name("web-console.log");
    let line = format!("[{}] {}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), message);
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
}

fn current_status(state: &AppState, settings: &WebConsoleSettings) -> Result<WebConsoleStatus, String> {
    let running_binding = state.get_web_console_binding()?;
    let running = running_binding.is_some();
    let plugin_dir = state
        .get_plugin_dir_optional()?
        .map(|path| path.to_string_lossy().to_string());
    let (host, port) = running_binding
        .unwrap_or_else(|| (settings.host.clone(), settings.port));
    let url = build_browser_url(&host, port);

    Ok(WebConsoleStatus {
        enabled: settings.enabled,
        running,
        host,
        port,
        url,
        plugin_dir,
        allow_remote_access: settings.allow_remote_access,
        auth_enabled: settings.auth_enabled,
        has_password: has_password(settings),
        allow_read_only_login: settings.allow_read_only_login,
        force_read_only: settings.force_read_only,
        allowed_remote_addrs: settings.allowed_remote_addrs.clone(),
        session_ttl_minutes: settings.session_ttl_minutes,
    })
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get("authorization")?.to_str().ok()?.trim();
    let lower = raw.to_ascii_lowercase();
    if !lower.starts_with("bearer ") {
        return None;
    }
    let token = raw[7..].trim();
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

fn resolve_session_token(headers: &HeaderMap, query_token: Option<&str>) -> Option<String> {
    extract_bearer_token(headers).or_else(|| query_token.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()))
}

fn ip_matches_rule(ip: &IpAddr, rule: &str) -> bool {
    let value = ip.to_string();
    let trimmed = rule.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed == "*" {
        return true;
    }
    if let Some(prefix) = trimmed.strip_suffix('*') {
        return value.starts_with(prefix);
    }
    value == trimmed
}

fn ensure_remote_peer_allowed(peer: IpAddr, settings: &WebConsoleSettings) -> Result<(), (StatusCode, Json<Value>)> {
    if peer.is_loopback() {
        return Ok(());
    }
    if settings.allowed_remote_addrs.is_empty() {
        return Ok(());
    }
    if settings.allowed_remote_addrs.iter().any(|rule| ip_matches_rule(&peer, rule)) {
        return Ok(());
    }
    Err(http_err(
        StatusCode::FORBIDDEN,
        format!("当前来源地址 {} 不在允许列表里，已拒绝访问本地 Web 服务。", peer),
    ))
}

fn build_session_status(settings: &WebConsoleSettings, session: Option<&WebConsoleSession>) -> WebConsoleSessionStatus {
    WebConsoleSessionStatus {
        auth_enabled: settings.auth_enabled,
        has_password: has_password(settings),
        authenticated: session.is_some(),
        read_only: session.map(|item| item.read_only).unwrap_or(false),
        allow_read_only_login: settings.allow_read_only_login,
        force_read_only: settings.force_read_only,
        expires_at: session.and_then(|item| epoch_to_iso(item.expires_at_epoch)),
        session_ttl_minutes: settings.session_ttl_minutes,
    }
}

fn command_allows_read_only(command: &str) -> bool {
    matches!(
        command,
        "get_config"
            | "get_system_info"
            | "get_manager_context"
            | "get_api_health_weights"
            | "list_memory"
            | "get_memory"
            | "list_history_files"
            | "get_history_file"
            | "search_all_history"
            | "get_api_history_metrics"
            | "list_personality_ab_tests"
            | "get_personality_ab_test"
            | "list_personality_eval_experiments"
            | "get_personality_eval_experiment"
            | "list_snapshots"
            | "diff_snapshots"
            | "list_audit_logs"
            | "get_web_console_status"
    )
}

fn authorize_browser_session(
    state: &AppState,
    settings: &WebConsoleSettings,
    token: Option<String>,
    command: Option<&str>,
) -> Result<Option<WebConsoleSession>, (StatusCode, Json<Value>)> {
    let now_epoch = chrono::Utc::now().timestamp();
    state
        .cleanup_expired_web_console_sessions(now_epoch)
        .map_err(|e| http_err(StatusCode::INTERNAL_SERVER_ERROR, e))?;

    if !settings.auth_enabled {
        return Ok(None);
    }

    let token = token.ok_or_else(|| http_err(StatusCode::UNAUTHORIZED, "当前浏览器会话尚未登录，请先输入访问口令。"))?;
    let session = state
        .get_web_console_session(&token)
        .map_err(|e| http_err(StatusCode::INTERNAL_SERVER_ERROR, e))?
        .ok_or_else(|| http_err(StatusCode::UNAUTHORIZED, "当前浏览器会话已失效，请重新登录。"))?;

    if session.expires_at_epoch <= now_epoch {
        let _ = state.revoke_web_console_session(&token);
        return Err(http_err(StatusCode::UNAUTHORIZED, "当前浏览器会话已过期，请重新登录。"));
    }

    if session.read_only {
        if let Some(name) = command {
            if !command_allows_read_only(name) {
                return Err(http_err(StatusCode::FORBIDDEN, format!("当前浏览器会话是只读模式，不允许执行 {}。", name)));
            }
        }
    }

    Ok(Some(session))
}

fn resolve_frontend_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dev_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    if dev_dir.join("index.html").exists() {
        return Ok(dev_dir);
    }

    let resolver = app.path_resolver();

    if let Some(index_path) = resolver.resolve_resource("dist/index.html") {
        if index_path.exists() {
            return index_path
                .parent()
                .map(PathBuf::from)
                .ok_or_else(|| "Failed to resolve web console dist directory".to_string());
        }
    }

    if let Some(dist_dir) = resolver.resolve_resource("dist") {
        if dist_dir.join("index.html").exists() {
            return Ok(dist_dir);
        }
    }

    Err("未找到浏览器控制台前端资源 dist/index.html，请重新执行构建".to_string())
}

fn stop_web_console_runtime(state: &AppState) -> Result<(), String> {
    if let Some(runtime) = state.take_web_console_runtime()? {
        let _ = runtime.shutdown.send(());
    }
    Ok(())
}

fn start_web_console_runtime(app: AppHandle, host: String, port: u16) -> Result<(), String> {
    let normalized_host = normalize_host(host);
    let current_binding = {
        let state = app.state::<AppState>();
        state.get_web_console_binding()?
    };

    if current_binding.as_ref() == Some(&(normalized_host.clone(), port)) {
        return Ok(());
    }

    let frontend_dir = resolve_frontend_dir(&app)?;
    let std_listener = StdTcpListener::bind((normalized_host.as_str(), port))
        .map_err(|e| format!("本地 Web 控制台启动失败，地址 {}:{} 可能不可用或已被占用：{}", normalized_host, port, e))?;
    std_listener
        .set_nonblocking(true)
        .map_err(|e| format!("本地 Web 控制台启动失败，无法设置 nonblocking：{}", e))?;

    {
        let state = app.state::<AppState>();
        stop_web_console_runtime(state.inner())?;
    }

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let state_for_exit = app.clone();
    let app_for_thread = app.clone();
    let host_for_thread = normalized_host.clone();
    let host_for_async = normalized_host.clone();
    let host_for_exit_cleanup = normalized_host.clone();

    let spawn_result = thread::Builder::new()
        .name("neko-web-console".to_string())
        .spawn(move || {
            append_web_console_log(&format!("服务线程启动，地址={}:{}, 本机访问={}", host_for_thread, port, build_browser_url(&host_for_thread, port)));

            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(err) => {
                    append_web_console_log(&format!("创建 Tokio runtime 失败: {}", err));
                    let state = state_for_exit.state::<AppState>();
                    let _ = state.clear_web_console_runtime_if_binding(&host_for_exit_cleanup, port);
                    return;
                }
            };

            let state_for_async = state_for_exit.clone();
            runtime.block_on(async move {
                let listener = match TcpListener::from_std(std_listener) {
                    Ok(listener) => listener,
                    Err(err) => {
                        append_web_console_log(&format!("切换 Tokio listener 失败: {}", err));
                        let state = state_for_async.state::<AppState>();
                        let _ = state.clear_web_console_runtime_if_binding(&host_for_async, port);
                        return;
                    }
                };

                let context = WebConsoleContext { app: app_for_thread.clone() };
                let index_file = frontend_dir.join("index.html");
                let static_service = ServeDir::new(frontend_dir).not_found_service(ServeFile::new(index_file));
                let router = Router::new()
                    .route("/api/session/status", get(handle_session_status))
                    .route("/api/session/login", post(handle_session_login))
                    .route("/api/session/logout", post(handle_session_logout))
                    .route("/api/invoke/:command", post(handle_invoke))
                    .route("/events", get(handle_events))
                    .with_state(context)
                    .fallback_service(static_service);

                let server = axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                });

                if let Err(err) = server.await {
                    append_web_console_log(&format!("服务运行出错: {}", err));
                } else {
                    append_web_console_log("服务线程正常退出");
                }
            });

            let state = state_for_exit.state::<AppState>();
            let _ = state.clear_web_console_runtime_if_binding(&host_for_exit_cleanup, port);
        });

    if let Err(err) = spawn_result {
        return Err(format!("本地 Web 控制台启动失败，无法创建服务线程: {}", err));
    }

    {
        let state = app.state::<AppState>();
        state.set_web_console_runtime(WebConsoleRuntime {
            host: normalized_host.clone(),
            port,
            shutdown: shutdown_tx,
        })?;
    }

    append_web_console_log(&format!("服务已登记为运行中，地址={}:{}, 本机访问={}", normalized_host, port, build_browser_url(&normalized_host, port)));

    Ok(())
}

fn current_status_from_app(app: &AppHandle, settings: &WebConsoleSettings) -> Result<WebConsoleStatus, String> {
    let state = app.state::<AppState>();
    current_status(state.inner(), settings)
}

fn apply_password_update(settings: &mut WebConsoleSettings, access_password: Option<String>, clear_password: bool) {
    if clear_password {
        settings.password_hash.clear();
        return;
    }
    if let Some(password) = access_password {
        let trimmed = password.trim().to_string();
        if trimmed.is_empty() {
            settings.password_hash.clear();
        } else {
            settings.password_hash = sha256_hex(&trimmed);
        }
    }
}

fn apply_web_console_settings(
    app: AppHandle,
    settings: WebConsoleSettings,
    access_password: Option<String>,
    clear_password: bool,
) -> Result<WebConsoleStatus, String> {
    let mut normalized = normalize_settings(settings);
    apply_password_update(&mut normalized, access_password, clear_password);

    if normalized.enabled && !normalized.allow_remote_access && !is_local_only_host(&normalized.host) {
        return Err(format!(
            "当前监听地址 {} 会把管理接口暴露给其他设备。若确实需要局域网访问，请先显式勾选“允许远程访问”。",
            normalized.host
        ));
    }

    if normalized.auth_enabled && !has_password(&normalized) {
        return Err("已启用本地 Web 服务登录鉴权，但还没有设置访问口令。请先填写口令，再保存。".to_string());
    }

    if normalized.enabled {
        start_web_console_runtime(app.clone(), normalized.host.clone(), normalized.port)?;
    } else {
        let state = app.state::<AppState>();
        stop_web_console_runtime(state.inner())?;
    }

    {
        let state = app.state::<AppState>();
        state
            .clear_web_console_sessions()
            .map_err(|e| format!("清理浏览器会话失败: {}", e))?;
    }

    write_web_console_settings(&normalized)?;
    current_status_from_app(&app, &normalized)
}

type HttpResponse = Result<Json<Value>, (StatusCode, Json<Value>)>;

fn http_ok<T: Serialize>(data: T) -> HttpResponse {
    serde_json::to_value(data)
        .map(Json)
        .map_err(|e| http_err(StatusCode::INTERNAL_SERVER_ERROR, format!("Serialize response failed: {}", e)))
}

fn http_err(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": message.into() })))
}

fn parse_params<T: DeserializeOwned>(value: Value) -> Result<T, (StatusCode, Json<Value>)> {
    serde_json::from_value(value)
        .map_err(|e| http_err(StatusCode::BAD_REQUEST, format!("参数解析失败: {}", e)))
}

async fn handle_session_status(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AxumState(ctx): AxumState<WebConsoleContext>,
    headers: HeaderMap,
    Query(query): Query<SessionQueryParams>,
) -> HttpResponse {
    let settings = load_web_console_settings().map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
    ensure_remote_peer_allowed(peer.ip(), &settings)?;
    let state = ctx.app.state::<AppState>();
    let session = authorize_browser_session(state.inner(), &settings, resolve_session_token(&headers, query.token.as_deref()), None)
        .or_else(|(status, payload)| {
            if status == StatusCode::UNAUTHORIZED {
                Ok(None)
            } else {
                Err((status, payload))
            }
        })?;
    http_ok(build_session_status(&settings, session.as_ref()))
}

async fn handle_session_login(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AxumState(ctx): AxumState<WebConsoleContext>,
    Json(params): Json<WebConsoleLoginParams>,
) -> HttpResponse {
    let settings = load_web_console_settings().map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
    ensure_remote_peer_allowed(peer.ip(), &settings)?;
    if !settings.auth_enabled {
        return Err(http_err(StatusCode::BAD_REQUEST, "当前本地 Web 服务未启用登录鉴权，无需单独登录。"));
    }
    if !has_password(&settings) {
        return Err(http_err(StatusCode::BAD_REQUEST, "当前本地 Web 服务尚未设置访问口令，请先在桌面版 GUI 里配置。"));
    }

    if sha256_hex(params.password.trim()) != settings.password_hash {
        append_web_console_log(&format!("浏览器登录失败，来源={}，原因=口令不匹配", peer.ip()));
        return Err(http_err(StatusCode::UNAUTHORIZED, "访问口令不正确。"));
    }

    let read_only = if settings.force_read_only {
        true
    } else if params.read_only.unwrap_or(false) {
        if !settings.allow_read_only_login {
            return Err(http_err(StatusCode::BAD_REQUEST, "当前配置未开放只读登录。"));
        }
        true
    } else {
        false
    };

    let token = issue_session_token();
    let expires_at_epoch = session_expiry_epoch(&settings);
    let state = ctx.app.state::<AppState>();
    state
        .upsert_web_console_session(WebConsoleSession {
            token: token.clone(),
            read_only,
            expires_at_epoch,
        })
        .map_err(|e| http_err(StatusCode::INTERNAL_SERVER_ERROR, e))?;

    append_web_console_log(&format!(
        "浏览器登录成功，来源={}，模式={}，过期时间={}",
        peer.ip(),
        if read_only { "只读" } else { "完整" },
        epoch_to_iso(expires_at_epoch).unwrap_or_else(|| expires_at_epoch.to_string())
    ));

    http_ok(WebConsoleLoginResult {
        token,
        read_only,
        expires_at: epoch_to_iso(expires_at_epoch).unwrap_or_else(|| expires_at_epoch.to_string()),
        session_ttl_minutes: settings.session_ttl_minutes,
    })
}

async fn handle_session_logout(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AxumState(ctx): AxumState<WebConsoleContext>,
    headers: HeaderMap,
    Json(params): Json<WebConsoleLogoutParams>,
) -> HttpResponse {
    let settings = load_web_console_settings().map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
    ensure_remote_peer_allowed(peer.ip(), &settings)?;
    let token = resolve_session_token(&headers, params.token.as_deref())
        .ok_or_else(|| http_err(StatusCode::BAD_REQUEST, "当前没有可注销的浏览器会话。"))?;
    let state = ctx.app.state::<AppState>();
    state
        .revoke_web_console_session(&token)
        .map_err(|e| http_err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    append_web_console_log(&format!("浏览器会话已注销，来源={}", peer.ip()));
    http_ok(json!({ "ok": true }))
}

async fn handle_invoke(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AxumPath(command): AxumPath<String>,
    AxumState(ctx): AxumState<WebConsoleContext>,
    headers: HeaderMap,
    Json(params): Json<Value>,
) -> HttpResponse {
    let settings = load_web_console_settings().map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
    ensure_remote_peer_allowed(peer.ip(), &settings)?;
    let state = ctx.app.state::<AppState>();
    let _session = authorize_browser_session(state.inner(), &settings, resolve_session_token(&headers, None), Some(&command))?;

    match command.as_str() {
        "get_config" => {
            let p: GetConfigParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            http_ok(config::get_config(p.key, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "save_config" => {
            let p: SaveConfigParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            config::save_config(p.key, p.data, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "get_system_info" => {
            let state = ctx.app.state::<AppState>();
            http_ok(config::get_system_info(state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "get_manager_context" => {
            let state = ctx.app.state::<AppState>();
            http_ok(config::get_manager_context(state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "set_plugin_dir" => {
            let p: SetPluginDirParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            config::set_plugin_dir(p.dir, ctx.app.clone(), state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "open_path_in_explorer" => {
            let p: OpenPathParams = parse_params(params)?;
            config::open_path_in_explorer(p.path).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "get_api_health_weights" => {
            let state = ctx.app.state::<AppState>();
            http_ok(gui_prefs::get_api_health_weights(state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "save_api_health_weights" => {
            let p: SaveApiHealthWeightsParams = parse_params(params)?;
            gui_prefs::save_api_health_weights(p.weights).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "list_memory" => {
            let p: MemoryTypeParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            http_ok(memory::list_memory(p.mem_type, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "get_memory" => {
            let p: MemoryItemParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            http_ok(memory::get_memory(p.mem_type, p.id, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "save_memory" => {
            let p: SaveMemoryParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            memory::save_memory(p.mem_type, p.id, p.data, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "delete_memory" => {
            let p: MemoryItemParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            memory::delete_memory(p.mem_type, p.id, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "list_history_files" => {
            let state = ctx.app.state::<AppState>();
            http_ok(history::list_history_files(state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "get_history_file" => {
            let p: HistoryFileParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            http_ok(history::get_history_file(p.filename, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "search_all_history" => {
            let p: SearchHistoryParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            http_ok(history::search_all_history(p.query, p.filters, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "get_api_history_metrics" => {
            let state = ctx.app.state::<AppState>();
            http_ok(history::get_api_history_metrics(state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "export_history" => {
            let p: ExportHistoryParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            http_ok(history::export_history(p.filename, p.format, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "import_history_file" => {
            let p: ImportHistoryParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            history::import_history_file(p.filename, p.data, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "ping_api" => {
            let p: PingApiParams = parse_params(params)?;
            http_ok(
                api_test::ping_api(p.url, p.key, p.model, p.ai_type, p.xai_web_search_enabled)
                    .await
                    .map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?,
            )
        }
        "batch_ping_apis" => {
            let p: BatchPingParams = parse_params(params)?;
            http_ok(api_test::batch_ping_apis(p.nodes).await.map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "batch_ping_apis_stream" => {
            let p: BatchPingStreamParams = parse_params(params)?;
            api_test::batch_ping_apis_stream(p.session_id, p.nodes, ctx.app.clone())
                .await
                .map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "run_personality_ab_test" => {
            let p: PersonalityAbRunParams = parse_params(params)?;
            http_ok(
                personality_ab::run_personality_ab_test(p.payload)
                    .await
                    .map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?,
            )
        }
        "list_personality_ab_tests" => {
            let p: LimitParams = parse_params(params)?;
            http_ok(personality_ab::list_personality_ab_tests(p.limit).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "get_personality_ab_test" => {
            let p: IdParams = parse_params(params)?;
            http_ok(personality_ab::get_personality_ab_test(p.id).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "delete_personality_ab_test" => {
            let p: IdParams = parse_params(params)?;
            personality_ab::delete_personality_ab_test(p.id).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "run_personality_eval_experiment_stream" => {
            let p: PersonalityEvalRunParams = parse_params(params)?;
            personality_eval::run_personality_eval_experiment_stream(p.session_id, p.payload, ctx.app.clone())
                .await
                .map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "list_personality_eval_experiments" => {
            let p: LimitParams = parse_params(params)?;
            http_ok(
                personality_eval::list_personality_eval_experiments(p.limit)
                    .map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?,
            )
        }
        "get_personality_eval_experiment" => {
            let p: IdParams = parse_params(params)?;
            http_ok(
                personality_eval::get_personality_eval_experiment(p.id)
                    .map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?,
            )
        }
        "set_personality_eval_score" => {
            let p: PersonalityEvalScoreParams = parse_params(params)?;
            personality_eval::set_personality_eval_score(p.payload).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "delete_personality_eval_experiment" => {
            let p: IdParams = parse_params(params)?;
            personality_eval::delete_personality_eval_experiment(p.id).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "list_snapshots" => http_ok(ops::list_snapshots().map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?),
        "create_snapshot" => {
            let p: CreateSnapshotParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            http_ok(ops::create_snapshot(p.reason, p.operator, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "rollback_snapshot" => {
            let p: RollbackSnapshotParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            ops::rollback_snapshot(p.snapshot_id, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "diff_snapshots" => {
            let p: DiffSnapshotsParams = parse_params(params)?;
            http_ok(
                ops::diff_snapshots(p.left_snapshot_id, p.right_snapshot_id)
                    .map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?,
            )
        }
        "export_deploy_package" => {
            let p: ExportDeployPackageParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            http_ok(ops::export_deploy_package(p.name, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "save_current_as_env_template" => {
            let p: EnvParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            ops::save_current_as_env_template(p.env, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "preview_env_template" => {
            let p: EnvParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            http_ok(ops::preview_env_template(p.env, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "apply_env_template" => {
            let p: EnvParams = parse_params(params)?;
            let state = ctx.app.state::<AppState>();
            ops::apply_env_template(p.env, state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?;
            http_ok(json!(null))
        }
        "run_startup_self_check" => {
            let state = ctx.app.state::<AppState>();
            http_ok(ops::run_startup_self_check(state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "apply_self_check_fixes" => {
            let state = ctx.app.state::<AppState>();
            http_ok(ops::apply_self_check_fixes(state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "list_audit_logs" => {
            let p: LimitParams = parse_params(params)?;
            http_ok(ops::list_audit_logs(p.limit).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "get_web_console_status" => {
            let state = ctx.app.state::<AppState>();
            http_ok(get_web_console_status(state).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        "save_web_console_settings" => {
            let p: SaveWebConsoleSettingsParams = parse_params(params)?;
            http_ok(
                apply_web_console_settings(ctx.app.clone(), p.settings, p.access_password, p.clear_password.unwrap_or(false))
                    .map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?
            )
        }
        _ => Err(http_err(StatusCode::NOT_FOUND, format!("Unknown command: {}", command))),
    }
}

async fn handle_events(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    AxumState(ctx): AxumState<WebConsoleContext>,
    headers: HeaderMap,
    Query(query): Query<SessionQueryParams>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let settings = match load_web_console_settings() {
        Ok(settings) => settings,
        Err(err) => return Err(http_err(StatusCode::BAD_REQUEST, err)),
    };
    ensure_remote_peer_allowed(peer.ip(), &settings)?;
    let state = ctx.app.state::<AppState>();
    authorize_browser_session(state.inner(), &settings, resolve_session_token(&headers, query.token.as_deref()), None)?;

    let stream = stream! {
        let Some(mut rx) = subscribe_ui_events() else {
            return;
        };

        loop {
            match rx.recv().await {
                Ok(message) => {
                    yield Ok::<Event, Infallible>(Event::default().data(message));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    };

    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(20))
            .text("keepalive"),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveWebConsoleSettingsParams {
    settings: WebConsoleSettings,
    access_password: Option<String>,
    clear_password: Option<bool>,
}

pub fn bootstrap_web_console(app: &AppHandle) -> Result<(), String> {
    let settings = load_web_console_settings()?;
    if settings.enabled {
        if let Err(err) = start_web_console_runtime(app.clone(), settings.host.clone(), settings.port) {
            eprintln!("[NekoAI Manager] failed to bootstrap web console: {}", err);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_web_console_status(state: State<'_, AppState>) -> Result<WebConsoleStatus, String> {
    let settings = load_web_console_settings()?;
    current_status(state.inner(), &settings)
}

#[tauri::command]
pub fn save_web_console_settings(
    settings: WebConsoleSettings,
    access_password: Option<String>,
    clear_password: Option<bool>,
    app: AppHandle,
) -> Result<WebConsoleStatus, String> {
    apply_web_console_settings(app, settings, access_password, clear_password.unwrap_or(false))
}
