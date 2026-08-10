import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowRight,
  ClockCountdown,
  HardDrive,
  HardDrives,
  Lightning,
  RocketLaunch,
  ShieldWarning,
} from "@phosphor-icons/react";
import type { AppTool } from "./appView";
import { MODE_ORDER, MODES, type CleanMode } from "./modes";
import { MODE_ICONS } from "./modeIcons";
import ProtectPathsModal from "./ProtectPathsModal";
import {
  AppConfig,
  DriveInfo,
  formatBytes,
  HistoryEntry,
} from "./types";

interface HomeProps {
  onEnterMode: (mode: CleanMode) => void;
  onOpenTool: (tool: AppTool) => void;
}

const SECONDARY_MODES = MODE_ORDER.filter((id) => id !== "safe");
const MODAL_OUT_MS = 180;

function driveLetter(name: string): string {
  const m = name.trim().match(/^([A-Za-z]):/);
  return m ? m[1].toUpperCase() : name.slice(0, 1).toUpperCase() || "?";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function Home({ onEnterMode, onOpenTool }: HomeProps) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [protectedPaths, setProtectedPaths] = useState<string[]>([]);
  const [protectInput, setProtectInput] = useState("");
  const [protectOpen, setProtectOpen] = useState(false);
  const [protectLeaving, setProtectLeaving] = useState(false);

  const persistProtected = useCallback(async (next: string[]) => {
    setProtectedPaths(next);
    try {
      const cfg = await invoke<AppConfig>("load_config");
      await invoke("save_config", {
        config: { ...cfg, protectedPaths: next },
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [d, h, cfg] = await Promise.all([
          invoke<DriveInfo[]>("list_drives"),
          invoke<HistoryEntry[]>("load_history"),
          invoke<AppConfig>("load_config"),
        ]);
        setDrives(d);
        setHistory(h.slice(0, 3));
        setProtectedPaths(cfg.protectedPaths ?? []);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const closeProtect = useCallback(() => {
    if (protectLeaving) return;
    if (prefersReducedMotion()) {
      setProtectOpen(false);
      setProtectLeaving(false);
      return;
    }
    setProtectLeaving(true);
    window.setTimeout(() => {
      setProtectOpen(false);
      setProtectLeaving(false);
    }, MODAL_OUT_MS);
  }, [protectLeaving]);

  useEffect(() => {
    if (!protectOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeProtect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [protectOpen, closeProtect]);

  const addProtected = async () => {
    const trimmed = protectInput.trim();
    if (!trimmed) {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string" && !protectedPaths.includes(picked)) {
        await persistProtected([...protectedPaths, picked]);
      }
      return;
    }
    if (!protectedPaths.includes(trimmed)) {
      await persistProtected([...protectedPaths, trimmed]);
    }
    setProtectInput("");
  };

  const safe = MODES.safe;
  const SafeIcon = MODE_ICONS.safe;

  return (
    <div className="home-shell h-full flex flex-col overflow-y-auto">
      <header className="home-header px-7 pt-6 pb-4 animate-fade-up">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[1.75rem] font-semibold tracking-[-0.03em] text-[var(--color-ink)] text-balance leading-[1.15]">
              Pure Clean
            </h1>
            <p className="mt-1.5 max-w-[36ch] text-[13.5px] leading-relaxed text-[var(--color-ink)]/60">
              按场景扫描缓存与垃圾文件，安全释放磁盘空间。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setProtectOpen(true)}
            className="btn-press shrink-0 inline-flex items-center gap-2 rounded-xl border border-[var(--color-sand)]/80 bg-white/55 px-3 py-2 text-xs font-medium text-[var(--color-ink)]/75 hover:bg-white/80 hover:text-[var(--color-ink)]"
            aria-haspopup="dialog"
          >
            <ShieldWarning size={15} weight="duotone" className="text-[var(--color-warn)]" />
            保护路径
            {protectedPaths.length > 0 && (
              <span className="rounded-md bg-[var(--color-warn)]/12 px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-warn)]">
                {protectedPaths.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="home-grid flex-1 px-7 pb-7 min-h-0">
        <main className="home-main min-w-0 flex flex-col gap-5">
          <section
            className="animate-fade-up"
            style={{ animationDelay: "50ms" }}
            aria-label="推荐清理"
          >
            <button
              type="button"
              onClick={() => onEnterMode("safe")}
              className="btn-press home-featured group w-full text-left rounded-2xl p-5 md:p-6"
            >
              <div className="flex items-start gap-4">
                <span className="home-featured__icon flex size-11 shrink-0 items-center justify-center rounded-2xl">
                  <SafeIcon size={24} weight="duotone" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xl font-semibold tracking-[-0.02em] text-white leading-tight">
                    {safe.title}
                  </span>
                  <span className="mt-1.5 block max-w-[42ch] text-[13px] leading-relaxed text-white/72">
                    {safe.subtitle}
                  </span>
                  <span className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-[13px] font-semibold text-[var(--color-sea)] group-hover:bg-[var(--color-foam)] group-active:scale-[0.98] transition-[background-color,transform] duration-150">
                    开始清理
                    <ArrowRight
                      size={15}
                      weight="bold"
                      className="transition-transform duration-150 group-hover:translate-x-0.5"
                    />
                  </span>
                </span>
              </div>
            </button>
          </section>

          <section
            className="animate-fade-up"
            style={{ animationDelay: "70ms" }}
            aria-label="系统工具"
          >
            <h2 className="mb-2.5 text-[12px] font-semibold tracking-wide text-[var(--color-ink)]/45 uppercase">
              系统工具
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <li>
                <button
                  type="button"
                  onClick={() => onOpenTool("optimize")}
                  className="btn-press home-mode group w-full h-full flex items-start gap-3 rounded-2xl px-3.5 py-3 text-left"
                >
                  <span className="home-mode__icon mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl">
                    <Lightning size={17} weight="duotone" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold tracking-tight text-[var(--color-ink)] group-hover:text-[var(--color-sea)] transition-colors duration-150">
                        智能优化
                      </span>
                      <ArrowRight
                        size={13}
                        weight="bold"
                        className="text-[var(--color-ink)]/25 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-[var(--color-sea)] transition-[opacity,transform,color] duration-150"
                        aria-hidden
                      />
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-[var(--color-ink)]/52 line-clamp-2">
                      一键安全清理并建议禁用非必要开机项
                    </span>
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenTool("startup")}
                  className="btn-press home-mode group w-full h-full flex items-start gap-3 rounded-2xl px-3.5 py-3 text-left"
                >
                  <span className="home-mode__icon mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl">
                    <RocketLaunch size={17} weight="duotone" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold tracking-tight text-[var(--color-ink)] group-hover:text-[var(--color-sea)] transition-colors duration-150">
                        开机项管理
                      </span>
                      <ArrowRight
                        size={13}
                        weight="bold"
                        className="text-[var(--color-ink)]/25 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-[var(--color-sea)] transition-[opacity,transform,color] duration-150"
                        aria-hidden
                      />
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-[var(--color-ink)]/52 line-clamp-2">
                      查看并启用/禁用注册表与 Startup 启动项
                    </span>
                  </span>
                </button>
              </li>
            </ul>
          </section>

          <nav
            className="animate-fade-up min-h-0"
            style={{ animationDelay: "90ms" }}
            aria-label="更多清理方式"
          >
            <ul className="home-modes grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {SECONDARY_MODES.map((id, index) => {
                const mode = MODES[id];
                const ModeIcon = MODE_ICONS[id];
                return (
                  <li
                    key={id}
                    style={{ animationDelay: `${110 + index * 28}ms` }}
                  >
                    <button
                      type="button"
                      onClick={() => onEnterMode(id)}
                      className="btn-press home-mode group w-full h-full flex items-start gap-3 rounded-2xl px-3.5 py-3 text-left"
                    >
                      <span className="home-mode__icon mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl">
                        <ModeIcon size={17} weight="duotone" />
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
          </nav>
        </main>

        <aside
          className="home-aside flex flex-col gap-4 animate-fade-up"
          style={{ animationDelay: "70ms" }}
        >
          <section aria-label="磁盘空间" className="home-panel rounded-2xl p-4">
            <div className="mb-3 flex items-center gap-2">
              <HardDrives size={15} weight="duotone" className="text-[var(--color-sea)]" />
              <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
                磁盘空间
              </h2>
            </div>
            {drives.length > 0 ? (
              <ul className="space-y-3.5">
                {drives.map((drive) => {
                  const used = Math.max(0, drive.totalBytes - drive.freeBytes);
                  const pct =
                    drive.totalBytes > 0
                      ? Math.min(100, (used / drive.totalBytes) * 100)
                      : 0;
                  const tight = pct >= 90;
                  return (
                    <li key={drive.name}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <span
                            className="home-drive-icon relative flex size-7 shrink-0 items-center justify-center rounded-lg"
                            aria-hidden
                          >
                            <HardDrive size={16} weight="duotone" />
                            <span className="home-drive-letter absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-[4px] font-mono text-[8px] font-bold leading-none">
                              {driveLetter(drive.name)}
                            </span>
                          </span>
                          <span className="truncate text-[13px] font-semibold font-mono tracking-tight">
                            {drive.name}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] font-mono text-[var(--color-ink)]/50">
                          可用 {formatBytes(drive.freeBytes)}
                        </span>
                      </div>
                      <div
                        className="home-disk-track"
                        role="meter"
                        aria-valuenow={Math.round(pct)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${drive.name} 已用 ${Math.round(pct)}%`}
                      >
                        <div
                          className={`home-disk-fill ${tight ? "home-disk-fill--tight" : ""}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10.5px] font-mono text-[var(--color-ink)]/40">
                        {formatBytes(used)} / {formatBytes(drive.totalBytes)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[12px] text-[var(--color-ink)]/45">
                正在读取磁盘信息…
              </p>
            )}
          </section>

          <section
            aria-label="最近清理"
            className="home-panel rounded-2xl p-4 flex-1 min-h-0"
          >
            <div className="mb-3 flex items-center gap-2">
              <ClockCountdown
                size={15}
                weight="duotone"
                className="text-[var(--color-sea)]"
              />
              <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
                最近清理
              </h2>
            </div>
            {history.length > 0 ? (
              <ul className="divide-y divide-[var(--color-sand)]/50">
                {history.map((h) => (
                  <li key={h.id} className="py-2.5 first:pt-0 last:pb-0">
                    <p className="text-[12.5px] font-medium text-[var(--color-ink)]/80">
                      {h.dryRun ? "模拟释放 " : "释放 "}
                      <span className="font-mono text-[var(--color-sea)]">
                        {formatBytes(h.freedBytes)}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] font-mono text-[var(--color-ink)]/42">
                      {h.timestamp}
                      {h.failureCount > 0
                        ? ` · 失败 ${h.failureCount}`
                        : ` · 成功 ${h.successCount}`}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] leading-relaxed text-[var(--color-ink)]/45">
                完成一次清理后，这里会显示最近记录。
              </p>
            )}
          </section>
        </aside>
      </div>

      <ProtectPathsModal
        open={protectOpen}
        leaving={protectLeaving}
        paths={protectedPaths}
        input={protectInput}
        onInputChange={setProtectInput}
        onAdd={() => void addProtected()}
        onRemove={(p) =>
          void persistProtected(protectedPaths.filter((x) => x !== p))
        }
        onClose={closeProtect}
      />
    </div>
  );
}
