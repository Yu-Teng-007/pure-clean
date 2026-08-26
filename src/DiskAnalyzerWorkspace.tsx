import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChartPie, MagnifyingGlass } from "@phosphor-icons/react";
import WorkspaceHeader from "./WorkspaceHeader";
import {
  AnalyzeProgress,
  AnalyzeResult,
  DiskUsageEntry,
  formatBytes,
} from "./types";

interface DiskAnalyzerWorkspaceProps {
  onBack: () => void;
}

type Phase = "idle" | "analyzing" | "done";

const GROUP_ORDER = [
  "drive_root",
  "user_profile",
  "app_data_local",
  "user_dot",
];

const GROUP_LABELS: Record<string, string> = {
  drive_root: "磁盘根目录（互不重叠）",
  user_profile: "用户目录分区",
  app_data_local: "AppData\\Local 各应用（C 盘隐藏大户）",
  user_dot: "用户隐藏目录（.xxx）",
};

function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.min(100, (part / total) * 100).toFixed(1)}%`;
}

export default function DiskAnalyzerWorkspace({
  onBack,
}: DiskAnalyzerWorkspaceProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [drive, setDrive] = useState("C:\\");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [progressPath, setProgressPath] = useState("");
  const [progressCount, setProgressCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<AnalyzeProgress>("analyze_progress", (ev) => {
        setProgressPath(ev.payload.currentPath);
        setProgressCount(ev.payload.entriesFound);
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const startAnalyze = useCallback(async () => {
    setPhase("analyzing");
    setError(null);
    setResult(null);
    setProgressPath("");
    setProgressCount(0);
    try {
      const res = await invoke<AnalyzeResult>("analyze_disk_usage", { drive });
      setResult(res);
      setPhase("done");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }, [drive]);

  const grouped = useMemo(() => {
    if (!result) return new Map<string, DiskUsageEntry[]>();
    const map = new Map<string, DiskUsageEntry[]>();
    for (const entry of result.entries) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => b.bytes - a.bytes);
    }
    return map;
  }, [result]);

  const rootTotal = useMemo(() => {
    const roots = grouped.get("drive_root") ?? [];
    return roots.reduce((s, e) => s + e.bytes, 0);
  }, [grouped]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <WorkspaceHeader
        title="磁盘空间分析"
        subtitle="找出 C 盘空间去向；清理工具只能释放可重建缓存，二者用途不同"
        icon={<ChartPie size={18} weight="duotone" />}
        onBack={onBack}
        backDisabled={phase === "analyzing"}
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        <div className="rounded-2xl border border-[var(--color-sand)]/80 bg-white/55 px-4 py-3.5 mb-4">
          <p className="text-[13px] leading-relaxed text-[var(--color-ink)]/70">
            若扫描清理只有几 GB，而磁盘已用两百多 GB，通常是因为空间在{" "}
            <strong className="font-semibold text-[var(--color-ink)]">
              已装软件、Android SDK、Docker、用户 AppData
            </strong>{" "}
            里——不是 Temp 缓存。本工具按目录统计体积，帮你定位大户。
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center justify-between mb-5">
          <label className="flex items-center gap-2 text-[13px] text-[var(--color-ink)]/70">
            分析盘符
            <select
              value={drive}
              onChange={(e) => setDrive(e.target.value)}
              disabled={phase === "analyzing"}
              className="rounded-lg border border-[var(--color-sand)] bg-white/80 px-2.5 py-1.5 text-[13px]"
            >
              <option value="C:\\">C:\</option>
              <option value="D:\\">D:\</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void startAnalyze()}
            disabled={phase === "analyzing"}
            className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-sea)] text-white px-4 py-2 text-sm font-semibold hover:bg-[var(--color-sea-bright)] disabled:opacity-50"
          >
            <MagnifyingGlass size={15} weight="bold" />
            {phase === "analyzing" ? "分析中…" : "开始分析"}
          </button>
        </div>

        {phase === "analyzing" && (
          <div className="rounded-2xl border border-[var(--color-sand)]/80 bg-white/45 px-4 py-3 mb-4 animate-pulse">
            <p className="text-[13px] text-[var(--color-ink)]/60">
              正在统计… 已发现 {progressCount} 项
            </p>
            <p className="mt-1 text-[12px] text-[var(--color-ink)]/45 truncate font-mono">
              {progressPath || "准备中"}
            </p>
          </div>
        )}

        {error && (
          <p className="text-[13px] text-[var(--color-danger)] mb-4">{error}</p>
        )}

        {result && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-5">
              <div className="rounded-2xl border border-[var(--color-sand)]/80 bg-white/55 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-ink)]/45">
                  已用
                </p>
                <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
                  {formatBytes(result.driveUsedBytes)}
                </p>
                <p className="text-[12px] text-[var(--color-ink)]/50">
                  共 {formatBytes(result.driveTotalBytes)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--color-sand)]/80 bg-white/55 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-ink)]/45">
                  可用
                </p>
                <p className="mt-1 text-lg font-semibold text-[var(--color-sea)]">
                  {formatBytes(result.driveFreeBytes)}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--color-sand)]/80 bg-white/55 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-ink)]/45">
                  根目录合计
                </p>
                <p className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
                  {formatBytes(rootTotal)}
                </p>
                <p className="text-[12px] text-[var(--color-ink)]/50">
                  Users + Windows + Program Files…
                </p>
              </div>
            </div>

            {GROUP_ORDER.map((group) => {
              const entries = grouped.get(group);
              if (!entries?.length) return null;
              const sectionTotal = entries.reduce((s, e) => s + e.bytes, 0);
              const base =
                group === "drive_root"
                  ? result.driveUsedBytes
                  : result.driveUsedBytes;
              return (
                <section key={group} className="mb-6">
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">
                      {GROUP_LABELS[group] ?? group}
                    </h2>
                    <span className="text-[12px] text-[var(--color-ink)]/50 shrink-0">
                      本节 {formatBytes(sectionTotal)}
                      {group === "drive_root"
                        ? ` · 占已用 ${pct(sectionTotal, base)}`
                        : null}
                    </span>
                  </div>
                  {group !== "drive_root" && (
                    <p className="text-[11px] text-[var(--color-ink)]/45 mb-2">
                      以下目录包含在上级文件夹内，体积与根目录统计有重叠，仅用于定位大户。
                    </p>
                  )}
                  <ul className="rounded-2xl border border-[var(--color-sand)]/80 bg-white/45 divide-y divide-[var(--color-sand)]/50 overflow-hidden">
                    {entries.map((entry) => (
                      <li
                        key={entry.path}
                        className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4"
                      >
                        <div className="min-w-0 flex-1">
                          <p
                            className="text-[12px] font-mono text-[var(--color-ink)]/85 truncate"
                            title={entry.path}
                          >
                            {entry.path}
                          </p>
                          {entry.hint && (
                            <p className="mt-0.5 text-[11px] text-[var(--color-ink)]/48 leading-snug">
                              {entry.hint}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right sm:min-w-[7rem]">
                          <span className="text-[13px] font-semibold text-[var(--color-ink)]">
                            {formatBytes(entry.bytes)}
                          </span>
                          {group === "drive_root" && result.driveUsedBytes > 0 && (
                            <span className="ml-2 text-[11px] text-[var(--color-ink)]/45">
                              {pct(entry.bytes, result.driveUsedBytes)}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}

        {phase === "idle" && !result && !error && (
          <p className="text-[13px] text-[var(--color-ink)]/50 text-center py-12">
            点击「开始分析」查看 {drive} 空间分布（首次约 1–3 分钟）
          </p>
        )}
      </div>
    </div>
  );
}
