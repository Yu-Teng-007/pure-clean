export type AppTool =
  | "startup"
  | "contextMenu"
  | "cleanHub"
  | "hardware"
  | "memory"
  | "diskAnalyzer"
  | "settings"
  | "history"
  | "devCache";

export type CleanBack = "home" | "hub" | "disk" | "devCache";

export type AppView =
  | null
  | {
      kind: "clean";
      mode: import("./modes").CleanMode;
      back: CleanBack;
      initialRoots?: string[];
    }
  | { kind: "tool"; tool: AppTool };

export function locationLabel(location: string): string {
  switch (location) {
    case "registry_hkcu":
      return "当前用户注册表";
    case "registry_hklm":
      return "本机注册表";
    case "folder_user":
      return "用户 Startup 文件夹";
    case "folder_common":
      return "公共 Startup 文件夹";
    default:
      return location;
  }
}

export function impactLabel(impact: string): string {
  switch (impact) {
    case "low":
      return "低影响";
    case "medium":
      return "中等";
    case "high":
      return "较高";
    default:
      return impact;
  }
}

export function contextMenuHiveLabel(hive: string): string {
  switch (hive) {
    case "hkcu":
      return "当前用户";
    case "hklm":
      return "本机";
    default:
      return hive;
  }
}

export function contextMenuLocationLabel(location: string): string {
  switch (location) {
    case "file_shellex":
      return "文件 · Shell 扩展";
    case "directory_shellex":
      return "文件夹 · Shell 扩展";
    case "background_shellex":
      return "桌面背景 · Shell 扩展";
    case "drive_shellex":
      return "驱动器 · Shell 扩展";
    case "allfs_shellex":
      return "所有对象 · Shell 扩展";
    case "file_shell":
      return "文件 · 菜单项";
    case "directory_shell":
      return "文件夹 · 菜单项";
    case "background_shell":
      return "桌面背景 · 菜单项";
    default:
      return location;
  }
}

export function contextMenuKindLabel(kind: string): string {
  switch (kind) {
    case "shellex":
      return "扩展";
    case "shell":
      return "菜单项";
    default:
      return kind;
  }
}
