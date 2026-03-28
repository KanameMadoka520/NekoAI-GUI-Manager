use notify::RecommendedWatcher;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub plugin_dir: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            plugin_dir: Mutex::new(None),
            watcher: Mutex::new(None),
        }
    }

    pub fn get_plugin_dir(&self) -> Result<PathBuf, String> {
        self.plugin_dir
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?
            .clone()
            .ok_or_else(|| "Plugin directory not configured. Please select the bot plugin directory first.".to_string())
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
}
