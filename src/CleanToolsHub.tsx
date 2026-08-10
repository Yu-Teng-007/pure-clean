import { ArrowRight, Broom } from "@phosphor-icons/react";
import { MODE_ORDER, MODES, type CleanMode } from "./modes";
import { MODE_ICONS } from "./modeIcons";
import WorkspaceHeader from "./WorkspaceHeader";

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
      <WorkspaceHeader
        title="清理工具"
        subtitle="按场景扫描并清理缓存、垃圾文件与大体积占用"
        icon={<Broom size={18} weight="duotone" />}
        onBack={onBack}
      />

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
