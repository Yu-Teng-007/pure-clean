export type AppTool = "startup" | "cleanHub" | "hardware";

export type CleanBack = "home" | "hub";

export type AppView =
  | null
  | { kind: "clean"; mode: import("./modes").CleanMode; back: CleanBack }
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
