import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowRight,
  CaretDown,
  CheckCircle,
  Lightning,
  RocketLaunch,
  X,
} from "@phosphor-icons/react";
import { formatBytes, type OptimizeProgress, type OptimizeReport } from "./types";
import { showToast } from "./Toast";

type Phase = "idle" | "running" | "done" | "error";

interface OptimizeModalProps {
  open: boolean;
  leaving: boolean;
  onClose: () => void;
  onOpenStartup: () => void;
  onFinished?: () => void;
}

const PHASE_STEPS: { id: OptimizeProgress["phase"]; label: string }[] = [
  { id: "scanning", label: "安全扫描" },
  { id: "cleaning", label: "清理垃圾" },
  { id: "startup", label: "优化开机项" },
  { id: "done", label: "完成" },
];

function stepIndex(phase: OptimizeProgress["phase"] | null): number {
  if (!phase) return -1;
  return PHASE_STEPS.findIndex((s) => s.id === phase);
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

export default function OptimizeModal({
  open,
  leaving,
  onClose,
  onOpenStartup,
  onFinished,
}: OptimizeModalProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<OptimizeProgress | null>(null);
  const [report, setReport] = useState<OptimizeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedFailures, setExpandedFailures] = useState<Set<string>>(
    () => new Set(),
  );
  const [deepMode, setDeepMode] = useState(false);
  const phaseRef = useRef<Phase>("idle");
  const onFinishedRef = useRef(onFinished);
  const cancelledRef = useRef(false);
  onFinishedRef.current = onFinished;
  phaseRef.current = phase;

  const toggleFailure = (id: string) => {
    setExpandedFailures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = useCallback(async () => {
    if (phaseRef.current === "running") return;
    cancelledRef.current = false;
    setPhase("running");
    setError(null);
    setReport(null);
    setExpandedFailures(new Set());
    setProgress({ phase: "scanning", message: "准备开始…" });
    try {
      const result = await invoke<OptimizeReport>("run_smart_optimize", {
        deep: deepMode,
      });
      if (cancelledRef.current) return;
      setReport(result);
      setProgress({ phase: "done", message: "体检优化完成" });
      setPhase("done");
      onFinishedRef.current?.();
      if (result.freedBytes > 0) {
        showToast(`智能优化完成 · 释放 ${formatBytes(result.freedBytes)}`);
      } else {
        showToast("智能优化完成");
      }
    } catch (e) {
      if (cancelledRef.current) return;
      const msg = String(e);
      if (msg.toLowerCase().includes("cancelled")) return;
      setError(msg);
      setPhase("error");
    }
  }, [deepMode]);

  useEffect(() => {
    if (!open) {
      setPhase("idle");
      setProgress(null);
      setReport(null);
      setError(null);
      setExpandedFailures(new Set());
      return;
    }

    let unsub: (() => void) | undefined;

    (async () => {
      unsub = await listen<OptimizeProgress>("optimize_progress", (e) => {
        if (!cancelledRef.current) setProgress(e.payload);
      });
    })();

    return () => {
      unsub?.();
    };
  }, [open]);

  const requestClose = useCallback(() => {
    const busyNow =
      phaseRef.current === "running" || phaseRef.current === "idle";
    if (busyNow) {
      cancelledRef.current = true;
      void invoke("cancel_smart_optimize").catch(() => {});
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open || leaving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, leaving, requestClose]);

  if (!open) return null;

  const activeStep = stepIndex(progress?.phase ?? null);
  const pct =
    phase === "done"
      ? 100
      : activeStep < 0
        ? 0
        : Math.min(95, ((activeStep + 0.35) / PHASE_STEPS.length) * 100);
  const busy = phase === "running" || phase === "idle";

  return (
    <div
      className={[
        "fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 backdrop-blur-[2px] px-4",
        leaving ? "animate-backdrop-out" : "animate-backdrop-in",
      ].join(" ")}
      onClick={requestClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="optimize-title"
        aria-busy={busy}
        className={[
          "optimize-modal w-full max-w-xl max-h-[min(88vh,720px)] flex flex-col rounded-2xl bg-white shadow-xl overflow-hidden",
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
                id="optimize-title"
                className="text-base font-semibold tracking-tight text-[var(--color-ink)]"
              >
                智能优化
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink)]/55">
                {busy
                  ? "正在安全清理并优化开机项…"
                  : phase === "done"
                    ? "体检优化已完成"
                    : phase === "error"
                      ? "优化未能完成，可重试"
                      : "一键安全清理，并建议禁用非必要开机项"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="btn-press shrink-0 rounded-lg p-1.5 text-[var(--color-ink)]/45 hover:bg-[var(--color-mist)] hover:text-[var(--color-ink)]"
            aria-label="关闭"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-5 pb-5">
          {phase === "idle" && (
            <div className="space-y-3 animate-fade-up">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/35 px-3 py-2.5 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={deepMode}
                  onChange={(e) => setDeepMode(e.target.checked)}
                  className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-sea)]"
                />
                <span>
                  <span className="font-medium">深度模式</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--color-ink)]/45">
                    额外扫描项目目录中的安全构建产物，耗时更长
                  </span>
                </span>
              </label>
              <button
                type="button"
                onClick={() => void run()}
                className="btn-press inline-flex items-center gap-2 rounded-xl bg-[var(--color-sea)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
              >
                <Lightning size={16} weight="fill" />
                开始优化
              </button>
            </div>
          )}

          {(phase === "running" || phase === "done") && (
            <div className="space-y-3 animate-fade-up">
              <div className="flex flex-wrap gap-2">
                {PHASE_STEPS.map((s, i) => {
                  const done = phase === "done" || i < activeStep;
                  const current = phase === "running" && i === activeStep;
                  return (
                    <span
                      key={s.id}
                      className={[
                        "optimize-step rounded-lg px-2.5 py-1 text-[11px] font-medium transition-[background-color,color,transform,box-shadow] duration-300",
                        done
                          ? "bg-[var(--color-sea)]/12 text-[var(--color-sea)]"
                          : current
                            ? "bg-[var(--color-sea)] text-white optimize-step--active"
                            : "bg-[var(--color-sand)]/50 text-[var(--color-ink)]/40",
                      ].join(" ")}
                    >
                      {s.label}
                    </span>
                  );
                })}
              </div>
              <div className="progress-track h-2">
                <div
                  className="progress-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p
                key={progress?.message ?? "starting"}
                className="text-[12px] text-[var(--color-ink)]/55 animate-fade-up"
              >
                {progress?.message ?? "正在启动…"}
              </p>
            </div>
          )}

          {error && (
            <div className="mt-1 space-y-3 animate-fade-up">
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
                {error}
              </p>
              <button
                type="button"
                onClick={() => void run()}
                className="btn-press inline-flex items-center gap-2 rounded-xl bg-[var(--color-sea)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
              >
                <Lightning size={16} weight="fill" />
                重试
              </button>
            </div>
          )}

          {report && phase === "done" && (
            <div className="mt-4 space-y-3">
              <section
                className="rounded-2xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/40 p-4 animate-fade-up"
                style={{ animationDelay: "40ms" }}
              >
                <h4 className="text-[13px] font-semibold text-[var(--color-ink)]">
                  优化报告
                </h4>
                <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
                    <dt className="text-[11px] text-[var(--color-ink)]/45">
                      释放空间
                    </dt>
                    <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-sea)] animate-freed-flash">
                      {formatBytes(report.freedBytes)}
                    </dd>
                  </div>
                  <div className="animate-fade-up" style={{ animationDelay: "110ms" }}>
                    <dt className="text-[11px] text-[var(--color-ink)]/45">
                      清理成功
                    </dt>
                    <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                      {report.cleanSuccess}
                    </dd>
                  </div>
                  <div className="animate-fade-up" style={{ animationDelay: "140ms" }}>
                    <dt className="text-[11px] text-[var(--color-ink)]/45">
                      清理失败
                    </dt>
                    <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                      {report.cleanFailures.length}
                    </dd>
                  </div>
                  <div className="animate-fade-up" style={{ animationDelay: "170ms" }}>
                    <dt className="text-[11px] text-[var(--color-ink)]/45">
                      禁用开机项
                    </dt>
                    <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                      {report.startupsDisabled.length}
                    </dd>
                  </div>
                </dl>

                {report.cleanFailures.length > 0 && (
                  <ul className="mt-3 space-y-0.5 border-t border-[var(--color-sand)]/50 pt-3">
                    {report.cleanFailures.slice(0, 5).map((f) => {
                      const id = `clean:${f.path}`;
                      return (
                        <ExpandableFailure
                          key={id}
                          id={id}
                          title={f.path}
                          detail={f.error}
                          expanded={expandedFailures.has(id)}
                          onToggle={toggleFailure}
                        />
                      );
                    })}
                  </ul>
                )}

                <p className="mt-4 rounded-xl border border-[var(--color-sea)]/20 bg-[var(--color-sea)]/6 px-3 py-2.5 text-[12px] leading-relaxed text-[var(--color-ink)]/62">
                  智能优化仅清理常见安全缓存。如需释放项目构建产物、大文件或 Docker
                  磁盘等更多空间，请前往首页「清理工具」使用对应场景清理。
                </p>
              </section>

              <section
                className="rounded-2xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/40 p-4 animate-fade-up"
                style={{ animationDelay: "100ms" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-[13px] font-semibold text-[var(--color-ink)]">
                    已禁用开机项
                  </h4>
                  <button
                    type="button"
                    onClick={onOpenStartup}
                    className="btn-press inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-sea)] hover:underline"
                  >
                    <RocketLaunch size={14} weight="duotone" />
                    去开机项管理
                    <ArrowRight size={12} weight="bold" />
                  </button>
                </div>
                {report.startupsDisabled.length === 0 ? (
                  <p className="mt-3 text-[12.5px] text-[var(--color-ink)]/45">
                    没有需要自动禁用的开机项（或均已禁用）。
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-[var(--color-sand)]/45">
                    {report.startupsDisabled.map((s, i) => (
                      <li
                        key={s.id}
                        className="py-2.5 first:pt-0 last:pb-0 animate-fade-up"
                        style={{ animationDelay: `${120 + i * 40}ms` }}
                      >
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
                )}

                {report.startupsFailed.length > 0 && (
                  <div className="mt-3 border-t border-[var(--color-sand)]/50 pt-3">
                    <p className="text-[12px] font-medium text-[var(--color-warn)]">
                      部分开机项未能禁用
                    </p>
                    <ul className="mt-1.5 space-y-0.5">
                      {report.startupsFailed.map((f) => {
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
                  </div>
                )}
              </section>

              <div
                className="flex flex-wrap items-center gap-2 pt-1 animate-footer-rise"
                style={{ animationDelay: "160ms" }}
              >
                <button
                  type="button"
                  onClick={() => void run()}
                  className="btn-press inline-flex items-center gap-2 rounded-xl border border-[var(--color-sand)]/80 bg-white px-3.5 py-2 text-[12.5px] font-medium text-[var(--color-ink)]/75 hover:bg-[var(--color-mist)]"
                >
                  再次运行
                </button>
                <button
                  type="button"
                  onClick={requestClose}
                  className="btn-press inline-flex items-center gap-2 rounded-xl bg-[var(--color-sea)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
                >
                  完成
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
