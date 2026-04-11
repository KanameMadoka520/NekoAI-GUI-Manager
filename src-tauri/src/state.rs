use notify::RecommendedWatcher;
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::sync::oneshot;

pub struct WebConsoleRuntime {
    pub host: String,
    pub port: u16,
    pub shutdown: oneshot::Sender<()>,
}

pub struct AppState {
    pub plugin_dir: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    pub web_console: Mutex<Option<WebConsoleRuntime>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            plugin_dir: Mutex::new(None),
            watcher: Mutex::new(None),
            web_console: Mutex::new(None),
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
}
