import { useEffect, useState } from "react";
import {
  CaretDown,
  CheckCircle,
  Lightning,
  MouseRightClick,
  ShieldCheck,
  X,
} from "@phosphor-icons/react";
import type {
  ContextMenuItem,
  ContextMenuOptimizeReport,
  StartupFailure,
} from "./types";

export type ContextMenuOptimizePhase = "confirm" | "running" | "done" | "error";

const OPTIMIZE_STAGES = [
  "扫描右键菜单",
  "识别可优化项",
  "禁用菜单项",
  "完成",
] as const;

interface ContextMenuOptimizeModalProps {
  open: boolean;
  leaving: boolean;
  phase: ContextMenuOptimizePhase;
  suggestItems: ContextMenuItem[];
  runStage: number;
  runProgress: number;
  report: ContextMenuOptimizeReport | null;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
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

function ContextMenuItemRow({
  item,
  subdued,
}: {
  item: ContextMenuItem;
  subdued?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-sand)]/70 bg-white/70"
        aria-hidden
      >
        {item.iconDataUrl ? (
          <img
            src={item.iconDataUrl}
            alt=""
            className="size-6 object-contain"
            draggable={false}
          />
        ) : (
          <MouseRightClick
            size={15}
            weight="duotone"
            className="text-[var(--color-ink)]/35"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={[
            "text-[13px] font-medium",
            subdued ? "text-[var(--color-ink)]/70" : "text-[var(--color-ink)]",
          ].join(" ")}
        >
          {item.name}
        </p>
        <p
          className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-ink)]/42"
          title={item.handler}
        >
          {item.handler}
        </p>
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

export default function ContextMenuOptimizeModal({
  open,
  leaving,
  phase,
  suggestItems,
  runStage,
  runProgress,
  report,
  error,
  onClose,
  onConfirm,
  onRetry,
}: ContextMenuOptimizeModalProps) {
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
  const canConfirm = suggestItems.length > 0;

  const toggleFailure = (id: string) => {
    setExpandedFailures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const subtitle =
    phase === "confirm"
      ? canConfirm
        ? `将禁用 ${suggestItems.length} 项第三方右键菜单`
        : "当前没有需要自动禁用的右键菜单项"
      : busy
        ? "正在按规则禁用可优化项…"
        : phase === "done"
          ? disabled.length > 0
            ? `已成功禁用 ${disabled.length} 项`
            : "右键菜单状态良好，无需调整"
          : phase === "error"
            ? "优化未能完成，可重试"
            : "保留系统与安全组件，仅禁用建议项";

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
        aria-labelledby="context-menu-optimize-title"
        aria-busy={busy}
        className={[
          "optimize-modal w-full max-w-lg max-h-[min(88vh,680px)] flex flex-col rounded-2xl bg-white shadow-xl overflow-hidden",
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
                id="context-menu-optimize-title"
                className="text-base font-semibold tracking-tight text-[var(--color-ink)]"
              >
                智能优化右键菜单
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink)]/55">
                {subtitle}
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
          {phase === "confirm" && (
            <div className="space-y-4 animate-fade-up">
              <div className="flex items-start gap-2.5 rounded-xl border border-[var(--color-sea)]/18 bg-[var(--color-sea)]/6 px-3.5 py-3">
                <ShieldCheck
                  size={18}
                  weight="duotone"
                  className="mt-0.5 shrink-0 text-[var(--color-sea)]"
                  aria-hidden
                />
                <p className="text-[12.5px] leading-relaxed text-[var(--color-ink)]/62">
                  将保留 Windows 安全、压缩/同步等常用组件；主要禁用第三方扩展与更新程序注入的右键项。修改本机注册表项可能需要管理员权限。你可随时在本页重新启用。
                </p>
              </div>

              {canConfirm ? (
                <section>
                  <h4 className="text-[13px] font-semibold text-[var(--color-ink)]">
                    即将禁用
                    <span className="ml-2 font-mono text-[12px] text-[var(--color-sea)]">
                      {suggestItems.length}
                    </span>
                  </h4>
                  <ul className="mt-2 max-h-[min(36vh,280px)] overflow-y-auto scroll-thin divide-y divide-[var(--color-sand)]/45 rounded-xl border border-[var(--color-sand)]/60 bg-[var(--color-mist)]/25">
                    {suggestItems.map((s, i) => (
                      <li
                        key={s.id}
                        className="px-3 py-2.5 animate-fade-up"
                        style={{ animationDelay: `${Math.min(i, 10) * 24}ms` }}
                      >
                        <ContextMenuItemRow item={s} />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : (
                <div className="ws-empty rounded-2xl px-5 py-10 text-center">
                  <CheckCircle
                    size={32}
                    weight="duotone"
                    className="mx-auto text-[var(--color-sea)]/55"
                    aria-hidden
                  />
                  <p className="mt-3 text-[13px] font-medium text-[var(--color-ink)]/65">
                    右键菜单已处于较优状态
                  </p>
                  <p className="mt-1 text-[12.5px] text-[var(--color-ink)]/45">
                    没有标记为「可优化」且仍启用的项目
                  </p>
                </div>
              )}
            </div>
          )}

          {(phase === "running" || phase === "done") && (
            <div className="space-y-3 animate-fade-up">
              <div className="flex flex-wrap gap-2">
                {OPTIMIZE_STAGES.map((label, i) => {
                  const done = phase === "done" || i < runStage;
                  const current = phase === "running" && i === runStage;
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
                          优化中
                        </p>
                        <p className="font-mono text-[13px] tabular-nums text-[var(--color-sea)]">
                          {Math.round(runProgress)}%
                        </p>
                      </div>
                      <div className="progress-track h-2">
                        <div
                          className="progress-fill"
                          style={{ width: `${runProgress}%` }}
                        />
                      </div>
                      <p
                        key={OPTIMIZE_STAGES[runStage]}
                        className="mt-2 text-[12px] text-[var(--color-ink)]/55 animate-fade-up truncate"
                      >
                        <span className="animate-pulse-soft">
                          {OPTIMIZE_STAGES[runStage]}…
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="scan-rail" aria-hidden />
                </>
              )}
            </div>
          )}

          {phase === "done" && report && (
            <div className="space-y-4 animate-fade-up">
              <section
                className={[
                  "rounded-2xl border p-4",
                  disabled.length > 0
                    ? "border-[var(--color-sea)]/20 bg-[var(--color-sea)]/8 animate-success-glow"
                    : "border-[var(--color-sand)]/70 bg-[var(--color-mist)]/35",
                ].join(" ")}
              >
                <div className="flex items-start gap-3">
                  {disabled.length > 0 ? <SuccessCheck /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-[var(--color-ink)]/45">
                      {disabled.length > 0 ? "已禁用右键菜单项" : "优化结果"}
                    </p>
                    <p
                      className={[
                        "mt-0.5 font-mono text-[1.45rem] font-semibold tracking-tight tabular-nums",
                        disabled.length > 0
                          ? "text-[var(--color-sea)] animate-freed-flash"
                          : "text-[var(--color-ink)]",
                      ].join(" ")}
                    >
                      {disabled.length}
                      <span className="ml-1.5 text-[13px] font-medium text-[var(--color-ink)]/45">
                        项
                      </span>
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/40 p-4">
                <h4 className="text-[13px] font-semibold text-[var(--color-ink)]">
                  优化报告
                </h4>
                <dl className="mt-3 grid grid-cols-3 gap-3">
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
              </section>

              {report.disabled.length > 0 ? (
                <section>
                  <h4 className="text-[13px] font-semibold text-[var(--color-ink)]">
                    已禁用列表
                  </h4>
                  <ul className="mt-2 divide-y divide-[var(--color-sand)]/45 rounded-xl border border-[var(--color-sand)]/60 bg-[var(--color-mist)]/25">
                    {report.disabled.map((s) => (
                      <li key={s.id} className="px-3 py-2.5">
                        <ContextMenuItemRow item={s} subdued />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : (
                <p className="text-[12.5px] text-[var(--color-ink)]/45">
                  可优化项均已禁用，或当前启发式规则未标记新的目标。
                </p>
              )}

              {report.failed.length > 0 && (
                <section className="border-t border-[var(--color-sand)]/50 pt-3">
                  <p className="text-[12px] font-medium text-[var(--color-warn)]">
                    部分右键菜单项未能禁用
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {report.failed.map((f: StartupFailure) => {
                      const id = `context-menu:${f.name}`;
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
            </div>
          )}
        </div>

        <div
          className={[
            "shrink-0 flex flex-wrap items-center gap-2 border-t border-[var(--color-sand)]/50 px-5 py-4",
            phase !== "running" ? "animate-footer-rise" : "",
          ].join(" ")}
        >
          {phase === "confirm" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="btn-press inline-flex items-center gap-2 rounded-xl border border-[var(--color-sand)]/80 bg-white px-3.5 py-2 text-[12.5px] font-medium text-[var(--color-ink)]/75 hover:bg-[var(--color-mist)]"
              >
                取消
              </button>
              {canConfirm ? (
                <button
                  type="button"
                  onClick={onConfirm}
                  className="btn-press inline-flex items-center gap-2 rounded-xl bg-[var(--color-sea)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
                >
                  <Lightning size={14} weight="bold" />
                  确认优化
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-press inline-flex items-center gap-2 rounded-xl bg-[var(--color-sea)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
                >
                  知道了
                </button>
              )}
            </>
          )}

          {phase === "done" && (
            <>
              {suggestItems.length > 0 || disabled.length > 0 ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="btn-press inline-flex items-center gap-2 rounded-xl border border-[var(--color-sand)]/80 bg-white px-3.5 py-2 text-[12.5px] font-medium text-[var(--color-ink)]/75 hover:bg-[var(--color-mist)]"
                >
                  再次检查
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="btn-press inline-flex items-center gap-2 rounded-xl bg-[var(--color-sea)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
              >
                完成
              </button>
            </>
          )}

          {phase === "error" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="btn-press inline-flex items-center gap-2 rounded-xl border border-[var(--color-sand)]/80 bg-white px-3.5 py-2 text-[12.5px] font-medium text-[var(--color-ink)]/75 hover:bg-[var(--color-mist)]"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="btn-press inline-flex items-center gap-2 rounded-xl bg-[var(--color-sea)] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
              >
                重试
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
