// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api_test;
mod config;
mod data_root;
mod history;
mod memory;
mod ops;
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
            config::open_path_in_explorer,
            memory::list_memory,
            memory::get_memory,
            memory::save_memory,
            memory::delete_memory,
            history::list_history_files,
            history::get_history_file,
            history::search_all_history,
            history::get_api_history_metrics,
            history::export_history,
            history::import_history_file,
            api_test::ping_api,
            api_test::batch_ping_apis,
            api_test::batch_ping_apis_stream,
            ops::list_snapshots,
            ops::create_snapshot,
            ops::rollback_snapshot,
            ops::diff_snapshots,
            ops::export_deploy_package,
            ops::save_current_as_env_template,
            ops::preview_env_template,
            ops::apply_env_template,
            ops::run_startup_self_check,
            ops::apply_self_check_fixes,
            ops::list_audit_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
