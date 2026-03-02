use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use tauri::{AppHandle, Manager};

pub fn start_file_watcher(app: &AppHandle, plugin_dir: PathBuf) -> Result<RecommendedWatcher, String> {
    let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();

    let mut watcher = RecommendedWatcher::new(tx, Config::default())
        .map_err(|e| format!("Watcher creation error: {}", e))?;

    // Watch config files
    let config_files = vec![
        "runtime_config.json",
        "api_config.json",
        "group_personality.json",
        "private_personality.json",
        "commands.json",
        "group_usage_counts.json",
    ];

    for f in &config_files {
        let path = plugin_dir.join(f);
        if path.exists() {
            let _ = watcher.watch(&path, RecursiveMode::NonRecursive);
        }
    }

    // Watch memory directories
    let mem_group = plugin_dir.join("memory/group");
    let mem_private = plugin_dir.join("memory/private");
    if mem_group.exists() {
        let _ = watcher.watch(&mem_group, RecursiveMode::NonRecursive);
    }
    if mem_private.exists() {
        let _ = watcher.watch(&mem_private, RecursiveMode::NonRecursive);
    }

    // Spawn event listener thread
    let app_handle = app.clone();
    std::thread::spawn(move || {
        while let Ok(event_result) = rx.recv() {
            if let Ok(event) = event_result {
                for path in &event.paths {
                    let filename = path.file_name()
                        .and_then(|f| f.to_str())
                        .unwrap_or("")
                        .to_string();

                    let parent = path.parent()
                        .and_then(|p| p.file_name())
                        .and_then(|f| f.to_str())
                        .unwrap_or("");

                    if parent == "group" || parent == "private" {
                        let _ = app_handle.emit_all("memory-changed", &filename);
                    } else {
                        let _ = app_handle.emit_all("config-changed", &filename);
                    }
                }
            }
        }
    });

    Ok(watcher)
}
