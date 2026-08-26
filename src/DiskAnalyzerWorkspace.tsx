import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ChartPie,
  HardDrive,
  Info,
  MagnifyingGlass,
  SpinnerGap,
} from "@phosphor-icons/react";
import WorkspaceHeader from "./WorkspaceHeader";
import Select from "./Select";
import {
  AnalyzeProgress,
  AnalyzeResult,
  DiskUsageEntry,
  DriveInfo,
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
] as const;

const GROUP_LABELS: Record<string, string> = {
  drive_root: "磁盘根目录",
  user_profile: "用户目录分区",
  app_data_local: "AppData\\Local 各应用",
  user_dot: "用户隐藏目录（.xxx）",
};

const GROUP_SUB: Record<string, string> = {
  drive_root: "互不重叠的顶层目录，反映空间真实去向",
  user_profile: "体积已包含在 Users 内，仅用于定位大户",
  app_data_local: "≥200MB 的应用数据；常是「扫描只清几 GB」的隐藏原因",
  user_dot: "≥500MB 的点目录（.cache、.android 等）",
};

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, (part / total) * 100);
}

function pctLabel(part: number, total: number): string {
  return `${pct(part, total).toFixed(1)}%`;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function useAnimatedNumber(target: number, duration = 420): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const from = valueRef.current;
    const delta = target - from;
    if (delta === 0) return;

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(from + delta * eased);
      setValue(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

function shortPath(path: string): string {
  const parts = path.replace(/\\+/g, "\\").split("\\").filter(Boolean);
  if (parts.length <= 3) return path;
  return `${parts[0]}:\\…\\${parts.slice(-2).join("\\")}`;
}

function hintTone(hint: string | null): "sea" | "warn" | "ink" | null {
  if (!hint) return null;
  if (hint.includes("可尝试清理") || hint.includes("缓存")) return "sea";
  if (hint.includes("不可直接") || hint.includes("勿手动")) return "warn";
  return "ink";
}

export default function DiskAnalyzerWorkspace({
  onBack,
}: DiskAnalyzerWorkspaceProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [drive, setDrive] = useState("C:\\");
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [progressPath, setProgressPath] = useState("");
  const [progressCount, setProgressCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tipOpen, setTipOpen] = useState(true);
  const [elapsedSec, setElapsedSec] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  const animatedCount = useAnimatedNumber(progressCount, 280);

  useEffect(() => {
    (async () => {
      try {
        const list = await invoke<DriveInfo[]>("list_drives");
        setDrives(list);
        if (list.length > 0 && !list.some((d) => d.name === drive)) {
          setDrive(list[0].name);
        }
      } catch {
        /* fallback to C:\ */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only seed drive on mount
  }, []);

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

  useEffect(() => {
    if (phase !== "analyzing") {
      startedAtRef.current = null;
      return;
    }
    startedAtRef.current = performance.now();
    setElapsedSec(0);
    const id = window.setInterval(() => {
      const t0 = startedAtRef.current;
      if (t0 == null) return;
      setElapsedSec(Math.floor((performance.now() - t0) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [phase]);

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

  const usedPct = result
    ? pct(result.driveUsedBytes, result.driveTotalBytes)
    : 0;

  const elapsedLabel =
    elapsedSec < 60
      ? `${elapsedSec}s`
      : `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, "0")}`;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <WorkspaceHeader
        title="磁盘空间分析"
        subtitle="找出空间去向；清理工具只能释放可重建缓存，二者用途不同"
        icon={<ChartPie size={18} weight="duotone" />}
        onBack={onBack}
        backDisabled={phase === "analyzing"}
        backAriaLabel={
          phase === "analyzing" ? "分析进行中，暂不可返回" : "返回"
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-7">
        {/* Tip — compact, dismissible */}
        {tipOpen && (
          <div
            className="ws-panel mb-4 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 animate-fade-up"
            role="note"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-sea)]/10 text-[var(--color-sea)]">
              <Info size={13} weight="bold" />
            </span>
            <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--color-ink)]/65">
              若扫描清理只有几 GB，而磁盘已用两百多 GB，空间多半在{" "}
              <strong className="font-semibold text-[var(--color-ink)]">
                已装软件、SDK、Docker、AppData
              </strong>{" "}
              ——本工具按目录统计，帮你定位大户。
            </p>
            <button
              type="button"
              onClick={() => setTipOpen(false)}
              className="btn-press inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[11px] leading-none text-[var(--color-ink)]/40 hover:bg-white/70 hover:text-[var(--color-ink)]/70"
              aria-label="收起说明"
            >
              收起
            </button>
          </div>
        )}

        {/* Controls */}
        <div
          className="ws-panel mb-4 rounded-2xl px-4 py-3.5 animate-fade-up"
          style={{ animationDelay: "40ms" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2.5 text-[13px] text-[var(--color-ink)]/70">
              <span className="ws-mode-icon flex size-8 items-center justify-center rounded-xl">
                <HardDrive size={16} weight="duotone" />
              </span>
              <span className="shrink-0">分析盘符</span>
              <Select
                value={drive}
                onChange={setDrive}
                disabled={phase === "analyzing"}
                mono
                aria-label="分析盘符"
                options={(drives.length > 0
                  ? drives
                  : [{ name: "C:\\", totalBytes: 0, freeBytes: 0 }]
                ).map((d) => ({
                  value: d.name,
                  label: d.name,
                }))}
              />
            </label>

            <button
              type="button"
              onClick={() => void startAnalyze()}
              disabled={phase === "analyzing"}
              aria-busy={phase === "analyzing"}
              className={[
                "btn-press inline-flex min-w-[8.5rem] items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white",
                phase === "analyzing"
                  ? "bg-[var(--color-sea)]/85 cursor-wait"
                  : "bg-[var(--color-sea)] hover:bg-[var(--color-sea-bright)]",
                "disabled:opacity-90",
              ].join(" ")}
            >
              {phase === "analyzing" ? (
                <>
                  <SpinnerGap
                    size={15}
                    weight="bold"
                    className="animate-spin-orbit"
                  />
                  分析中…
                </>
              ) : (
                <>
                  <MagnifyingGlass size={15} weight="bold" />
                  {result ? "重新分析" : "开始分析"}
                </>
              )}
            </button>
          </div>

          {phase === "analyzing" && (
            <div className="mt-3.5 border-t border-[var(--color-sand)]/50 pt-3.5">
              <div className="flex items-center gap-3.5 rounded-xl border border-[var(--color-sea)]/12 bg-[var(--color-mist)]/45 px-3.5 py-3">
                <div className="clean-orb" aria-hidden>
                  <div className="clean-orb__ring" />
                  <div className="clean-orb__core" />
                  <div className="clean-orb__dot" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <p className="text-[13px] font-semibold text-[var(--color-ink)]">
                      正在统计目录体积
                    </p>
                    <p className="font-mono text-[12px] tabular-nums text-[var(--color-sea)]">
                      {elapsedLabel}
                    </p>
                  </div>
                  <p className="text-[12.5px] text-[var(--color-ink)]/55">
                    已发现{" "}
                    <span className="font-mono tabular-nums font-semibold text-[var(--color-ink)]/80">
                      {animatedCount}
                    </span>{" "}
                    项 · 首次约 1–3 分钟
                  </p>
                  <p
                    key={progressPath || "prep"}
                    className="mt-1.5 truncate font-mono text-[11.5px] text-[var(--color-ink)]/42 animate-fade-up"
                    title={progressPath}
                  >
                    <span className="animate-pulse-soft">
                      {progressPath
                        ? shortPath(progressPath)
                        : "准备扫描…"}
                    </span>
                  </p>
                </div>
              </div>
              <div className="scan-rail" aria-hidden />
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </div>

        {/* Empty / idle */}
        {phase === "idle" && !result && !error && (
          <div
            className="ws-empty flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center animate-fade-up"
            style={{ animationDelay: "80ms" }}
          >
            <span className="ws-mode-icon mb-3.5 flex size-12 items-center justify-center rounded-2xl opacity-85">
              <ChartPie size={26} weight="duotone" />
            </span>
            <p className="text-[14px] font-medium text-[var(--color-ink)]/70">
              尚未分析 {drive}
            </p>
            <p className="mt-1.5 max-w-[34ch] text-[12.5px] leading-relaxed text-[var(--color-ink)]/45">
              点击「开始分析」查看空间分布。会遍历顶层目录与用户 AppData，首次约
              1–3 分钟。
            </p>
          </div>
        )}

        {/* Results */}
        {result && phase !== "analyzing" && (
          <div
            className="space-y-5 animate-fade-up"
            style={{ animationDelay: "60ms" }}
          >
            {/* Summary */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="ws-panel rounded-2xl px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink)]/45">
                    已用
                  </p>
                  <p className="font-mono text-[11px] tabular-nums text-[var(--color-ink)]/40">
                    {usedPct.toFixed(0)}%
                  </p>
                </div>
                <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-[var(--color-ink)]">
                  {formatBytes(result.driveUsedBytes)}
                </p>
                <div className="progress-track mt-2.5 h-1.5">
                  <div
                    className={[
                      "progress-fill",
                      usedPct >= 90 ? "home-disk-fill--tight" : "",
                    ].join(" ")}
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[12px] text-[var(--color-ink)]/48">
                  共 {formatBytes(result.driveTotalBytes)}
                </p>
              </div>

              <div className="ws-panel rounded-2xl px-4 py-3.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink)]/45">
                  可用
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-[var(--color-sea)]">
                  {formatBytes(result.driveFreeBytes)}
                </p>
                <p className="mt-1.5 text-[12px] text-[var(--color-ink)]/48">
                  {result.drive}
                </p>
              </div>

              <div className="ws-panel rounded-2xl px-4 py-3.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink)]/45">
                  根目录合计
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-[var(--color-ink)]">
                  {formatBytes(rootTotal)}
                </p>
                <p className="mt-1.5 text-[12px] text-[var(--color-ink)]/48">
                  占已用 {pctLabel(rootTotal, result.driveUsedBytes)}
                </p>
              </div>
            </div>

            {GROUP_ORDER.map((group, gi) => {
              const entries = grouped.get(group);
              if (!entries?.length) return null;
              const sectionTotal = entries.reduce((s, e) => s + e.bytes, 0);
              const barBase =
                group === "drive_root"
                  ? Math.max(result.driveUsedBytes, sectionTotal, 1)
                  : Math.max(entries[0]?.bytes ?? 1, 1);

              return (
                <section
                  key={group}
                  className="animate-fade-up"
                  style={{ animationDelay: `${80 + gi * 40}ms` }}
                >
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-[14px] font-semibold tracking-tight text-[var(--color-ink)]">
                        {GROUP_LABELS[group] ?? group}
                      </h2>
                      <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-ink)]/45">
                        {GROUP_SUB[group]}
                      </p>
                    </div>
                    <span className="shrink-0 pb-0.5 font-mono text-[12px] tabular-nums text-[var(--color-ink)]/50">
                      {formatBytes(sectionTotal)}
                      {group === "drive_root" ? (
                        <span className="text-[var(--color-ink)]/35">
                          {" "}
                          · {pctLabel(sectionTotal, result.driveUsedBytes)}
                        </span>
                      ) : null}
                    </span>
                  </div>

                  <ul className="ws-list divide-y divide-[var(--color-sand)]/45 overflow-hidden rounded-2xl">
                    {entries.map((entry, i) => {
                      const share =
                        group === "drive_root"
                          ? pct(entry.bytes, result.driveUsedBytes)
                          : pct(entry.bytes, barBase);
                      const tone = hintTone(entry.hint);
                      return (
                        <li
                          key={entry.path}
                          className="group/row relative px-3.5 py-2.5 transition-colors duration-150 hover:bg-white/55 animate-row-enter"
                          style={{
                            animationDelay: `${Math.min(i, 12) * 28}ms`,
                          }}
                        >
                          <div
                            className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--color-sea)]/[0.07]"
                            style={{ width: `${share}%` }}
                            aria-hidden
                          />
                          <div className="relative flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
                            <div className="min-w-0 flex-1">
                              <p
                                className="truncate font-mono text-[12.5px] text-[var(--color-ink)]/88"
                                title={entry.path}
                              >
                                {entry.path}
                              </p>
                              {entry.hint && (
                                <p
                                  className={[
                                    "mt-0.5 text-[11px] leading-snug",
                                    tone === "sea"
                                      ? "text-[var(--color-sea)]"
                                      : tone === "warn"
                                        ? "text-[var(--color-warn)]"
                                        : "text-[var(--color-ink)]/48",
                                  ].join(" ")}
                                >
                                  {entry.hint}
                                </p>
                              )}
                            </div>
                            <div className="flex shrink-0 items-baseline gap-2 sm:min-w-[6.5rem] sm:justify-end">
                              <span className="text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">
                                {formatBytes(entry.bytes)}
                              </span>
                              {group === "drive_root" &&
                                result.driveUsedBytes > 0 && (
                                  <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink)]/40">
                                    {pctLabel(
                                      entry.bytes,
                                      result.driveUsedBytes,
                                    )}
                                  </span>
                                )}
                            </div>
                          </div>
                          {group !== "drive_root" && (
                            <div className="relative mt-2 progress-track h-1">
                              <div
                                className="progress-fill"
                                style={{
                                  width: `${share}%`,
                                  transitionDelay: `${Math.min(i, 12) * 20}ms`,
                                }}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
