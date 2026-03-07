use chrono::Local;
use std::fs;
use std::path::{Path, PathBuf};

pub fn app_data_root() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Failed to get current exe path: {}", e))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "Failed to resolve executable directory".to_string())?;
    let root = exe_dir.join("NekoAI-GUI-Data");
    fs::create_dir_all(&root).map_err(|e| format!("Failed to create app data root: {}", e))?;
    Ok(root)
}

pub fn ensure_subdir(name: &str) -> Result<PathBuf, String> {
    let dir = app_data_root()?.join(name);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create subdir {}: {}", name, e))?;
    Ok(dir)
}

pub fn now_id(prefix: &str) -> String {
    format!("{}-{}", prefix, Local::now().format("%Y%m%d-%H%M%S"))
}

pub fn read_json_file(path: &Path) -> Result<serde_json::Value, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("Read {} failed: {}", path.display(), e))?;
    serde_json::from_str(&content).map_err(|e| format!("Parse {} failed: {}", path.display(), e))
}
