use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    RustTauri,
    NodeBuild,
    PackageManagerCache,
    Java,
    Python,
    OtherDev,
    IdeCache,
    NodeModules,
    SystemTemp,
    RecycleBin,
    BrowserCache,
    AppCache,
    LargeFiles,
    DockerWsl,
    DuplicateFiles,
    StaleFiles,
    Installers,
}

impl Category {
    pub fn label(&self) -> &'static str {
        match self {
            Category::RustTauri => "Rust / Tauri",
            Category::NodeBuild => "Node 构建产物",
            Category::PackageManagerCache => "包管理器缓存",
            Category::Java => "Java (Gradle / Maven)",
            Category::Python => "Python",
            Category::OtherDev => "其他开发缓存",
            Category::IdeCache => "IDE / 编辑器缓存",
            Category::NodeModules => "node_modules",
            Category::SystemTemp => "系统临时文件",
            Category::RecycleBin => "回收站",
            Category::BrowserCache => "浏览器缓存",
            Category::AppCache => "应用缓存",
            Category::LargeFiles => "大文件",
            Category::DockerWsl => "Docker / WSL",
            Category::DuplicateFiles => "重复文件",
            Category::StaleFiles => "闲置文件",
            Category::Installers => "安装包 / 镜像",
        }
    }

    pub fn all() -> Vec<Category> {
        vec![
            Category::RustTauri,
            Category::NodeBuild,
            Category::PackageManagerCache,
            Category::Java,
            Category::Python,
            Category::OtherDev,
            Category::IdeCache,
            Category::NodeModules,
            Category::SystemTemp,
            Category::RecycleBin,
            Category::BrowserCache,
            Category::AppCache,
            Category::LargeFiles,
            Category::DockerWsl,
            Category::DuplicateFiles,
            Category::StaleFiles,
            Category::Installers,
        ]
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Risk {
    Safe,
    Caution,
    Dangerous,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanItem {
    pub id: String,
    pub category: Category,
    pub category_label: String,
    pub path: String,
    pub bytes: u64,
    pub risk: Risk,
    pub selected_by_default: bool,
    pub special: Option<String>,
    /// Duplicate-file group id (same content hash).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    /// When true, this is the kept original in a duplicate group.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_keeper: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub items: Vec<ScanItem>,
    pub total_bytes: u64,
    pub scanned_roots: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub current_path: String,
    pub items_found: usize,
    pub bytes_found: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanProgress {
    pub current_path: String,
    pub done: usize,
    pub total: usize,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanFailure {
    pub path: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryFreed {
    pub category: Category,
    pub label: String,
    pub freed_bytes: u64,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanReport {
    pub freed_bytes: u64,
    pub success_count: usize,
    pub failures: Vec<CleanFailure>,
    #[serde(default)]
    pub by_category: Vec<CategoryFreed>,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub to_recycle_bin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRoot {
    pub path: String,
    pub kind: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRequest {
    pub roots: Vec<String>,
    pub categories: Option<Vec<Category>>,
    pub max_depth: Option<usize>,
    pub min_file_bytes: Option<u64>,
    pub stale_days: Option<u64>,
    pub safe_only: Option<bool>,
    pub protected_paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanTarget {
    pub path: String,
    pub category: Option<Category>,
    pub bytes: Option<u64>,
    pub special: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanRequest {
    pub paths: Option<Vec<String>>,
    pub specials: Option<Vec<String>>,
    pub targets: Option<Vec<CleanTarget>>,
    pub dry_run: Option<bool>,
    pub to_recycle_bin: Option<bool>,
    pub protected_paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub name: String,
    pub total_bytes: u64,
    pub free_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageEntry {
    pub path: String,
    pub bytes: u64,
    pub group: String,
    pub group_label: String,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeProgress {
    pub current_path: String,
    pub entries_found: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeResult {
    pub drive: String,
    pub drive_total_bytes: u64,
    pub drive_used_bytes: u64,
    pub drive_free_bytes: u64,
    pub entries: Vec<DiskUsageEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub timestamp: String,
    pub mode: Option<String>,
    pub freed_bytes: u64,
    pub success_count: usize,
    pub failure_count: usize,
    pub dry_run: bool,
    pub to_recycle_bin: bool,
    pub by_category: Vec<CategoryFreed>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OptimizePhase {
    Scanning,
    Cleaning,
    Startup,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeProgress {
    pub phase: OptimizePhase,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupFailure {
    pub name: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeReport {
    pub freed_bytes: u64,
    pub clean_success: usize,
    pub clean_failures: Vec<CleanFailure>,
    pub by_category: Vec<CategoryFreed>,
    pub startups_disabled: Vec<crate::startup::StartupItem>,
    pub startups_skipped: Vec<crate::startup::StartupItem>,
    pub startups_failed: Vec<StartupFailure>,
    pub dry_run: bool,
    pub to_recycle_bin: bool,
}
