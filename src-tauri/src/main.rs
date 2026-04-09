// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api_test;
mod config;
mod data_root;
mod gui_prefs;
mod history;
mod memory;
mod ops;
mod personality_ab;
mod personality_eval;
mod state;
mod ui_events;
mod watcher;
mod web_console;

use state::AppState;

fn main() {
    tauri::Builder::default()
        .manage(AppState::new())
        .setup(|app| {
            ui_events::init_ui_events();
            web_console::bootstrap_web_console(&app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::save_config,
            config::get_system_info,
            config::get_manager_context,
            config::set_plugin_dir,
            config::open_path_in_explorer,
            gui_prefs::get_api_health_weights,
            gui_prefs::save_api_health_weights,
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
            personality_ab::run_personality_ab_test,
            personality_ab::list_personality_ab_tests,
            personality_ab::get_personality_ab_test,
            personality_ab::delete_personality_ab_test,
            personality_eval::run_personality_eval_experiment_stream,
            personality_eval::list_personality_eval_experiments,
            personality_eval::get_personality_eval_experiment,
            personality_eval::set_personality_eval_score,
            personality_eval::delete_personality_eval_experiment,
            web_console::get_web_console_status,
            web_console::save_web_console_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
