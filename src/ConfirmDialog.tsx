import { useEffect, type ReactNode } from "react";
import { Warning } from "@phosphor-icons/react";

interface ConfirmDialogProps {
  open: boolean;
  leaving: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  leaving,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  variant = "default",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open || busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onConfirm, onCancel]);

  if (!open) return null;

  const danger = variant === "danger";

  return (
    <div
      className={[
        "fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 backdrop-blur-[2px] px-4",
        leaving ? "animate-backdrop-out" : "animate-backdrop-in",
      ].join(" ")}
      onClick={busy ? undefined : onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className={[
          "w-full max-w-md rounded-2xl bg-white p-5 shadow-xl",
          leaving ? "animate-modal-out" : "animate-modal-in",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            className={[
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
              danger
                ? "bg-red-50 text-[var(--color-danger)]"
                : "bg-[var(--color-sea)]/10 text-[var(--color-sea)]",
            ].join(" ")}
          >
            <Warning size={18} weight="duotone" />
          </span>
          <div className="min-w-0 flex-1">
            <h3
              id="confirm-dialog-title"
              className="text-base font-semibold tracking-tight text-[var(--color-ink)]"
            >
              {title}
            </h3>
            <div
              id="confirm-dialog-desc"
              className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink)]/65"
            >
              {description}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="btn-press rounded-xl border border-[var(--color-sand)] px-4 py-2 text-[13px] font-medium hover:bg-[var(--color-mist)] disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={[
              "btn-press rounded-xl px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40",
              danger
                ? "bg-[var(--color-danger)] hover:bg-red-700"
                : "bg-[var(--color-sea)] hover:bg-[var(--color-sea-bright)]",
            ].join(" ")}
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
