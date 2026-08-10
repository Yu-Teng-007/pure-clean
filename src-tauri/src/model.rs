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
    LargeFiles,
    DockerWsl,
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
            Category::LargeFiles => "大文件",
            Category::DockerWsl => "Docker / WSL",
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
            Category::LargeFiles,
            Category::DockerWsl,
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
pub struct CleanReport {
    pub freed_bytes: u64,
    pub success_count: usize,
    pub failures: Vec<CleanFailure>,
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
    /// Minimum size for individual files reported under LargeFiles.
    /// Defaults to 500 MiB when omitted.
    pub min_file_bytes: Option<u64>,
    /// Only report node_modules directories whose mtime is at least this many days ago.
    /// Defaults to 30 when omitted and NodeModules is enabled.
    pub stale_days: Option<u64>,
    /// When true, drop items that are not Risk::Safe after scanning.
    pub safe_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanRequest {
    pub paths: Vec<String>,
    pub specials: Option<Vec<String>>,
}
