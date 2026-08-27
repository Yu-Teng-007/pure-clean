import type { CleanMode } from "../modes";
import { MODES } from "../modes";
import type { ScanItem } from "../types";
import {
  DEFAULT_DUPE_MIN_BYTES,
  DEFAULT_INSTALLER_MIN_BYTES,
  DEFAULT_MIN_FILE_BYTES,
  DUPE_MIN_PRESETS,
  INSTALLER_MIN_PRESETS,
  MIN_FILE_PRESETS,
} from "../types";

export const EXIT_MS = 380;
export const SORT_PREF_KEY = "pure-clean-sort-by-size";

export function isFilesystemPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path.trim()) || path.startsWith("\\\\");
}

export function riskLabel(risk: ScanItem["risk"]): string {
  switch (risk) {
    case "safe":
      return "安全";
    case "caution":
      return "谨慎";
    case "dangerous":
      return "高风险";
  }
}

export function riskClass(risk: ScanItem["risk"]): string {
  switch (risk) {
    case "safe":
      return "text-[var(--color-sea)] bg-[var(--color-sea)]/10";
    case "caution":
      return "text-[var(--color-warn)] bg-amber-500/10";
    case "dangerous":
      return "text-[var(--color-danger)] bg-red-500/10";
  }
}

export function scanHintClass(hint: string): string {
  if (hint.includes("请勿删除") || hint.includes("不可")) {
    return "text-[var(--color-warn)]";
  }
  return "text-[var(--color-ink)]/48";
}

export function defaultThresholdBytes(mode: CleanMode): number {
  const kind = MODES[mode].thresholdKind;
  if (kind === "dupes") return DEFAULT_DUPE_MIN_BYTES;
  if (kind === "installers") return DEFAULT_INSTALLER_MIN_BYTES;
  return DEFAULT_MIN_FILE_BYTES;
}

export function thresholdPresets(mode: CleanMode) {
  const kind = MODES[mode].thresholdKind;
  if (kind === "dupes") return DUPE_MIN_PRESETS;
  if (kind === "installers") return INSTALLER_MIN_PRESETS;
  return MIN_FILE_PRESETS;
}

export function thresholdLabel(mode: CleanMode): string {
  const kind = MODES[mode].thresholdKind;
  if (kind === "dupes") return "最小文件大小";
  if (kind === "installers") return "最小体积";
  return "大文件阈值";
}

export function matchItemByPath(
  items: ScanItem[],
  path: string,
): ScanItem | undefined {
  return items.find(
    (i) =>
      i.path === path ||
      (i.special === "recycle_bin" &&
        (path === "回收站" || path.includes("回收站"))) ||
      (i.special === "docker_prune" &&
        (path === "docker_prune" ||
          path.includes("Docker") ||
          path.toLowerCase().includes("docker"))) ||
      (i.special === "open_disk_cleanup" &&
        (path.includes("WinSxS") || path.includes("磁盘清理"))),
  );
}

export function isAdvisoryOnly(item: ScanItem): boolean {
  return item.special === "advisory_only";
}

export function isSelectable(item: ScanItem): boolean {
  return !isAdvisoryOnly(item);
}

export function chipClass(active: boolean): string {
  return [
    "btn-press rounded-xl px-2.5 py-1 text-xs font-medium border transition-colors duration-150 disabled:opacity-50",
    active
      ? "border-[var(--color-sea)] bg-[var(--color-sea)]/10 text-[var(--color-sea)]"
      : "border-[var(--color-sand)] bg-white text-[var(--color-ink)]/70 hover:bg-[var(--color-mist)]",
  ].join(" ");
}
