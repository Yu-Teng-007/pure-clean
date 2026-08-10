import { MODE_ORDER, MODES, type CleanMode } from "./modes";

interface HomeProps {
  onEnter: (mode: CleanMode) => void;
}

export default function Home({ onEnter }: HomeProps) {
  return (
    <div className="min-h-full flex flex-col">
      <header className="px-8 pt-10 pb-6 animate-fade-up">
        <p className="text-[var(--color-sea)] text-sm font-medium tracking-[0.18em] uppercase mb-2">
          Developer Disk Cleaner
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--color-ink)]">
          Pure Clean
        </h1>
        <p className="mt-2 max-w-xl text-[var(--color-ink)]/65 text-[15px] leading-relaxed">
          选择一种清理方式进入，按场景扫描并释放磁盘空间。
        </p>
      </header>

      <nav
        className="flex-1 px-8 pb-10 animate-fade-up"
        style={{ animationDelay: "80ms" }}
        aria-label="清理入口"
      >
        <ul className="max-w-xl divide-y divide-[var(--color-sand)]/70 border-y border-[var(--color-sand)]/70">
          {MODE_ORDER.map((id, index) => {
            const mode = MODES[id];
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onEnter(id)}
                  className="btn-press group w-full flex items-center gap-4 py-5 text-left hover:bg-white/40 transition-colors duration-150"
                  style={{ animationDelay: `${120 + index * 40}ms` }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-semibold tracking-tight text-[var(--color-ink)] group-hover:text-[var(--color-sea)] transition-colors duration-150">
                      {mode.title}
                    </span>
                    <span className="mt-1 block text-sm text-[var(--color-ink)]/55 leading-relaxed">
                      {mode.subtitle}
                    </span>
                  </span>
                  <span
                    className="shrink-0 text-[var(--color-ink)]/35 group-hover:text-[var(--color-sea)] group-hover:translate-x-0.5 transition-[color,transform] duration-150"
                    aria-hidden
                  >
                    →
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
