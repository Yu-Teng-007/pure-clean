import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowRight,
  ArrowsClockwise,
  Broom,
  ChartBar,
  ChartPie,
  ClockCountdown,
  Cpu,
  GearSix,
  HardDrives,
  Lightning,
  Memory,
  MouseRightClick,
  RocketLaunch,
  ShieldWarning,
  WarningCircle,
} from "@phosphor-icons/react";
import { MODAL_OUT_MS, closeWithAnimation } from "./motion";
import { formatRelativeTime, timeGreeting } from "./formatTime";
import { showToast } from "./Toast";
import type { AppTool } from "./appView";
import AppIcon from "./AppIcon";
import HistoryDetailModal from "./HistoryDetailModal";
import OptimizeModal from "./OptimizeModal";
import ProtectPathsModal from "./ProtectPathsModal";
import {
  AppConfig,
  DriveInfo,
  formatBytes,
  HistoryEntry,
} from "./types";

interface HomeProps {
  onOpenTool: (tool: AppTool) => void;
}

const HOME_TOOLS: {
  id: AppTool;
  title: string;
  desc: string;
  Icon: typeof Broom;
}[] = [
  {
    id: "cleanHub",
    title: "清理工具",
    desc: "按场景清理缓存与垃圾，腾出磁盘空间",
    Icon: Broom,
  },
  {
    id: "devCache",
    title: "开发缓存看板",
    desc: "按工具与项目查看可释放占用",
    Icon: ChartBar,
  },
  {
    id: "diskAnalyzer",
    title: "磁盘空间分析",
    desc: "层层下钻，定位空间真正去向",
    Icon: ChartPie,
  },
  {
    id: "startup",
    title: "开机项管理",
    desc: "管理自启程序，减轻开机负担",
    Icon: RocketLaunch,
  },
  {
    id: "contextMenu",
    title: "右键菜单管理",
    desc: "精简资源管理器右键，减少第三方扩展",
    Icon: MouseRightClick,
  },
  {
    id: "memory",
    title: "内存清理",
    desc: "看清占用，一键释放可用内存",
    Icon: Memory,
  },
  {
    id: "hardware",
    title: "硬件信息",
    desc: "一览本机 CPU、内存、显卡与磁盘",
    Icon: Cpu,
  },
];

function driveLetter(name: string): string {
  const m = name.trim().match(/^([A-Za-z]):/);
  return m ? m[1].toUpperCase() : name.slice(0, 1).toUpperCase() || "?";
}

export default function Home({ onOpenTool }: HomeProps) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [totalFreedBytes, setTotalFreedBytes] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [protectedPaths, setProtectedPaths] = useState<string[]>([]);
  const [protectInput, setProtectInput] = useState("");
  const [protectOpen, setProtectOpen] = useState(false);
  const [protectLeaving, setProtectLeaving] = useState(false);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimizeLeaving, setOptimizeLeaving] = useState(false);
  const [historyDetail, setHistoryDetail] = useState<HistoryEntry | null>(
    null,
  );
  const [historyDetailOpen, setHistoryDetailOpen] = useState(false);
  const [historyDetailLeaving, setHistoryDetailLeaving] = useState(false);

  const refreshHomeStats = useCallback(async () => {
    setRefreshing(true);
    try {
      const [d, h] = await Promise.all([
        invoke<DriveInfo[]>("list_drives"),
        invoke<HistoryEntry[]>("load_history"),
      ]);
      setDrives(d);
      setHistory(h.slice(0, 3));
      setHistoryCount(h.length);
      setTotalFreedBytes(
        h.reduce((sum, entry) => sum + (entry.dryRun ? 0 : entry.freedBytes), 0),
      );
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false);
    }
  }, []);

  // keep toast available for refresh feedback
  const refreshWithToast = useCallback(async () => {
    await refreshHomeStats();
    showToast("已刷新磁盘与历史");
  }, [refreshHomeStats]);

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
        setHistoryCount(h.length);
        setTotalFreedBytes(
          h.reduce((sum, entry) => sum + (entry.dryRun ? 0 : entry.freedBytes), 0),
        );
        setProtectedPaths(cfg.protectedPaths ?? []);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    const onFocus = () => void refreshHomeStats();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshHomeStats]);

  const closeProtect = useCallback(() => {
    if (protectLeaving) return;
    closeWithAnimation(setProtectLeaving, () => {
      setProtectOpen(false);
      setProtectLeaving(false);
    });
  }, [protectLeaving]);

  const closeOptimize = useCallback(() => {
    if (optimizeLeaving) return;
    closeWithAnimation(setOptimizeLeaving, () => {
      setOptimizeOpen(false);
      setOptimizeLeaving(false);
    });
  }, [optimizeLeaving]);

  const openHistoryDetail = useCallback((entry: HistoryEntry) => {
    setHistoryDetail(entry);
    setHistoryDetailLeaving(false);
    setHistoryDetailOpen(true);
  }, []);

  const closeHistoryDetail = useCallback(() => {
    if (historyDetailLeaving) return;
    closeWithAnimation(setHistoryDetailLeaving, () => {
      setHistoryDetailOpen(false);
      setHistoryDetailLeaving(false);
      setHistoryDetail(null);
    });
  }, [historyDetailLeaving]);

  const tightDrives = drives.filter((drive) => {
    const used = Math.max(0, drive.totalBytes - drive.freeBytes);
    const pct = drive.totalBytes > 0 ? (used / drive.totalBytes) * 100 : 0;
    return pct >= 90;
  });

  useEffect(() => {
    if (!protectOpen || optimizeOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeProtect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [protectOpen, optimizeOpen, closeProtect]);

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

  return (
    <div className="home-shell h-full flex flex-col overflow-y-auto">
      <header className="home-topbar animate-fade-up mx-6 mt-5 mb-1">
        <div className="home-topbar__inner flex items-center gap-4 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <AppIcon size={32} className="rounded-[9px] shadow-sm ring-1 ring-black/[0.04]" />
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-ink)] leading-none">
                净界
              </h1>
              <p className="mt-0.5 truncate text-[11.5px] text-[var(--color-ink)]/50">
                {timeGreeting()}
              </p>
            </div>
          </div>

          {historyCount > 0 && (
            <>
              <span className="home-topbar__divider hidden sm:block" aria-hidden />
              <div className="hidden sm:flex items-center gap-5">
                <div className="home-metric">
                  <span className="home-metric__label">累计释放</span>
                  <span className="home-metric__value font-mono text-[var(--color-sea)]">
                    {formatBytes(totalFreedBytes)}
                  </span>
                </div>
                <div className="home-metric">
                  <span className="home-metric__label">清理次数</span>
                  <span className="home-metric__value font-mono">
                    {historyCount}
                  </span>
                </div>
              </div>
            </>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void refreshWithToast()}
              disabled={refreshing}
              className="home-topbar__btn btn-press"
              aria-label="刷新数据"
              title="刷新磁盘与历史"
            >
              <ArrowsClockwise
                size={16}
                weight="bold"
                className={refreshing ? "animate-spin-orbit" : ""}
              />
            </button>
            <button
              type="button"
              onClick={() => onOpenTool("settings")}
              className="home-topbar__btn btn-press"
              aria-label="设置"
              title="设置"
            >
              <GearSix size={16} weight="duotone" />
            </button>
            <button
              type="button"
              onClick={() => setProtectOpen(true)}
              className="home-topbar__btn btn-press relative"
              aria-haspopup="dialog"
              aria-label="保护路径"
            >
              <ShieldWarning size={16} weight="duotone" className="text-[var(--color-warn)]" />
              {protectedPaths.length > 0 && (
                <span className="home-topbar__badge font-mono">
                  {protectedPaths.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="home-grid flex-1 px-6 min-h-0">
        {tightDrives.length > 0 && (
          <section
            className="home-warning home-grid__alert animate-fade-up rounded-2xl px-4 py-3"
            style={{ animationDelay: "20ms" }}
            aria-label="磁盘空间预警"
          >
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="flex min-w-0 items-center gap-2.5">
                <WarningCircle
                  size={18}
                  weight="duotone"
                  className="shrink-0 text-[var(--color-warn)]"
                />
                <p className="text-[12.5px] font-medium text-[var(--color-ink)]">
                  {tightDrives.length === 1
                    ? `${tightDrives[0].name} 可用空间低于 10%`
                    : `${tightDrives.length} 个磁盘可用空间低于 10%`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenTool("diskAnalyzer")}
                className="btn-press inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--color-warn)] hover:bg-white/60"
              >
                分析磁盘
                <ArrowRight size={11} weight="bold" />
              </button>
            </div>
          </section>
        )}

        <div className="home-main flex min-w-0 flex-col gap-3">
          <section
            className="animate-fade-up"
            style={{ animationDelay: "40ms" }}
            aria-label="智能优化"
          >
            <button
              type="button"
              onClick={() => setOptimizeOpen(true)}
              className="btn-press home-featured group w-full text-left rounded-[1.25rem] p-5 md:p-6"
              aria-haspopup="dialog"
            >
              <div className="home-featured__glow" aria-hidden />
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3.5">
                  <span className="home-featured__icon flex size-11 shrink-0 items-center justify-center rounded-2xl">
                    <Lightning size={24} weight="duotone" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xl font-semibold tracking-[-0.03em] text-white leading-tight">
                      智能优化
                    </span>
                    <span className="mt-1.5 block max-w-[36ch] text-[13px] leading-relaxed text-white/70">
                      一键安全清理，并建议禁用非必要开机项
                    </span>
                  </span>
                </div>
                <span className="home-featured__cta inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold">
                  开始体检优化
                  <ArrowRight
                    size={15}
                    weight="bold"
                    className="transition-transform duration-150 group-hover:translate-x-0.5"
                  />
                </span>
              </div>

              {historyCount > 0 && (
                <div className="home-featured__stats relative mt-4 flex gap-6 border-t border-white/10 pt-3.5 sm:hidden">
                  <div className="home-metric home-metric--on-dark">
                    <span className="home-metric__label">累计释放</span>
                    <span className="home-metric__value font-mono">
                      {formatBytes(totalFreedBytes)}
                    </span>
                  </div>
                  <div className="home-metric home-metric--on-dark">
                    <span className="home-metric__label">清理次数</span>
                    <span className="home-metric__value font-mono">{historyCount}</span>
                  </div>
                </div>
              )}
            </button>
          </section>

          <nav
            className="animate-fade-up min-h-0"
            style={{ animationDelay: "60ms" }}
            aria-label="工具"
          >
            <ul className="home-tools">
              {HOME_TOOLS.map(({ id, title, desc, Icon }) => (
                <li key={id} className="home-tools__cell">
                  <button
                    type="button"
                    onClick={() => onOpenTool(id)}
                    className="btn-press home-mode group flex h-full w-full items-center gap-3.5 rounded-[1rem] px-4 py-3.5 text-left"
                  >
                    <span className="home-mode__icon flex size-9 shrink-0 items-center justify-center rounded-xl">
                      <Icon size={18} weight="duotone" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-[var(--color-ink)] transition-colors duration-150 group-hover:text-[var(--color-sea)]">
                          {title}
                        </span>
                        <ArrowRight
                          size={12}
                          weight="bold"
                          className="-translate-x-1 text-[var(--color-ink)]/20 opacity-0 transition-[opacity,transform,color] duration-150 group-hover:translate-x-0 group-hover:text-[var(--color-sea)] group-hover:opacity-100"
                          aria-hidden
                        />
                      </span>
                      <span className="home-mode__desc mt-0.5 block text-[11.5px] leading-snug text-[var(--color-ink)]/44">
                        {desc}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <aside className="home-aside flex flex-col gap-3 animate-fade-up" style={{ animationDelay: "50ms" }}>
          <section aria-label="磁盘空间" className="home-panel home-panel--glass rounded-[1.25rem] p-4">
            <div className="mb-3.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HardDrives size={15} weight="duotone" className="text-[var(--color-sea)]" />
                <h2 className="text-[12.5px] font-semibold tracking-tight text-[var(--color-ink)]">
                  磁盘空间
                </h2>
              </div>
              {drives.length > 0 && (
                <span className="text-[10px] font-mono text-[var(--color-ink)]/35">
                  {drives.length} 个分区
                </span>
              )}
            </div>
            {drives.length > 0 ? (
              <ul className="space-y-2">
                {drives.map((drive) => {
                  const used = Math.max(0, drive.totalBytes - drive.freeBytes);
                  const pct =
                    drive.totalBytes > 0
                      ? Math.min(100, (used / drive.totalBytes) * 100)
                      : 0;
                  const tight = pct >= 90;
                  return (
                    <li key={drive.name}>
                      <button
                        type="button"
                        onClick={() => onOpenTool("diskAnalyzer")}
                        className="home-drive-row btn-press w-full rounded-xl px-2.5 py-2.5 text-left"
                        title="点击查看磁盘空间分析"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="home-drive-ring shrink-0"
                            role="meter"
                            aria-valuenow={Math.round(pct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${drive.name} 已用 ${Math.round(pct)}%`}
                            style={{ "--drive-pct": `${pct}%` } as CSSProperties}
                          >
                            <span className="home-drive-ring__label font-mono">
                              {driveLetter(drive.name)}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[12.5px] font-semibold font-mono tracking-tight">
                                {drive.name}
                              </span>
                              <span
                                className={[
                                  "shrink-0 text-[10.5px] font-mono tabular-nums",
                                  tight
                                    ? "font-semibold text-[var(--color-warn)]"
                                    : "text-[var(--color-ink)]/45",
                                ].join(" ")}
                              >
                                {Math.round(pct)}%
                              </span>
                            </div>
                            <p className="mt-0.5 text-[10px] font-mono text-[var(--color-ink)]/38">
                              可用 {formatBytes(drive.freeBytes)}
                            </p>
                          </div>
                        </div>
                      </button>
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
            className="home-panel home-panel--glass rounded-[1.25rem] p-4 flex-1 min-h-0"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ClockCountdown
                  size={15}
                  weight="duotone"
                  className="text-[var(--color-sea)]"
                />
                <h2 className="text-[12.5px] font-semibold tracking-tight text-[var(--color-ink)]">
                  最近清理
                </h2>
              </div>
              <button
                type="button"
                onClick={() => onOpenTool("history")}
                className="btn-press text-[10.5px] font-medium text-[var(--color-sea)] hover:underline"
              >
                全部
              </button>
            </div>
            {history.length > 0 ? (
              <ul className="space-y-1.5">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => openHistoryDetail(h)}
                      className="home-history-item btn-press w-full rounded-xl px-3 py-2.5 text-left"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[13px] font-semibold text-[var(--color-sea)]">
                          {formatBytes(h.freedBytes)}
                        </span>
                        <span className="text-[10px] font-mono text-[var(--color-ink)]/38">
                          {formatRelativeTime(h.timestamp)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-[var(--color-ink)]/42">
                        {h.failureCount > 0
                          ? `失败 ${h.failureCount} 项`
                          : `成功 ${h.successCount} 项`}
                      </p>
                    </button>
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

      <OptimizeModal
        open={optimizeOpen}
        leaving={optimizeLeaving}
        onClose={closeOptimize}
        onFinished={() => void refreshHomeStats()}
        onOpenStartup={() => {
          closeOptimize();
          window.setTimeout(() => onOpenTool("startup"), MODAL_OUT_MS);
        }}
      />

      <HistoryDetailModal
        open={historyDetailOpen}
        leaving={historyDetailLeaving}
        entry={historyDetail}
        onClose={closeHistoryDetail}
        onRestored={(updated) => {
          setHistoryDetail(updated);
          setHistory((prev) =>
            prev.map((h) => (h.id === updated.id ? updated : h)),
          );
        }}
      />
    </div>
  );
}
