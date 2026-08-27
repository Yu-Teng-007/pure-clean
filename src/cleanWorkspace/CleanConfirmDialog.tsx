import type { ScanItem } from "../types";
import { formatBytes } from "../types";
import { riskClass, riskLabel } from "./helpers";

interface CleanConfirmDialogProps {
  open: boolean;
  leaving: boolean;
  selectedCount: number;
  selectedBytes: number;
  confirmItems: ScanItem[];
  dangerousCount: number;
  dangerousAck: boolean;
  onDangerousAckChange: (v: boolean) => void;
  toRecycleBin: boolean;
  onToRecycleBinChange: (v: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function CleanConfirmDialog({
  open,
  leaving,
  selectedCount,
  selectedBytes,
  confirmItems,
  dangerousCount,
  dangerousAck,
  onDangerousAckChange,
  toRecycleBin,
  onToRecycleBinChange,
  onConfirm,
  onCancel,
}: CleanConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      className={[
        "fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 backdrop-blur-[2px] px-4 py-6",
        leaving ? "animate-backdrop-out" : "animate-backdrop-in",
      ].join(" ")}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className={[
          "flex w-full max-w-lg max-h-[min(88vh,640px)] flex-col rounded-2xl bg-white shadow-xl overflow-hidden",
          leaving ? "animate-modal-out" : "animate-modal-in",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-6 pt-6 pb-3">
          <h3
            id="confirm-title"
            className="text-lg font-semibold tracking-tight"
          >
            确认清理？
          </h3>
          <p className="mt-2 text-sm text-[var(--color-ink)]/70 leading-relaxed">
            将{toRecycleBin ? "移入回收站" : "永久删除"}{" "}
            <strong>{selectedCount}</strong> 项，预计释放{" "}
            <strong className="font-mono">{formatBytes(selectedBytes)}</strong>。
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-6 pb-2">
          <section
            aria-label="所选清理项"
            className="rounded-xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/35 overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--color-sand)]/50 px-3 py-2">
              <p className="text-[12px] font-semibold text-[var(--color-ink)]/75">
                所选项目
              </p>
              <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink)]/45">
                {confirmItems.length} 项
              </span>
            </div>
            <ul className="max-h-52 divide-y divide-[var(--color-sand)]/45 overflow-y-auto scroll-thin">
              {confirmItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2.5 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate font-mono text-[11.5px] text-[var(--color-ink)]/80"
                      title={item.path}
                    >
                      {item.path}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${riskClass(item.risk)}`}
                      >
                        {riskLabel(item.risk)}
                      </span>
                      {item.categoryLabel && (
                        <span className="truncate text-[10px] text-[var(--color-ink)]/42">
                          {item.categoryLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-[var(--color-ink)]/55">
                    {formatBytes(item.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {dangerousCount > 0 && (
            <div className="mt-3 rounded-xl border border-[var(--color-danger)]/30 bg-red-50 px-3.5 py-3">
              <p className="text-[12.5px] font-medium text-[var(--color-danger)]">
                含 {dangerousCount} 项高风险内容，请仔细核对
              </p>
              <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[12.5px] text-[var(--color-ink)]/80">
                <input
                  type="checkbox"
                  checked={dangerousAck}
                  onChange={(e) => onDangerousAckChange(e.target.checked)}
                  className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-danger)] focus:ring-[var(--color-danger)]/30"
                />
                <span>我了解风险，确认处理这些高风险项</span>
              </label>
            </div>
          )}

          <div className="mt-3 rounded-xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/40 p-3.5">
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-[var(--color-ink)]/80">
              <input
                type="checkbox"
                checked={toRecycleBin}
                onChange={(e) => onToRecycleBinChange(e.target.checked)}
                className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-sea)] focus:ring-[var(--color-sea)]/30"
              />
              <span>
                <span className="font-medium">移到回收站</span>
                <span className="mt-0.5 block text-[11.5px] text-[var(--color-ink)]/45">
                  代替永久删除，可从回收站恢复
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="shrink-0 flex justify-end gap-2 border-t border-[var(--color-sand)]/50 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="btn-press rounded-xl px-4 py-2 text-sm border border-[var(--color-sand)] hover:bg-[var(--color-mist)]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={dangerousCount > 0 && !dangerousAck}
            onClick={onConfirm}
            className="btn-press rounded-xl px-4 py-2 text-sm bg-[var(--color-sea)] text-white font-semibold hover:bg-[var(--color-sea-bright)] disabled:opacity-40"
          >
            {toRecycleBin ? "移入回收站" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
