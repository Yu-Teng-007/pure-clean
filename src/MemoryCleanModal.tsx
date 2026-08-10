import { useEffect } from "react";
import { Broom, CheckCircle, Memory, X } from "@phosphor-icons/react";
import { formatBytes, type MemoryCleanReport, type MemorySnapshot } from "./types";

export type MemoryCleanPhase = "running" | "done" | "error";

const CLEAN_STAGES = [
  "压缩进程工作集",
  "刷新待机列表",
  "回收可用内存",
  "完成",
] as const;

interface MemoryCleanModalProps {
  open: boolean;
  leaving: boolean;
  phase: MemoryCleanPhase;
  cleanStage: number;
  cleanProgress: number;
  report: MemoryCleanReport | null;
  error: string | null;
  animatedFreed: number;
  beforeSnap: MemorySnapshot | null;
  onClose: () => void;
  onRetry: () => void;
}

export default function MemoryCleanModal({
  open,
  leaving,
  phase,
  cleanStage,
  cleanProgress,
  report,
  error,
  animatedFreed,
  beforeSnap,
  onClose,
  onRetry,
}: MemoryCleanModalProps) {
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
  const after = report?.after ?? null;
  const beforePct = beforeSnap
    ? Math.round(Math.min(100, Math.max(0, beforeSnap.usedPercent)))
    : 0;
  const afterPct = after
    ? Math.round(Math.min(100, Math.max(0, after.usedPercent)))
    : beforePct;

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
        aria-labelledby="memory-clean-title"
        aria-busy={busy}
        className={[
          "w-full max-w-md flex flex-col rounded-2xl bg-white shadow-xl overflow-hidden",
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
                <Memory size={20} weight="duotone" />
              )}
            </span>
            <div className="min-w-0">
              <h3
                id="memory-clean-title"
                className="text-base font-semibold tracking-tight text-[var(--color-ink)]"
              >
                内存清理
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink)]/55">
                {busy
                  ? "正在压缩工作集并释放可用内存…"
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

        <div className="px-5 pb-5 space-y-4">
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
                          {Math.round(cleanProgress)}%
                        </p>
                      </div>
                      <div className="progress-track h-2">
                        <div
                          className="progress-fill"
                          style={{ width: `${cleanProgress}%` }}
                        />
                      </div>
                      <p
                        key={CLEAN_STAGES[cleanStage]}
                        className="mt-2 text-[12px] text-[var(--color-ink)]/55 animate-fade-up truncate"
                      >
                        <span className="animate-pulse-soft">
                          {CLEAN_STAGES[cleanStage]}…
                        </span>
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
                      可用内存约增加
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
                <dl className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <dt className="text-[11px] text-[var(--color-ink)]/45">
                      已压缩
                    </dt>
                    <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                      {report.trimmedCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[var(--color-ink)]/45">
                      失败
                    </dt>
                    <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                      {report.failedCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-[var(--color-ink)]/45">
                      待机列表
                    </dt>
                    <dd className="mt-0.5 text-[13px] font-semibold text-[var(--color-ink)]">
                      {report.systemCommandsOk ? "已刷新" : "需管理员"}
                    </dd>
                  </div>
                </dl>

                {beforeSnap && after && (
                  <div className="mt-3 border-t border-[var(--color-sand)]/50 pt-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-[var(--color-ink)]/45">
                      <span>占用变化</span>
                      <span className="font-mono tabular-nums">
                        {beforePct}% → {afterPct}%
                      </span>
                    </div>
                    <div className="home-disk-track">
                      <div
                        className={`home-disk-fill ${afterPct >= 90 ? "home-disk-fill--tight" : ""}`}
                        style={{ width: `${afterPct}%` }}
                      />
                    </div>
                    <p className="mt-1.5 font-mono text-[11px] text-[var(--color-ink)]/45 tabular-nums">
                      可用 {formatBytes(after.availableBytes)} /{" "}
                      {formatBytes(after.totalBytes)}
                    </p>
                  </div>
                )}

                {!report.systemCommandsOk && (
                  <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--color-ink)]/50">
                    以管理员身份运行可进一步清理待机列表。
                  </p>
                )}
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
