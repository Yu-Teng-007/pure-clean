mod analyze;
mod clean;
mod commands;
mod config;
mod drives;
mod elevation;
mod hardware;
mod history;
mod memory;
mod model;
mod process_lock;
mod recycle_restore;
mod scan;
mod scheduler;
mod context_menu;
mod startup;
mod system_tools;
mod tray;
mod services;
mod shell_integration;
mod winsxs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Handle Explorer shell menu: pure-clean.exe --analyze "D:\path"
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 3 && args[1] == "--analyze" {
        let _ = shell_integration::handle_analyze_arg(&args[2]);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            tray::setup_tray(app)?;
            scheduler::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if tray::handle_close_to_tray(window) {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_default_roots,
            commands::get_categories,
            commands::load_config,
            commands::save_config,
            commands::scan,
            commands::clean,
            commands::cancel_scan,
            commands::cancel_clean,
            commands::cancel_dev_cache_scan,
            commands::clear_history,
            commands::scan_dev_caches,
            commands::find_locking_processes,
            commands::restore_history,
            commands::open_recycle_bin,
            commands::open_disk_cleanup,
            commands::reveal_in_explorer,
            commands::format_bytes,
            commands::list_drives,
            commands::analyze_disk_usage,
            commands::load_history,
            commands::list_startup_items,
            commands::set_startup_enabled,
            commands::run_startup_smart_optimize,
            commands::list_context_menu_items,
            commands::set_context_menu_enabled,
            commands::run_context_menu_smart_optimize,
            commands::run_smart_optimize,
            commands::cancel_smart_optimize,
            commands::get_hardware_info,
            commands::get_memory_snapshot,
            commands::list_memory_processes,
            commands::clean_memory,
            commands::trim_process_working_set,
            commands::is_elevated,
            commands::restart_as_admin,
            commands::check_for_updates,
            commands::trigger_cleanup_reminder,
            commands::export_history,
            commands::export_config,
            commands::import_config,
            commands::import_config_from_path,
            commands::estimate_duplicate_scan,
            commands::list_service_suggestions,
            commands::analyze_winsxs,
            commands::register_explorer_menu,
            commands::unregister_explorer_menu,
            commands::is_explorer_menu_registered,
            commands::take_pending_analyze_path,
            commands::open_services_console,
        ])
        .run(tauri::generate_context!())
        .expect("error while running 净界");
}
