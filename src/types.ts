export type Category =
  | "rust_tauri"
  | "node_build"
  | "package_manager_cache"
  | "java"
  | "python"
  | "other_dev"
  | "system_temp"
  | "recycle_bin"
  | "browser_cache"
  | "large_files";

export type Risk = "safe" | "caution" | "dangerous";

export interface ScanItem {
  id: string;
  category: Category;
  categoryLabel: string;
  path: string;
  bytes: number;
  risk: Risk;
  selectedByDefault: boolean;
  special: string | null;
}

export interface ScanResult {
  items: ScanItem[];
  totalBytes: number;
  scannedRoots: string[];
}

export interface ScanProgress {
  currentPath: string;
  itemsFound: number;
  bytesFound: number;
}

export interface CleanProgress {
  currentPath: string;
  done: number;
  total: number;
  freedBytes: number;
}

export interface CleanFailure {
  path: string;
  error: string;
}

export interface CleanReport {
  freedBytes: number;
  successCount: number;
  failures: CleanFailure[];
}

export const DEFAULT_MIN_FILE_BYTES = 500 * 1024 * 1024;

export interface AppConfig {
  scanRoots: string[];
  enabledCategories: Category[];
  selectCautionByDefault: boolean;
  minFileBytes: number;
}

export function formatBytes(bytes: number): string {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  if (bytes >= kb) return `${Math.round(bytes / kb)} KB`;
  return `${bytes} B`;
}

export const CATEGORY_ORDER: Category[] = [
  "rust_tauri",
  "node_build",
  "package_manager_cache",
  "java",
  "python",
  "other_dev",
  "system_temp",
  "recycle_bin",
  "browser_cache",
  "large_files",
];

export const MIN_FILE_PRESETS: { label: string; bytes: number }[] = [
  { label: "100 MB", bytes: 100 * 1024 * 1024 },
  { label: "500 MB", bytes: 500 * 1024 * 1024 },
  { label: "1 GB", bytes: 1024 * 1024 * 1024 },
];
