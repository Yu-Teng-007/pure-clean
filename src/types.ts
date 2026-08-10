export type Category =
  | "rust_tauri"
  | "node_build"
  | "package_manager_cache"
  | "java"
  | "python"
  | "other_dev"
  | "ide_cache"
  | "node_modules"
  | "system_temp"
  | "recycle_bin"
  | "browser_cache"
  | "large_files"
  | "docker_wsl"
  | "duplicate_files"
  | "stale_files"
  | "installers";

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
  groupId?: string | null;
  isKeeper?: boolean | null;
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

export interface CategoryFreed {
  category: Category;
  label: string;
  freedBytes: number;
  count: number;
}

export interface CleanReport {
  freedBytes: number;
  successCount: number;
  failures: CleanFailure[];
  byCategory: CategoryFreed[];
  dryRun: boolean;
  toRecycleBin: boolean;
}

export interface DriveInfo {
  name: string;
  totalBytes: number;
  freeBytes: number;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  mode: string | null;
  freedBytes: number;
  successCount: number;
  failureCount: number;
  dryRun: boolean;
  toRecycleBin: boolean;
  byCategory: CategoryFreed[];
}

export type StartupLocation =
  | "registry_hkcu"
  | "registry_hklm"
  | "folder_user"
  | "folder_common";

export type StartupImpact = "low" | "medium" | "high";

export interface StartupItem {
  id: string;
  name: string;
  command: string;
  location: StartupLocation;
  enabled: boolean;
  publisherHint: string | null;
  impact: StartupImpact;
  suggestDisable: boolean;
  iconDataUrl?: string | null;
}

export type OptimizePhase = "scanning" | "cleaning" | "startup" | "done";

export interface OptimizeProgress {
  phase: OptimizePhase;
  message: string;
}

export interface StartupFailure {
  name: string;
  error: string;
}

export interface OptimizeReport {
  freedBytes: number;
  cleanSuccess: number;
  cleanFailures: CleanFailure[];
  byCategory: CategoryFreed[];
  startupsDisabled: StartupItem[];
  startupsSkipped: StartupItem[];
  startupsFailed: StartupFailure[];
  dryRun: boolean;
  toRecycleBin: boolean;
}

export const DEFAULT_MIN_FILE_BYTES = 500 * 1024 * 1024;
export const DEFAULT_STALE_DAYS = 30;
export const DEFAULT_DUPE_MIN_BYTES = 10 * 1024 * 1024;
export const DEFAULT_INSTALLER_MIN_BYTES = 50 * 1024 * 1024;

export interface AppConfig {
  scanRoots: string[];
  enabledCategories: Category[];
  selectCautionByDefault: boolean;
  minFileBytes: number;
  staleDays: number;
  protectedPaths: string[];
  toRecycleBinByDefault: boolean;
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
  "ide_cache",
  "node_modules",
  "system_temp",
  "recycle_bin",
  "browser_cache",
  "large_files",
  "docker_wsl",
  "duplicate_files",
  "stale_files",
  "installers",
];

export const MIN_FILE_PRESETS: { label: string; bytes: number }[] = [
  { label: "100 MB", bytes: 100 * 1024 * 1024 },
  { label: "500 MB", bytes: 500 * 1024 * 1024 },
  { label: "1 GB", bytes: 1024 * 1024 * 1024 },
];

export const DUPE_MIN_PRESETS: { label: string; bytes: number }[] = [
  { label: "1 MB", bytes: 1 * 1024 * 1024 },
  { label: "10 MB", bytes: 10 * 1024 * 1024 },
  { label: "50 MB", bytes: 50 * 1024 * 1024 },
];

export const INSTALLER_MIN_PRESETS: { label: string; bytes: number }[] = [
  { label: "10 MB", bytes: 10 * 1024 * 1024 },
  { label: "50 MB", bytes: 50 * 1024 * 1024 },
  { label: "100 MB", bytes: 100 * 1024 * 1024 },
];

export const STALE_DAY_PRESETS: { label: string; days: number }[] = [
  { label: "7 天", days: 7 },
  { label: "30 天", days: 30 },
  { label: "90 天", days: 90 },
];
