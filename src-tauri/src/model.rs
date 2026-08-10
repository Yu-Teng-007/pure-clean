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
    SystemTemp,
    RecycleBin,
    BrowserCache,
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
            Category::SystemTemp => "系统临时文件",
            Category::RecycleBin => "回收站",
            Category::BrowserCache => "浏览器缓存",
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
            Category::SystemTemp,
            Category::RecycleBin,
            Category::BrowserCache,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanRequest {
    pub paths: Vec<String>,
    pub specials: Option<Vec<String>>,
}
