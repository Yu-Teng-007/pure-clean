import { useEffect } from "react";
import { ClockCountdown, X } from "@phosphor-icons/react";
import { formatBytes, type HistoryEntry } from "./types";

interface HistoryDetailModalProps {
  open: boolean;
  leaving: boolean;
  entry: HistoryEntry | null;
  onClose: () => void;
}

function modeLabel(mode: string | null): string {
  if (mode === "optimize") return "一键优化";
  if (mode) return mode;
  return "手动清理";
}

export default function HistoryDetailModal({
  open,
  leaving,
  entry,
  onClose,
}: HistoryDetailModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !entry) return null;

  return (
    <div
      className={[
        "fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 backdrop-blur-[2px] px-4",
        leaving ? "animate-backdrop-out" : "animate-backdrop-in",
      ].join(" ")}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-detail-title"
        className={[
          "w-full max-w-md rounded-2xl bg-white p-5 shadow-xl",
          leaving ? "animate-modal-out" : "animate-modal-in",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-sea)]/10 text-[var(--color-sea)]">
              <ClockCountdown size={18} weight="duotone" />
            </span>
            <div>
              <h3
                id="history-detail-title"
                className="text-base font-semibold tracking-tight text-[var(--color-ink)]"
              >
                清理详情
              </h3>
              <p className="mt-1 text-[12px] font-mono text-[var(--color-ink)]/45">
                {entry.timestamp}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-press shrink-0 rounded-lg p-1.5 text-[var(--color-ink)]/45 hover:bg-[var(--color-mist)] hover:text-[var(--color-ink)]"
            aria-label="关闭"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <section className="mt-4 rounded-2xl border border-[var(--color-sea)]/20 bg-[var(--color-sea)]/8 p-4">
          <p className="text-[11px] text-[var(--color-ink)]/45">
            {entry.dryRun
              ? "模拟释放"
              : entry.toRecycleBin
                ? "已移入回收站"
                : "已释放空间"}
          </p>
          <p className="mt-0.5 font-mono text-[1.45rem] font-semibold tracking-tight text-[var(--color-sea)] tabular-nums">
            {formatBytes(entry.freedBytes)}
          </p>
        </section>

        <section className="mt-3 rounded-2xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/40 p-4">
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[11px] text-[var(--color-ink)]/45">方式</dt>
              <dd className="mt-0.5 text-[13px] font-medium text-[var(--color-ink)]">
                {modeLabel(entry.mode)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--color-ink)]/45">处理</dt>
              <dd className="mt-0.5 text-[13px] font-medium text-[var(--color-ink)]">
                {entry.dryRun
                  ? "仅模拟"
                  : entry.toRecycleBin
                    ? "回收站"
                    : "永久删除"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--color-ink)]/45">成功</dt>
              <dd className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--color-ink)]">
                {entry.successCount} 项
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-[var(--color-ink)]/45">失败</dt>
              <dd
                className={[
                  "mt-0.5 font-mono text-[15px] font-semibold",
                  entry.failureCount > 0
                    ? "text-[var(--color-danger)]"
                    : "text-[var(--color-ink)]",
                ].join(" ")}
              >
                {entry.failureCount} 项
              </dd>
            </div>
          </dl>

          {entry.byCategory?.length > 0 && (
            <ul className="mt-3 max-h-48 space-y-1.5 overflow-y-auto border-t border-[var(--color-sand)]/50 pt-3">
              {entry.byCategory.map((c) => (
                <li
                  key={c.category}
                  className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-ink)]/65"
                >
                  <span className="truncate font-medium text-[var(--color-ink)]/80">
                    {c.label}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {c.count} 项 · {formatBytes(c.freedBytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <button
          type="button"
          onClick={onClose}
          className="btn-press mt-4 w-full rounded-xl bg-[var(--color-sea)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
