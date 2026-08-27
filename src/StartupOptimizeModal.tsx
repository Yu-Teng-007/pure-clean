import { useEffect, useState } from "react";
import {
  CaretDown,
  CheckCircle,
  Lightning,
  RocketLaunch,
  X,
} from "@phosphor-icons/react";
import type { StartupFailure, StartupItem, StartupOptimizeReport } from "./types";

export type StartupOptimizePhase = "running" | "done" | "error";

interface StartupOptimizeModalProps {
  open: boolean;
  leaving: boolean;
  phase: StartupOptimizePhase;
  report: StartupOptimizeReport | null;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

function ExpandableFailure({
  id,
  title,
  detail,
  expanded,
  onToggle,
}: {
  id: string;
  title: string;
  detail: string;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
        className="btn-press group flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-red-50/80"
      >
        <CaretDown
          size={12}
          weight="bold"
          className={[
            "mt-0.5 shrink-0 text-[var(--color-danger)]/55 transition-transform duration-200",
            expanded ? "rotate-0" : "-rotate-90",
          ].join(" ")}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span
            className={[
              "block text-[11.5px] font-medium text-[var(--color-danger)]",
              expanded ? "break-all" : "truncate",
            ].join(" ")}
          >
            {title}
          </span>
          <span
            className={[
              "mt-0.5 block text-[11px] leading-relaxed text-[var(--color-danger)]/80",
              expanded
                ? "whitespace-pre-wrap break-all animate-fade-up"
                : "truncate",
            ].join(" ")}
          >
            {detail}
          </span>
          {!expanded && (
            <span className="mt-0.5 block text-[10.5px] text-[var(--color-ink)]/40 group-hover:text-[var(--color-sea)]">
              点击展开完整原因
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

export default function StartupOptimizeModal({
  open,
  leaving,
  phase,
  report,
  error,
  onClose,
  onRetry,
}: StartupOptimizeModalProps) {
  const [expandedFailures, setExpandedFailures] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (!open) setExpandedFailures(new Set());
  }, [open]);

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
  const disabled = report?.disabled ?? [];

  const toggleFailure = (id: string) => {
    setExpandedFailures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        aria-labelledby="startup-optimize-title"
        aria-busy={busy}
        className={[
          "w-full max-w-md max-h-[min(88vh,640px)] flex flex-col rounded-2xl bg-white shadow-xl overflow-hidden",
          leaving ? "animate-modal-out" : "animate-modal-in",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex items-start gap-3">
            <span
              className={[
                "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-sea)]/12 text-[var(--color-sea)]",
                busy ? "optimize-icon-pulse" : "",
                phase === "done" ? "animate-success-glow" : "",
              ].join(" ")}
            >
              {phase === "done" ? (
                <CheckCircle size={20} weight="duotone" />
              ) : (
                <Lightning size={20} weight="duotone" />
              )}
            </span>
            <div className="min-w-0">
              <h3
                id="startup-optimize-title"
                className="text-base font-semibold tracking-tight text-[var(--color-ink)]"
              >
                智能优化开机项
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink)]/55">
                {busy
                  ? "正在禁用非必要开机项…"
                  : phase === "done"
                    ? disabled.length > 0
                      ? `已禁用 ${disabled.length} 项开机启动项`
                      : "没有需要禁用的开机项"
                    : phase === "error"
                      ? "优化未能完成，可重试"
                      : "按启发式规则禁用更新程序与第三方自启项"}
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

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-5 pb-5">
          {busy && (
            <div className="space-y-3 animate-fade-up">
              <div className="progress-track h-2">
                <div
                  className="progress-fill"
                  style={{ width: "72%" }}
                />
              </div>
              <p className="text-[12px] text-[var(--color-ink)]/55">
                分析并禁用可优化项，系统与安全组件将保留…
              </p>
            </div>
          )}

          {phase === "done" && report && (
            <div className="space-y-4 animate-fade-up">
              <dl className="grid grid-cols-3 gap-3 rounded-xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/35 p-3">
                <div>
                  <dt className="text-[11px] text-[var(--color-ink)]/45">
                    已禁用
                  </dt>
                  <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-sea)]">
                    {report.disabled.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-[var(--color-ink)]/45">
                    已保留
                  </dt>
                  <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                    {report.skipped.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-[var(--color-ink)]/45">
                    失败
                  </dt>
                  <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                    {report.failed.length}
                  </dd>
                </div>
              </dl>

              {report.disabled.length > 0 ? (
                <section>
                  <h4 className="text-[13px] font-semibold text-[var(--color-ink)]">
                    已禁用开机项
                  </h4>
                  <ul className="mt-2 divide-y divide-[var(--color-sand)]/45 rounded-xl border border-[var(--color-sand)]/60 bg-[var(--color-mist)]/25">
                    {report.disabled.map((s: StartupItem) => (
                      <li key={s.id} className="px-3 py-2.5">
                        <div className="flex items-start gap-2.5">
                          <span
                            className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-sand)]/70 bg-white/70"
                            aria-hidden
                          >
                            {s.iconDataUrl ? (
                              <img
                                src={s.iconDataUrl}
                                alt=""
                                className="size-6 object-contain"
                                draggable={false}
                              />
                            ) : (
                              <RocketLaunch
                                size={15}
                                weight="duotone"
                                className="text-[var(--color-ink)]/35"
                              />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-medium text-[var(--color-ink)]">
                              {s.name}
                            </p>
                            <p
                              className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-ink)]/42"
                              title={s.command}
                            >
                              {s.command}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : (
                <p className="text-[12.5px] text-[var(--color-ink)]/45">
                  当前没有标记为「可优化」且仍启用的开机项，或它们已全部禁用。
                </p>
              )}

              {report.failed.length > 0 && (
                <section className="border-t border-[var(--color-sand)]/50 pt-3">
                  <p className="text-[12px] font-medium text-[var(--color-warn)]">
                    部分开机项未能禁用
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {report.failed.map((f: StartupFailure) => {
                      const id = `startup:${f.name}`;
                      return (
                        <ExpandableFailure
                          key={id}
                          id={id}
                          title={f.name}
                          detail={f.error}
                          expanded={expandedFailures.has(id)}
                          onToggle={toggleFailure}
                        />
                      );
                    })}
                  </ul>
                </section>
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
                className="btn-press inline-flex items-center gap-2 rounded-xl bg-[var(--color-sea)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
              >
                重试
              </button>
            </div>
          )}
        </div>

        {phase === "done" && (
          <div
            className="shrink-0 flex flex-wrap items-center gap-2 border-t border-[var(--color-sand)]/50 px-5 py-4 animate-footer-rise"
          >
            <button
              type="button"
              onClick={onRetry}
              className="btn-press inline-flex items-center gap-2 rounded-xl border border-[var(--color-sand)]/80 bg-white px-3.5 py-2 text-[12.5px] font-medium text-[var(--color-ink)]/75 hover:bg-[var(--color-mist)]"
            >
              再次优化
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-press inline-flex items-center gap-2 rounded-xl bg-[var(--color-sea)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
            >
              完成
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
