import { ArrowRight, Broom } from "@phosphor-icons/react";
import { MODES, type CleanMode } from "./modes";
import { MODE_ICONS } from "./modeIcons";
import WorkspaceHeader from "./WorkspaceHeader";

interface CleanToolsHubProps {
  onBack: () => void;
  onEnterMode: (mode: CleanMode) => void;
}

const MODE_GROUPS: { title: string; modes: CleanMode[] }[] = [
  {
    title: "快速安全",
    modes: ["safe", "system"],
  },
  {
    title: "开发相关",
    modes: ["dev", "docker"],
  },
  {
    title: "深度清理",
    modes: ["large", "dupes", "stale", "installers", "advanced"],
  },
];

function modeBadge(mode: CleanMode): string | null {
  const meta = MODES[mode];
  if (meta.safeOnly) return "仅安全项";
  if (mode === "advanced") return "含系统引导";
  if (mode === "docker") return "虚拟磁盘";
  if (meta.needsThreshold) return "可调阈值";
  return null;
}

export default function CleanToolsHub({
  onBack,
  onEnterMode,
}: CleanToolsHubProps) {
  let animIndex = 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <WorkspaceHeader
        title="清理工具"
        subtitle="按场景扫描并清理缓存、垃圾文件与大体积占用"
        icon={<Broom size={18} weight="duotone" />}
        onBack={onBack}
      />

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-6 pb-6 space-y-6">
        {MODE_GROUPS.map((group, gi) => (
          <section key={group.title} className="animate-fade-up" style={{ animationDelay: `${gi * 40}ms` }}>
            <h2 className="mb-2.5 px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink)]/40">
              {group.title}
            </h2>
            <ul className="home-modes grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {group.modes.map((id) => {
                const mode = MODES[id];
                const ModeIcon = MODE_ICONS[id];
                const badge = modeBadge(id);
                const delay = 40 + animIndex++ * 24;
                return (
                  <li
                    key={id}
                    className="animate-fade-up"
                    style={{ animationDelay: `${delay}ms` }}
                  >
                    <button
                      type="button"
                      onClick={() => onEnterMode(id)}
                      className="btn-press home-mode group flex h-full w-full items-center gap-3.5 rounded-2xl px-4 py-3.5 text-left"
                    >
                      <span className="home-mode__icon flex size-9 shrink-0 items-center justify-center rounded-xl">
                        <ModeIcon size={18} weight="duotone" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold tracking-tight text-[var(--color-ink)] transition-colors duration-150 group-hover:text-[var(--color-sea)]">
                            {mode.title}
                          </span>
                          {badge && (
                            <span className="rounded-md bg-[var(--color-sea)]/8 px-1.5 py-0.5 text-[9.5px] font-medium text-[var(--color-sea)]">
                              {badge}
                            </span>
                          )}
                          <ArrowRight
                            size={13}
                            weight="bold"
                            className="-translate-x-1 text-[var(--color-ink)]/25 opacity-0 transition-[opacity,transform,color] duration-150 group-hover:translate-x-0 group-hover:text-[var(--color-sea)] group-hover:opacity-100"
                            aria-hidden
                          />
                        </span>
                        <span className="home-mode__desc mt-1 text-[12px] leading-snug text-[var(--color-ink)]/48">
                          {mode.subtitle}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
