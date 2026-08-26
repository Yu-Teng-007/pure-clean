import { useEffect } from "react";
import { Broom, CheckCircle, X } from "@phosphor-icons/react";
import { formatBytes, type CleanProgress, type CleanReport } from "./types";

export type DiskCleanPhase = "running" | "done" | "error";

const CLEAN_STAGES = [
  "校验所选项目",
  "删除缓存与临时文件",
  "回收磁盘空间",
  "完成",
] as const;

interface CleanProgressModalProps {
  open: boolean;
  leaving: boolean;
  phase: DiskCleanPhase;
  cleanStage: number;
  cleanProgressPct: number;
  cleanProgress: CleanProgress | null;
  report: CleanReport | null;
  error: string | null;
  animatedFreed: number;
  selectedCount: number;
  selectedBytes: number;
  onClose: () => void;
  onRetry: () => void;
}

export default function CleanProgressModal({
  open,
  leaving,
  phase,
  cleanStage,
  cleanProgressPct,
  cleanProgress,
  report,
  error,
  animatedFreed,
  selectedCount,
  selectedBytes,
  onClose,
  onRetry,
}: CleanProgressModalProps) {
  useEffect(() => {
    if (!open || phase === "running") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, phase, onClose]);

  if (!open) return null;

  const busy = phase === "running";

  return (
    <div
      className={[
        "fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 backdrop-blur-[2px] px-4",
        leaving ? "animate-backdrop-out" : "animate-backdrop-in",
      ].join(" ")}
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="disk-clean-title"
        aria-busy={busy}
        className={[
          "w-full max-w-md flex flex-col rounded-2xl bg-white shadow-xl overflow-hidden max-h-[min(90vh,640px)]",
          leaving ? "animate-modal-out" : "animate-modal-in",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex items-start gap-3">
            <span
              className={[
                "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-sea)]/12 text-[var(--color-sea)]",
                busy ? "optimize-icon-pulse mem-icon-cleaning" : "",
                phase === "done" ? "animate-success-glow" : "",
              ].join(" ")}
            >
              {phase === "done" ? (
                <CheckCircle size={20} weight="duotone" />
              ) : (
                <Broom size={20} weight="duotone" />
              )}
            </span>
            <div className="min-w-0">
              <h3
                id="disk-clean-title"
                className="text-base font-semibold tracking-tight text-[var(--color-ink)]"
              >
                磁盘清理
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink)]/55">
                {busy
                  ? "正在安全处理所选项目…"
                  : phase === "done"
                    ? "清理已完成"
                    : "清理未能完成，可重试"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-press shrink-0 rounded-lg p-1.5 text-[var(--color-ink)]/45 hover:bg-[var(--color-mist)] hover:text-[var(--color-ink)] disabled:opacity-35 disabled:pointer-events-none"
            aria-label="关闭"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4 overflow-y-auto">
          {(phase === "running" || phase === "done") && (
            <div className="space-y-3 animate-fade-up">
              <div className="flex flex-wrap gap-2">
                {CLEAN_STAGES.map((label, i) => {
                  const done = phase === "done" || i < cleanStage;
                  const current = phase === "running" && i === cleanStage;
                  return (
                    <span
                      key={label}
                      className={[
                        "optimize-step rounded-lg px-2.5 py-1 text-[11px] font-medium transition-[background-color,color,transform,box-shadow] duration-300",
                        done
                          ? "bg-[var(--color-sea)]/12 text-[var(--color-sea)]"
                          : current
                            ? "bg-[var(--color-sea)] text-white optimize-step--active"
                            : "bg-[var(--color-sand)]/50 text-[var(--color-ink)]/40",
                      ].join(" ")}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>

              {phase === "running" && (
                <>
                  <div className="flex items-center gap-4 rounded-2xl border border-[var(--color-sea)]/15 bg-[var(--color-mist)]/40 px-4 py-3.5">
                    <div className="clean-orb" aria-hidden>
                      <div className="clean-orb__ring" />
                      <div className="clean-orb__core" />
                      <div className="clean-orb__dot" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-baseline justify-between gap-3">
                        <p className="text-[13px] font-semibold text-[var(--color-ink)]">
                          清理中
                        </p>
                        <p className="font-mono text-[13px] tabular-nums text-[var(--color-sea)]">
                          {Math.round(cleanProgressPct)}%
                        </p>
                      </div>
                      <div className="progress-track h-2">
                        <div
                          className="progress-fill"
                          style={{ width: `${cleanProgressPct}%` }}
                        />
                      </div>
                      <p
                        key={cleanProgress?.currentPath ?? CLEAN_STAGES[cleanStage]}
                        className="mt-2 text-[12px] text-[var(--color-ink)]/55 animate-fade-up truncate"
                      >
                        <span className="animate-pulse-soft">
                          {cleanProgress?.currentPath
                            ? cleanProgress.currentPath
                            : `${CLEAN_STAGES[cleanStage]}…`}
                        </span>
                        {cleanProgress && cleanProgress.total > 0 && (
                          <span className="ml-2 font-mono tabular-nums text-[var(--color-ink)]/40">
                            {cleanProgress.done}/{cleanProgress.total}
                          </span>
                        )}
                      </p>
                      <p className="mt-1 font-mono text-[12px] tabular-nums text-[var(--color-sea)] animate-freed-flash">
                        已释放 {formatBytes(animatedFreed)}
                      </p>
                    </div>
                  </div>
                  <div className="scan-rail" aria-hidden />
                </>
              )}
            </div>
          )}

          {phase === "error" && error && (
            <div className="space-y-3 animate-fade-up">
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
                {error}
              </p>
              <button
                type="button"
                onClick={onRetry}
                className="btn-press inline-flex items-center gap-2 rounded-xl bg-[var(--color-sea)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
              >
                <Broom size={16} weight="fill" />
                重试
              </button>
            </div>
          )}

          {phase === "done" && report && (
            <div className="space-y-3 animate-fade-up">
              <section className="rounded-2xl border border-[var(--color-sea)]/20 bg-[var(--color-sea)]/8 p-4 animate-success-glow">
                <div className="flex items-start gap-3">
                  <SuccessCheck />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-[var(--color-ink)]/45">
                      {report.dryRun
                        ? "模拟释放"
                        : report.toRecycleBin
                          ? "已移入回收站"
                          : "已释放空间"}
                    </p>
                    <p className="mt-0.5 font-mono text-[1.45rem] font-semibold tracking-tight text-[var(--color-sea)] tabular-nums animate-freed-flash">
                      {formatBytes(animatedFreed)}
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/40 p-4">
                <h4 className="text-[13px] font-semibold text-[var(--color-ink)]">
                  清理报告
                </h4>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-[11px] text-[var(--color-ink)]/45">
                      成功
                    </dt>
                    <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                      {report.successCount} 项
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[var(--color-ink)]/45">
                      失败
                    </dt>
                    <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                      {report.failures.length} 项
                    </dd>
                  </div>
                </dl>

                {report.byCategory?.length > 0 && (
                  <ul className="mt-3 space-y-1.5 border-t border-[var(--color-sand)]/50 pt-3">
                    {report.byCategory.map((c) => (
                      <li
                        key={c.category}
                        className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-ink)]/65"
                      >
                        <span className="font-medium text-[var(--color-ink)]/80 truncate">
                          {c.label}
                        </span>
                        <span className="shrink-0 font-mono tabular-nums">
                          {c.count} 项 · {formatBytes(c.freedBytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {report.failures.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-[var(--color-sand)]/50 pt-3 max-h-28 overflow-y-auto">
                    {report.failures.map((f) => (
                      <li
                        key={f.path}
                        className="text-[11px] font-mono text-[var(--color-ink)]/55 leading-snug"
                      >
                        {f.path}: {f.error}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="mt-3 text-[11px] text-[var(--color-ink)]/45 tabular-nums">
                  本次选中 {selectedCount} 项 · 预计{" "}
                  {formatBytes(selectedBytes)}
                </p>
              </section>

              <button
                type="button"
                onClick={onClose}
                className="btn-press w-full rounded-xl bg-[var(--color-sea)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
              >
                完成
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SuccessCheck() {
  return (
    <svg
      className="success-check animate-check-pop shrink-0"
      viewBox="0 0 28 28"
      aria-hidden
    >
      <circle className="success-check__circle" cx="14" cy="14" r="12" />
      <path className="success-check__mark" d="M8.5 14.2l3.4 3.4 7.6-7.6" />
    </svg>
  );
}
