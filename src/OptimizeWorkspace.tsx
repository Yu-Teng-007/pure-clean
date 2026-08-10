import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  ArrowRight,
  Lightning,
  RocketLaunch,
} from "@phosphor-icons/react";
import {
  formatBytes,
  type OptimizeProgress,
  type OptimizeReport,
} from "./types";

type Phase = "idle" | "running" | "done" | "error";

interface OptimizeWorkspaceProps {
  onBack: () => void;
  onOpenStartup: () => void;
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

export default function OptimizeWorkspace({
  onBack,
  onOpenStartup,
}: OptimizeWorkspaceProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<OptimizeProgress | null>(null);
  const [report, setReport] = useState<OptimizeReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      unsub = await listen<OptimizeProgress>("optimize_progress", (e) => {
        setProgress(e.payload);
      });
    })();
    return () => {
      unsub?.();
    };
  }, []);

  const run = async () => {
    if (phase === "running") return;
    setPhase("running");
    setError(null);
    setReport(null);
    setProgress({ phase: "scanning", message: "准备开始…" });
    try {
      const result = await invoke<OptimizeReport>("run_smart_optimize");
      setReport(result);
      setProgress({ phase: "done", message: "体检优化完成" });
      setPhase("done");
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  };

  const activeStep = stepIndex(progress?.phase ?? null);
  const pct =
    phase === "done"
      ? 100
      : activeStep < 0
        ? 0
        : Math.min(95, ((activeStep + 0.35) / PHASE_STEPS.length) * 100);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="px-6 pt-4 pb-3 flex items-start gap-3 shrink-0">
        <button
          type="button"
          onClick={onBack}
          disabled={phase === "running"}
          className="btn-press mt-0.5 inline-flex size-9 items-center justify-center rounded-xl border border-[var(--color-sand)]/80 bg-white/55 text-[var(--color-ink)]/70 hover:bg-white/80 disabled:opacity-40"
          aria-label="返回"
        >
          <ArrowLeft size={16} weight="bold" />
        </button>
        <div className="min-w-0 flex items-center gap-2.5">
          <span className="ws-mode-icon flex size-9 items-center justify-center rounded-xl">
            <Lightning size={18} weight="duotone" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[1.15rem] font-semibold tracking-tight text-[var(--color-ink)]">
              智能优化
            </h1>
            <p className="mt-0.5 text-[12px] text-[var(--color-ink)]/55">
              一键安全清理 + 建议禁用非必要开机项
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        <section className="ws-panel rounded-2xl p-5 md:p-6">
          <p className="max-w-[52ch] text-[13.5px] leading-relaxed text-[var(--color-ink)]/65">
            将扫描并清理可安全重建的缓存与临时文件，并按启发式禁用建议优化的开机启动项（系统与常用组件会保留）。可随时在开机项管理中改回。
          </p>

          {phase === "idle" || phase === "error" ? (
            <button
              type="button"
              onClick={() => void run()}
              className="btn-press mt-5 inline-flex items-center gap-2 rounded-xl bg-[var(--color-sea)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
            >
              <Lightning size={16} weight="fill" />
              开始体检优化
            </button>
          ) : null}

          {error && (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
              {error}
            </p>
          )}

          {(phase === "running" || phase === "done") && (
            <div className="mt-5 space-y-3">
              <div className="flex flex-wrap gap-2">
                {PHASE_STEPS.map((s, i) => {
                  const done = phase === "done" || i < activeStep;
                  const current = phase === "running" && i === activeStep;
                  return (
                    <span
                      key={s.id}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${
                        done
                          ? "bg-[var(--color-sea)]/12 text-[var(--color-sea)]"
                          : current
                            ? "bg-[var(--color-sea)] text-white"
                            : "bg-[var(--color-sand)]/50 text-[var(--color-ink)]/40"
                      }`}
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
              {progress && (
                <p className="text-[12px] text-[var(--color-ink)]/55">
                  {progress.message}
                </p>
              )}
            </div>
          )}
        </section>

        {report && phase === "done" && (
          <section className="mt-4 space-y-4 animate-fade-up">
            <div className="ws-panel rounded-2xl p-5">
              <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
                优化报告
              </h2>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] text-[var(--color-ink)]/45">
                    释放空间
                  </dt>
                  <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-sea)]">
                    {formatBytes(report.freedBytes)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-[var(--color-ink)]/45">
                    清理成功
                  </dt>
                  <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                    {report.cleanSuccess}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-[var(--color-ink)]/45">
                    清理失败
                  </dt>
                  <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                    {report.cleanFailures.length}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-[var(--color-ink)]/45">
                    禁用开机项
                  </dt>
                  <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                    {report.startupsDisabled.length}
                  </dd>
                </div>
              </dl>

              {report.cleanFailures.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-[var(--color-sand)]/50 pt-3">
                  {report.cleanFailures.slice(0, 5).map((f) => (
                    <li
                      key={f.path}
                      className="truncate text-[11.5px] text-[var(--color-danger)]"
                      title={`${f.path}: ${f.error}`}
                    >
                      {f.path} — {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="ws-panel rounded-2xl p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
                  已禁用开机项
                </h2>
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
                  {report.startupsDisabled.map((s) => (
                    <li key={s.id} className="py-2.5 first:pt-0 last:pb-0">
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
                  <ul className="mt-1.5 space-y-1">
                    {report.startupsFailed.map((f) => (
                      <li
                        key={f.name}
                        className="text-[11.5px] text-[var(--color-danger)]"
                      >
                        {f.name} — {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void run()}
              className="btn-press inline-flex items-center gap-2 rounded-xl border border-[var(--color-sand)]/80 bg-white/55 px-3.5 py-2 text-[12.5px] font-medium text-[var(--color-ink)]/75 hover:bg-white/80"
            >
              再次运行
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
