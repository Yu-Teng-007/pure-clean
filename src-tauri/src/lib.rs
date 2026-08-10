mod clean;
mod commands;
mod config;
mod model;
mod scan;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pure Clean");
}
