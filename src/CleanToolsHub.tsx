import { ArrowLeft, ArrowRight, Broom } from "@phosphor-icons/react";
import { MODE_ORDER, MODES, type CleanMode } from "./modes";
import { MODE_ICONS } from "./modeIcons";

interface CleanToolsHubProps {
  onBack: () => void;
  onEnterMode: (mode: CleanMode) => void;
}

export default function CleanToolsHub({
  onBack,
  onEnterMode,
}: CleanToolsHubProps) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="px-6 pt-4 pb-3 flex items-start gap-3 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="btn-press mt-0.5 inline-flex size-9 items-center justify-center rounded-xl border border-[var(--color-sand)]/80 bg-white/55 text-[var(--color-ink)]/70 hover:bg-white/80"
          aria-label="返回"
        >
          <ArrowLeft size={16} weight="bold" />
        </button>
        <div className="min-w-0 flex items-center gap-2.5">
          <span className="ws-mode-icon flex size-9 items-center justify-center rounded-xl">
            <Broom size={18} weight="duotone" />
          </span>
          <div className="min-w-0">
            <h1 className="text-[1.15rem] font-semibold tracking-tight text-[var(--color-ink)]">
              清理工具
            </h1>
            <p className="mt-0.5 text-[12px] text-[var(--color-ink)]/55">
              按场景扫描并清理缓存、垃圾文件与大体积占用
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        <ul className="home-modes grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {MODE_ORDER.map((id, index) => {
            const mode = MODES[id];
            const ModeIcon = MODE_ICONS[id];
            return (
              <li
                key={id}
                className="animate-fade-up"
                style={{ animationDelay: `${40 + index * 28}ms` }}
              >
                <button
                  type="button"
                  onClick={() => onEnterMode(id)}
                  className="btn-press home-mode group w-full h-full flex items-start gap-3 rounded-2xl px-3.5 py-3.5 text-left"
                >
                  <span className="home-mode__icon mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl">
                    <ModeIcon size={18} weight="duotone" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold tracking-tight text-[var(--color-ink)] group-hover:text-[var(--color-sea)] transition-colors duration-150">
                        {mode.title}
                      </span>
                      <ArrowRight
                        size={13}
                        weight="bold"
                        className="text-[var(--color-ink)]/25 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-[var(--color-sea)] transition-[opacity,transform,color] duration-150"
                        aria-hidden
                      />
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-[var(--color-ink)]/52 line-clamp-2">
                      {mode.subtitle}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
