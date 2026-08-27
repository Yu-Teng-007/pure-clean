import { FolderSimplePlus, MagnifyingGlass, X } from "@phosphor-icons/react";
import type { CleanMode } from "../modes";
import { MODES } from "../modes";
import type { ScanProgress } from "../types";
import { formatBytes, STALE_DAY_PRESETS } from "../types";
import { chipClass, thresholdLabel } from "./helpers";

type Phase = "idle" | "scanning" | "ready" | "cleaning" | "done";

interface CleanScanPanelProps {
  mode: CleanMode;
  phase: Phase;
  roots: string[];
  rootInput: string;
  canScan: boolean;
  minFileBytes: number;
  staleDays: number;
  scanProgress: ScanProgress | null;
  error: string | null;
  presets: { label: string; bytes: number }[];
  onRootInputChange: (value: string) => void;
  onAddRoot: () => void;
  onRemoveRoot: (path: string) => void;
  onStartScan: () => void;
  onCancelScan: () => void;
  onMinFileBytesChange: (bytes: number) => void;
  onStaleDaysChange: (days: number) => void;
}

export default function CleanScanPanel({
  mode,
  phase,
  roots,
  rootInput,
  canScan,
  minFileBytes,
  staleDays,
  scanProgress,
  error,
  presets,
  onRootInputChange,
  onAddRoot,
  onRemoveRoot,
  onStartScan,
  onCancelScan,
  onMinFileBytesChange,
  onStaleDaysChange,
}: CleanScanPanelProps) {
  const meta = MODES[mode];

  return (
    <section
      className="px-7 pb-4 animate-fade-up"
      style={{ animationDelay: "50ms" }}
    >
      <div className="ws-panel rounded-2xl p-4">
        {meta.needsRoots && (
          <>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                value={rootInput}
                onChange={(e) => onRootInputChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onAddRoot()}
                placeholder="添加扫描根目录，如 D:\Projects"
                disabled={phase === "scanning" || phase === "cleaning"}
                className="home-input flex-1 min-w-[200px] rounded-xl border border-[var(--color-sand)] bg-white/85 px-3 py-2 text-sm font-mono outline-none focus:border-[var(--color-sea-bright)] disabled:opacity-50"
              />
              <button
                type="button"
                onClick={onAddRoot}
                disabled={phase === "scanning" || phase === "cleaning"}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-sm font-medium hover:bg-[var(--color-mist)] disabled:opacity-50"
              >
                <FolderSimplePlus size={15} weight="bold" />
                添加
              </button>
              <button
                type="button"
                onClick={onStartScan}
                disabled={!canScan}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-sea)] text-white px-4 py-2 text-sm font-semibold hover:bg-[var(--color-sea-bright)] disabled:opacity-50"
              >
                <MagnifyingGlass size={15} weight="bold" />
                {phase === "scanning" ? "扫描中…" : "开始扫描"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {roots.map((r) => (
                <span
                  key={r}
                  className="inline-flex max-w-full items-center gap-2 rounded-xl bg-[var(--color-mist)] px-3 py-1.5 text-xs font-mono text-[var(--color-ink)]/80"
                >
                  <span className="truncate">{r}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveRoot(r)}
                    disabled={phase === "scanning" || phase === "cleaning"}
                    className="btn-press shrink-0 rounded-md p-0.5 text-[var(--color-ink)]/40 hover:text-[var(--color-danger)] disabled:opacity-40"
                    aria-label={`移除 ${r}`}
                  >
                    <X size={12} weight="bold" />
                  </button>
                </span>
              ))}
              {meta.rootsHint && (
                <span className="text-xs text-[var(--color-ink)]/45 self-center">
                  {meta.rootsHint}
                </span>
              )}
            </div>
          </>
        )}

        {!meta.needsRoots && (
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <p className="text-[13px] text-[var(--color-ink)]/60 max-w-[52ch] leading-relaxed">
              {mode === "docker"
                ? "将扫描 Docker / WSL 虚拟磁盘，并可执行 docker system prune"
                : "将扫描 Temp、回收站、浏览器全配置、应用缓存、升级残留与崩溃转储"}
            </p>
            <button
              type="button"
              onClick={onStartScan}
              disabled={!canScan}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-sea)] text-white px-4 py-2 text-sm font-semibold hover:bg-[var(--color-sea-bright)] disabled:opacity-50"
            >
              <MagnifyingGlass size={15} weight="bold" />
              {phase === "scanning" ? "扫描中…" : "开始扫描"}
            </button>
          </div>
        )}

        {meta.needsThreshold && (
          <div
            className={[
              "flex flex-wrap items-center gap-2",
              meta.needsRoots ? "mt-3 pt-3 border-t border-[var(--color-sand)]/50" : "mt-1",
            ].join(" ")}
          >
            <span className="text-xs text-[var(--color-ink)]/55">
              {thresholdLabel(mode)}
            </span>
            {presets.map((preset) => (
              <button
                key={preset.bytes}
                type="button"
                disabled={phase === "scanning" || phase === "cleaning"}
                onClick={() => onMinFileBytesChange(preset.bytes)}
                className={chipClass(minFileBytes === preset.bytes)}
              >
                {preset.label}
              </button>
            ))}
            <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink)]/55">
              自定义
              <input
                type="number"
                min={1}
                step={1}
                disabled={phase === "scanning" || phase === "cleaning"}
                value={Math.max(1, Math.round(minFileBytes / (1024 * 1024)))}
                onChange={(e) => {
                  const mb = Number(e.target.value);
                  if (!Number.isFinite(mb) || mb < 1) return;
                  onMinFileBytesChange(Math.round(mb) * 1024 * 1024);
                }}
                className="w-16 rounded-lg border border-[var(--color-sand)] bg-white/80 px-2 py-1 text-xs font-mono outline-none focus:border-[var(--color-sea-bright)] disabled:opacity-50"
              />
              MB
            </label>
          </div>
        )}

        {meta.needsStaleDays && (
          <div
            className={[
              "flex flex-wrap items-center gap-2",
              meta.needsRoots || meta.needsThreshold
                ? "mt-3 pt-3 border-t border-[var(--color-sand)]/50"
                : "mt-1",
            ].join(" ")}
          >
            <span className="text-xs text-[var(--color-ink)]/55">
              {mode === "stale" ? "闲置天数" : "闲置 node_modules"}
            </span>
            {STALE_DAY_PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                disabled={phase === "scanning" || phase === "cleaning"}
                onClick={() => onStaleDaysChange(preset.days)}
                className={chipClass(staleDays === preset.days)}
              >
                {preset.label}
              </button>
            ))}
            <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink)]/55">
              自定义
              <input
                type="number"
                min={1}
                step={1}
                disabled={phase === "scanning" || phase === "cleaning"}
                value={Math.max(1, staleDays)}
                onChange={(e) => {
                  const days = Number(e.target.value);
                  if (!Number.isFinite(days) || days < 1) return;
                  onStaleDaysChange(Math.round(days));
                }}
                className="w-16 rounded-lg border border-[var(--color-sand)] bg-white/80 px-2 py-1 text-xs font-mono outline-none focus:border-[var(--color-sea-bright)] disabled:opacity-50"
              />
              天未修改
            </label>
          </div>
        )}

        {phase === "scanning" && scanProgress && (
          <div className="mt-3 pt-3 border-t border-[var(--color-sand)]/50">
            <div className="scan-rail" aria-hidden />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="min-w-0 flex-1 text-xs font-mono text-[var(--color-ink)]/55 truncate animate-pulse-soft">
                {scanProgress.currentPath}
                <span className="ml-2">
                  已发现 {scanProgress.itemsFound} 项 /{" "}
                  {formatBytes(scanProgress.bytesFound)}
                </span>
              </p>
              <button
                type="button"
                onClick={onCancelScan}
                className="btn-press shrink-0 rounded-lg border border-[var(--color-sand)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-ink)]/70 hover:bg-[var(--color-mist)]"
              >
                取消扫描
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
        )}
      </div>
    </section>
  );
}
