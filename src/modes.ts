import type { Category } from "./types";

export type CleanMode = "safe" | "dev" | "system" | "large" | "docker";

export interface ModeMeta {
  id: CleanMode;
  title: string;
  subtitle: string;
  categories: Category[];
  needsRoots: boolean;
  needsThreshold: boolean;
  needsStaleDays: boolean;
  safeOnly: boolean;
  emptyHint: string;
  rootsHint?: string;
}

export const MODE_ORDER: CleanMode[] = [
  "safe",
  "dev",
  "system",
  "large",
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
    ],
    needsRoots: true,
    needsThreshold: false,
    needsStaleDays: false,
    safeOnly: true,
    emptyHint: "添加扫描根目录后点击「开始扫描」",
    rootsHint: "将合并扫描项目根与系统安全项；结果仅保留「安全」风险项",
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
    subtitle: "临时文件、回收站、浏览器与系统缓存",
    categories: ["system_temp", "recycle_bin", "browser_cache"],
    needsRoots: false,
    needsThreshold: false,
    needsStaleDays: false,
    safeOnly: false,
    emptyHint: "点击「开始扫描」查找系统垃圾",
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
    emptyHint: "添加扫描根目录并设定阈值后点击「开始扫描」",
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
