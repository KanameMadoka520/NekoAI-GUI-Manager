use crate::api_test;
use crate::config;
use crate::data_root::ensure_subdir;
use crate::gui_prefs::{self, ApiHealthWeights};
use crate::history;
use crate::memory;
use crate::ops;
use crate::personality_ab;
use crate::personality_eval;
use crate::state::{AppState, WebConsoleRuntime};
use crate::ui_events::subscribe_ui_events;
use async_stream::stream;
use axum::extract::{Path as AxumPath, State as AxumState};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Json};
use axum::routing::{get, post};
use axum::Router;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::convert::Infallible;
use std::fs;
use std::net::TcpListener as StdTcpListener;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower_http::services::{ServeDir, ServeFile};

const WEB_CONSOLE_HOST: &str = "127.0.0.1";
const DEFAULT_WEB_CONSOLE_PORT: u16 = 32191;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebConsoleSettings {
    pub enabled: bool,
    pub port: u16,
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
}

#[derive(Clone)]
struct WebConsoleContext {
    app: AppHandle,
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

fn default_web_console_settings() -> WebConsoleSettings {
    WebConsoleSettings {
        enabled: false,
        port: DEFAULT_WEB_CONSOLE_PORT,
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

fn normalize_settings(settings: WebConsoleSettings) -> WebConsoleSettings {
    WebConsoleSettings {
        enabled: settings.enabled,
        port: normalize_port(settings.port),
    }
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
    let running_port = state.get_web_console_port()?;
    let plugin_dir = state
        .get_plugin_dir_optional()?
        .map(|path| path.to_string_lossy().to_string());

    Ok(WebConsoleStatus {
        enabled: settings.enabled,
        running: running_port.is_some(),
        host: WEB_CONSOLE_HOST.to_string(),
        port: running_port.unwrap_or(settings.port),
        url: format!("http://{}:{}/", WEB_CONSOLE_HOST, running_port.unwrap_or(settings.port)),
        plugin_dir,
    })
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

fn start_web_console_runtime(app: AppHandle, port: u16) -> Result<(), String> {
    let current_port = {
        let state = app.state::<AppState>();
        state.get_web_console_port()?
    };

    if current_port == Some(port) {
        return Ok(());
    }

    let frontend_dir = resolve_frontend_dir(&app)?;
    let std_listener = StdTcpListener::bind((WEB_CONSOLE_HOST, port))
        .map_err(|e| format!("本地 Web 控制台启动失败，端口 {} 可能已被占用：{}", port, e))?;
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

    let spawn_result = thread::Builder::new()
        .name("neko-web-console".to_string())
        .spawn(move || {
            append_web_console_log(&format!("服务线程启动，端口={}", port));

            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(err) => {
                    append_web_console_log(&format!("创建 Tokio runtime 失败: {}", err));
                    let state = state_for_exit.state::<AppState>();
                    let _ = state.clear_web_console_runtime_if_port(port);
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
                        let _ = state.clear_web_console_runtime_if_port(port);
                        return;
                    }
                };

                let context = WebConsoleContext { app: app_for_thread.clone() };
                let index_file = frontend_dir.join("index.html");
                let static_service = ServeDir::new(frontend_dir).not_found_service(ServeFile::new(index_file));
                let router = Router::new()
                    .route("/api/invoke/:command", post(handle_invoke))
                    .route("/events", get(handle_events))
                    .with_state(context)
                    .fallback_service(static_service);

                let server = axum::serve(listener, router).with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                });

                if let Err(err) = server.await {
                    append_web_console_log(&format!("服务运行出错: {}", err));
                } else {
                    append_web_console_log("服务线程正常退出");
                }
            });

            let state = state_for_exit.state::<AppState>();
            let _ = state.clear_web_console_runtime_if_port(port);
        });

    if let Err(err) = spawn_result {
        return Err(format!("本地 Web 控制台启动失败，无法创建服务线程: {}", err));
    }

    {
        let state = app.state::<AppState>();
        state.set_web_console_runtime(WebConsoleRuntime { port, shutdown: shutdown_tx })?;
    }

    append_web_console_log(&format!("服务已登记为运行中，端口={}", port));

    Ok(())
}

fn current_status_from_app(app: &AppHandle, settings: &WebConsoleSettings) -> Result<WebConsoleStatus, String> {
    let state = app.state::<AppState>();
    current_status(state.inner(), settings)
}

fn apply_web_console_settings(app: AppHandle, settings: WebConsoleSettings) -> Result<WebConsoleStatus, String> {
    let normalized = normalize_settings(settings);

    if normalized.enabled {
        start_web_console_runtime(app.clone(), normalized.port)?;
    } else {
        let state = app.state::<AppState>();
        stop_web_console_runtime(state.inner())?;
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

async fn handle_invoke(
    AxumPath(command): AxumPath<String>,
    AxumState(ctx): AxumState<WebConsoleContext>,
    Json(params): Json<Value>,
) -> HttpResponse {
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
            http_ok(apply_web_console_settings(ctx.app.clone(), p.settings).map_err(|e| http_err(StatusCode::BAD_REQUEST, e))?)
        }
        _ => Err(http_err(StatusCode::NOT_FOUND, format!("Unknown command: {}", command))),
    }
}

async fn handle_events() -> impl IntoResponse {
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

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(20))
            .text("keepalive"),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveWebConsoleSettingsParams {
    settings: WebConsoleSettings,
}

pub fn bootstrap_web_console(app: &AppHandle) -> Result<(), String> {
    let settings = load_web_console_settings()?;
    if settings.enabled {
        if let Err(err) = start_web_console_runtime(app.clone(), settings.port) {
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
    app: AppHandle,
) -> Result<WebConsoleStatus, String> {
    apply_web_console_settings(app, settings)
}
