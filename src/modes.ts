import type { Category } from "./types";

export type CleanMode =
  | "safe"
  | "dev"
  | "system"
  | "large"
  | "docker"
  | "dupes"
  | "stale"
  | "installers";

export interface ModeMeta {
  id: CleanMode;
  title: string;
  subtitle: string;
  categories: Category[];
  needsRoots: boolean;
  needsThreshold: boolean;
  needsStaleDays: boolean;
  safeOnly: boolean;
  /** Which threshold presets / default to use when needsThreshold */
  thresholdKind?: "large" | "dupes" | "installers";
  emptyHint: string;
  rootsHint?: string;
}

export const MODE_ORDER: CleanMode[] = [
  "safe",
  "dev",
  "system",
  "large",
  "dupes",
  "stale",
  "installers",
  "docker",
];

export const MODES: Record<CleanMode, ModeMeta> = {
  safe: {
    id: "safe",
    title: "一键安全清理",
    subtitle: "仅扫描可安全重建的缓存与临时文件，默认全选",
    categories: [
      "rust_tauri",
      "node_build",
      "package_manager_cache",
      "java",
      "python",
      "other_dev",
      "system_temp",
      "recycle_bin",
      "browser_cache",
      "app_cache",
    ],
    needsRoots: true,
    needsThreshold: false,
    needsStaleDays: false,
    safeOnly: true,
    emptyHint: "添加扫描根目录后点击「开始扫描」",
    rootsHint: "将合并扫描项目根与系统/浏览器/应用安全缓存；结果仅保留「安全」风险项",
  },
  dev: {
    id: "dev",
    title: "开发清理",
    subtitle: "构建产物、包管理器、语言工具、IDE 与闲置 node_modules",
    categories: [
      "rust_tauri",
      "node_build",
      "package_manager_cache",
      "java",
      "python",
      "other_dev",
      "ide_cache",
      "node_modules",
    ],
    needsRoots: true,
    needsThreshold: false,
    needsStaleDays: true,
    safeOnly: false,
    emptyHint: "添加扫描根目录后点击「开始扫描」",
    rootsHint: "全局开发 / IDE 缓存路径会自动包含",
  },
  system: {
    id: "system",
    title: "系统清理",
    subtitle: "Temp、回收站、浏览器、AppData 大目录与升级残留",
    categories: ["system_temp", "recycle_bin", "browser_cache", "app_cache"],
    needsRoots: false,
    needsThreshold: false,
    needsStaleDays: false,
    safeOnly: false,
    emptyHint: "点击「开始扫描」查找系统与应用垃圾",
  },
  large: {
    id: "large",
    title: "大文件清理",
    subtitle: "在扫描根目录内查找超过阈值的单个文件",
    categories: ["large_files"],
    needsRoots: true,
    needsThreshold: true,
    needsStaleDays: false,
    safeOnly: false,
    thresholdKind: "large",
    emptyHint: "添加扫描根目录并设定阈值后点击「开始扫描」",
  },
  dupes: {
    id: "dupes",
    title: "重复文件",
    subtitle: "按大小与内容哈希查找重复文件，默认只勾选副本",
    categories: ["duplicate_files"],
    needsRoots: true,
    needsThreshold: true,
    needsStaleDays: false,
    safeOnly: false,
    thresholdKind: "dupes",
    emptyHint: "添加扫描根目录并设定最小文件大小后点击「开始扫描」",
  },
  stale: {
    id: "stale",
    title: "闲置文件",
    subtitle: "扫描根目录与下载文件夹中超过 N 天未修改的文件",
    categories: ["stale_files"],
    needsRoots: true,
    needsThreshold: false,
    needsStaleDays: true,
    safeOnly: false,
    emptyHint: "添加扫描根目录并设定闲置天数后点击「开始扫描」",
    rootsHint: "会自动包含系统「下载」文件夹",
  },
  installers: {
    id: "installers",
    title: "安装包 / 镜像",
    subtitle: "查找安装包、ISO 镜像与 Android SDK 残留",
    categories: ["installers"],
    needsRoots: true,
    needsThreshold: true,
    needsStaleDays: false,
    safeOnly: false,
    thresholdKind: "installers",
    emptyHint: "添加扫描根目录并设定最小体积后点击「开始扫描」",
  },
  docker: {
    id: "docker",
    title: "Docker / WSL",
    subtitle: "Docker 虚拟磁盘、WSL 发行版磁盘与 docker prune",
    categories: ["docker_wsl"],
    needsRoots: false,
    needsThreshold: false,
    needsStaleDays: false,
    safeOnly: false,
    emptyHint: "点击「开始扫描」查找 Docker / WSL 占用",
  },
};
