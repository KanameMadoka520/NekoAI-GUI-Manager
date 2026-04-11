use notify::RecommendedWatcher;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::sync::oneshot;

pub struct WebConsoleRuntime {
    pub host: String,
    pub port: u16,
    pub shutdown: oneshot::Sender<()>,
}

#[derive(Clone)]
pub struct WebConsoleSession {
    pub token: String,
    pub read_only: bool,
    pub expires_at_epoch: i64,
}

pub struct AppState {
    pub plugin_dir: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    pub web_console: Mutex<Option<WebConsoleRuntime>>,
    pub web_console_sessions: Mutex<HashMap<String, WebConsoleSession>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            plugin_dir: Mutex::new(None),
            watcher: Mutex::new(None),
            web_console: Mutex::new(None),
            web_console_sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn get_plugin_dir(&self) -> Result<PathBuf, String> {
        self.plugin_dir
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?
            .clone()
            .ok_or_else(|| "Plugin directory not configured. Please select the bot plugin directory first.".to_string())
    }

    pub fn get_plugin_dir_optional(&self) -> Result<Option<PathBuf>, String> {
        Ok(self
            .plugin_dir
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?
            .clone())
    }

    pub fn set_plugin_dir(&self, dir: PathBuf) -> Result<(), String> {
        let mut lock = self.plugin_dir.lock().map_err(|e| format!("Lock error: {}", e))?;
        *lock = Some(dir);
        Ok(())
    }

    pub fn set_watcher(&self, watcher: Option<RecommendedWatcher>) -> Result<(), String> {
        let mut lock = self.watcher.lock().map_err(|e| format!("Lock error: {}", e))?;
        *lock = watcher;
        Ok(())
    }

    pub fn get_web_console_binding(&self) -> Result<Option<(String, u16)>, String> {
        Ok(self
            .web_console
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?
            .as_ref()
            .map(|runtime| (runtime.host.clone(), runtime.port)))
    }

    pub fn set_web_console_runtime(&self, runtime: WebConsoleRuntime) -> Result<(), String> {
        let mut lock = self.web_console.lock().map_err(|e| format!("Lock error: {}", e))?;
        *lock = Some(runtime);
        Ok(())
    }

    pub fn take_web_console_runtime(&self) -> Result<Option<WebConsoleRuntime>, String> {
        let mut lock = self.web_console.lock().map_err(|e| format!("Lock error: {}", e))?;
        Ok(lock.take())
    }

    pub fn clear_web_console_runtime_if_binding(&self, host: &str, port: u16) -> Result<(), String> {
        let mut lock = self.web_console.lock().map_err(|e| format!("Lock error: {}", e))?;
        if lock
            .as_ref()
            .map(|runtime| runtime.port == port && runtime.host == host)
            .unwrap_or(false)
        {
            *lock = None;
        }
        Ok(())
    }

    pub fn upsert_web_console_session(&self, session: WebConsoleSession) -> Result<(), String> {
        let mut lock = self.web_console_sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        lock.insert(session.token.clone(), session);
        Ok(())
    }

    pub fn get_web_console_session(&self, token: &str) -> Result<Option<WebConsoleSession>, String> {
        let lock = self.web_console_sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        Ok(lock.get(token).cloned())
    }

    pub fn revoke_web_console_session(&self, token: &str) -> Result<(), String> {
        let mut lock = self.web_console_sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        lock.remove(token);
        Ok(())
    }

    pub fn cleanup_expired_web_console_sessions(&self, now_epoch: i64) -> Result<(), String> {
        let mut lock = self.web_console_sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        lock.retain(|_, session| session.expires_at_epoch > now_epoch);
        Ok(())
    }

    pub fn clear_web_console_sessions(&self) -> Result<(), String> {
        let mut lock = self.web_console_sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        lock.clear();
        Ok(())
    }
}
