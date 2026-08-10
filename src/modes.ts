import type { Category } from "./types";

export type CleanMode = "dev" | "system" | "large";

export interface ModeMeta {
  id: CleanMode;
  title: string;
  subtitle: string;
  categories: Category[];
  needsRoots: boolean;
  needsThreshold: boolean;
  emptyHint: string;
}

export const MODE_ORDER: CleanMode[] = ["dev", "system", "large"];

export const MODES: Record<CleanMode, ModeMeta> = {
  dev: {
    id: "dev",
    title: "开发清理",
    subtitle: "构建产物、包管理器与语言工具缓存",
    categories: [
      "rust_tauri",
      "node_build",
      "package_manager_cache",
      "java",
      "python",
      "other_dev",
    ],
    needsRoots: true,
    needsThreshold: false,
    emptyHint: "添加扫描根目录后点击「开始扫描」",
  },
  system: {
    id: "system",
    title: "系统清理",
    subtitle: "临时文件、回收站与浏览器缓存",
    categories: ["system_temp", "recycle_bin", "browser_cache"],
    needsRoots: false,
    needsThreshold: false,
    emptyHint: "点击「开始扫描」查找系统垃圾",
  },
  large: {
    id: "large",
    title: "大文件清理",
    subtitle: "在扫描根目录内查找超过阈值的单个文件",
    categories: ["large_files"],
    needsRoots: true,
    needsThreshold: true,
    emptyHint: "添加扫描根目录并设定阈值后点击「开始扫描」",
  },
};
