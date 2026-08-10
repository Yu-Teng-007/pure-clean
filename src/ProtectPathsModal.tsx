import { Plus, ShieldWarning, X } from "@phosphor-icons/react";

interface ProtectPathsModalProps {
  open: boolean;
  leaving: boolean;
  paths: string[];
  input: string;
  onInputChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (path: string) => void;
  onClose: () => void;
}

export default function ProtectPathsModal({
  open,
  leaving,
  paths,
  input,
  onInputChange,
  onAdd,
  onRemove,
  onClose,
}: ProtectPathsModalProps) {
  if (!open) return null;

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
        aria-labelledby="protect-title"
        className={[
          "w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl",
          leaving ? "animate-modal-out" : "animate-modal-in",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-[var(--color-warn)]">
              <ShieldWarning size={18} weight="duotone" />
            </span>
            <div>
              <h3
                id="protect-title"
                className="text-base font-semibold tracking-tight text-[var(--color-ink)]"
              >
                保护路径
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink)]/55">
                列入保护的目录永不扫描、永不删除。
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

        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <input
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAdd()}
            placeholder="输入路径，或留空点添加以浏览"
            autoFocus
            className="home-input flex-1 min-w-[200px] rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-xs font-mono text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink)]/40 focus:border-[var(--color-sea-bright)]"
          />
          <button
            type="button"
            onClick={onAdd}
            className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-xs font-medium hover:bg-[var(--color-mist)]"
          >
            <Plus size={14} weight="bold" />
            添加
          </button>
        </div>

        <div className="mt-4 max-h-[40vh] overflow-y-auto">
          {paths.length > 0 ? (
            <ul className="space-y-2">
              {paths.map((p) => (
                <li
                  key={p}
                  className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-mono text-[var(--color-warn)]"
                >
                  <span className="min-w-0 flex-1 truncate" title={p}>
                    {p}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(p)}
                    className="btn-press shrink-0 rounded-md p-1 hover:bg-amber-500/15 hover:text-[var(--color-danger)]"
                    aria-label={`移除保护 ${p}`}
                  >
                    <X size={12} weight="bold" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-[var(--color-sand)] px-3 py-6 text-center text-[12px] text-[var(--color-ink)]/40">
              暂无保护路径
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn-press rounded-xl bg-[var(--color-sea)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-sea-bright)]"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
