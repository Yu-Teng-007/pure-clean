import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowCounterClockwise, ClockCountdown, X } from "@phosphor-icons/react";
import { cleanModeLabel } from "./modes";
import { formatFriendlyTimestamp } from "./formatTime";
import {
  formatBytes,
  type HistoryEntry,
  type RestoreReport,
} from "./types";
import { showToast } from "./Toast";

interface HistoryDetailModalProps {
  open: boolean;
  leaving: boolean;
  entry: HistoryEntry | null;
  onClose: () => void;
  onRestored?: (entry: HistoryEntry) => void;
}

export default function HistoryDetailModal({
  open,
  leaving,
  entry,
  onClose,
  onRestored,
}: HistoryDetailModalProps) {
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRestoreMsg(null);
    setRestoreError(null);
    setRestoring(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, entry?.id]);

  if (!open || !entry) return null;

  const canRestore =
    !entry.dryRun &&
    entry.toRecycleBin &&
    !entry.restored &&
    (entry.cleanedItems?.length ?? 0) > 0;

  const restoreHint = entry.restored
    ? "已从回收站恢复"
    : entry.dryRun
      ? "模拟清理无法恢复"
      : !entry.toRecycleBin
        ? "永久删除无法恢复"
        : !(entry.cleanedItems?.length)
          ? "旧版记录缺少路径明细，无法自动恢复"
          : null;

  const handleRestore = async () => {
    if (!canRestore || restoring) return;
    setRestoring(true);
    setRestoreMsg(null);
    setRestoreError(null);
    try {
      const report = await invoke<RestoreReport>("restore_history", {
        id: entry.id,
      });
      if (report.restoredCount > 0) {
        setRestoreMsg(`已恢复 ${report.restoredCount} 项`);
        onRestored?.({ ...entry, restored: true });
        showToast(`已从回收站恢复 ${report.restoredCount} 项`);
      }
      if (report.failures.length > 0) {
        setRestoreError(
          report.failures
            .slice(0, 3)
            .map((f) => `${f.path}: ${f.error}`)
            .join("；"),
        );
      }
    } catch (e) {
      setRestoreError(String(e));
    } finally {
      setRestoring(false);
    }
  };

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
          "w-full max-w-md rounded-2xl bg-white p-5 shadow-xl max-h-[min(88vh,640px)] overflow-y-auto scroll-thin",
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
              <p className="mt-1 text-[12px] font-mono text-[var(--color-ink)]/45" title={entry.timestamp}>
                {formatFriendlyTimestamp(entry.timestamp)}
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
                {cleanModeLabel(entry.mode)}
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
                {entry.restored ? " · 已恢复" : ""}
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

        {(restoreMsg || restoreError || restoreHint) && (
          <p
            className={[
              "mt-3 rounded-xl px-3 py-2 text-[12px] border",
              restoreError
                ? "border-red-200 bg-red-50 text-[var(--color-danger)]"
                : restoreMsg
                  ? "border-[var(--color-sea)]/25 bg-[var(--color-sea)]/8 text-[var(--color-sea)]"
                  : "border-[var(--color-sand)]/60 bg-[var(--color-mist)]/50 text-[var(--color-ink)]/55",
            ].join(" ")}
          >
            {restoreError ?? restoreMsg ?? restoreHint}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {canRestore && (
            <button
              type="button"
              disabled={restoring}
              onClick={() => void handleRestore()}
              className="btn-press inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--color-sea)]/30 bg-[var(--color-sea)]/10 px-4 py-2.5 text-[13px] font-semibold text-[var(--color-sea)] hover:bg-[var(--color-sea)]/15 disabled:opacity-50"
            >
              <ArrowCounterClockwise size={15} weight="bold" />
              {restoring ? "恢复中…" : "从回收站恢复"}
            </button>
          )}
          {entry.toRecycleBin && (
            <button
              type="button"
              onClick={() => void invoke("open_recycle_bin").catch(() => {})}
              className="btn-press w-full rounded-xl border border-[var(--color-sand)] px-4 py-2 text-[12.5px] font-medium text-[var(--color-ink)]/70 hover:bg-[var(--color-mist)]"
            >
              打开系统回收站
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="btn-press w-full rounded-xl bg-[var(--color-sea)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
