mod analyze;
mod clean;
mod commands;
mod config;
mod drives;
mod hardware;
mod history;
mod memory;
mod model;
mod scan;
mod startup;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_default_roots,
            commands::get_categories,
            commands::load_config,
            commands::save_config,
            commands::scan,
            commands::clean,
            commands::format_bytes,
            commands::list_drives,
            commands::analyze_disk_usage,
            commands::load_history,
            commands::list_startup_items,
            commands::set_startup_enabled,
            commands::run_smart_optimize,
            commands::cancel_smart_optimize,
            commands::get_hardware_info,
            commands::get_memory_snapshot,
            commands::list_memory_processes,
            commands::clean_memory,
            commands::trim_process_working_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running 净界");
}
