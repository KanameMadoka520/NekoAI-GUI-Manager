// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api_test;
mod config;
mod history;
mod memory;
mod state;
mod watcher;

use state::AppState;

fn main() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::save_config,
            config::get_system_info,
            config::set_plugin_dir,
            memory::list_memory,
            memory::get_memory,
            memory::save_memory,
            memory::delete_memory,
            history::list_history_files,
            history::get_history_file,
            history::search_all_history,
            history::export_history,
            api_test::ping_api,
            api_test::batch_ping_apis,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
