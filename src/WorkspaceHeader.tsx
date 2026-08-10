import type { ReactNode } from "react";
import { ArrowLeft } from "@phosphor-icons/react";

interface WorkspaceHeaderProps {
  title: string;
  subtitle: ReactNode;
  icon: ReactNode;
  onBack: () => void;
  backDisabled?: boolean;
  backAriaLabel?: string;
  actions?: ReactNode;
}

export default function WorkspaceHeader({
  title,
  subtitle,
  icon,
  onBack,
  backDisabled = false,
  backAriaLabel = "返回",
  actions,
}: WorkspaceHeaderProps) {
  return (
    <header className="ws-header shrink-0 px-7 pt-5 pb-4 animate-fade-up">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            disabled={backDisabled}
            className="btn-press mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--color-sand)]/80 bg-white/55 text-[var(--color-ink)]/70 hover:bg-white/80 disabled:opacity-50"
            aria-label={backAriaLabel}
          >
            <ArrowLeft size={16} weight="bold" />
          </button>
          <span className="ws-mode-icon mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl">
            {icon}
          </span>
          <div className="min-w-0 pt-0.5">
            <h1 className="text-[1.15rem] font-semibold tracking-tight text-[var(--color-ink)] leading-tight">
              {title}
            </h1>
            <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-ink)]/55">
              {subtitle}
            </p>
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
