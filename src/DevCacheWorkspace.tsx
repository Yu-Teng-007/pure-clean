import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowRight,
  ChartBar,
  FolderSimple,
  MagnifyingGlass,
  SpinnerGap,
} from "@phosphor-icons/react";
import WorkspaceHeader from "./WorkspaceHeader";
import { showToast } from "./Toast";
import type { CleanMode } from "./modes";
import {
  AppConfig,
  DevCacheDashboard,
  formatBytes,
  ProjectWasteItem,
} from "./types";

interface DevCacheWorkspaceProps {
  onBack: () => void;
  onJumpClean: (mode: CleanMode, roots?: string[]) => void;
}

type Phase = "idle" | "scanning" | "done";

function shortPath(path: string): string {
  const parts = path.replace(/\\+/g, "\\").split("\\").filter(Boolean);
  if (parts.length <= 3) return path;
  return `${parts[0]}:\\…\\${parts.slice(-2).join("\\")}`;
}

export default function DevCacheWorkspace({
  onBack,
  onJumpClean,
}: DevCacheWorkspaceProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [dashboard, setDashboard] = useState<DevCacheDashboard | null>(null);
  const [progressPath, setProgressPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [roots, setRoots] = useState<string[]>([]);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await invoke<AppConfig>("load_config");
        setRoots(cfg.scanRoots ?? []);
      } catch (e) {
        showToast(`加载扫描根失败：${String(e)}`);
      }
    })();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<{ currentPath: string }>(
        "dev_cache_progress",
        (ev) => {
          setProgressPath(ev.payload.currentPath);
        },
      );
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const startScan = useCallback(async () => {
    setPhase("scanning");
    setError(null);
    setDashboard(null);
    setProgressPath("");
    try {
      const result = await invoke<DevCacheDashboard>("scan_dev_caches", {
        roots: roots.length ? roots : null,
      });
      setDashboard(result);
      setPhase("done");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  }, [roots]);

  const cancelScan = () => {
    void invoke("cancel_dev_cache_scan").catch(() => {});
  };

  const jumpDevWithRoot = (root?: string) => {
    onJumpClean("dev", root ? [root] : roots.length ? roots : undefined);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <WorkspaceHeader
        title="开发缓存看板"
        subtitle="按工具汇总全局缓存，并列出项目可释放占用"
        icon={<ChartBar size={18} weight="duotone" />}
        onBack={onBack}
        backDisabled={phase === "scanning"}
        backAriaLabel={
          phase === "scanning" ? "扫描进行中，暂不可返回" : "返回"
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-7">
        <div className="ws-panel mb-4 rounded-2xl px-4 py-3.5 animate-fade-up">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-[var(--color-ink)]/60">
              {roots.length > 0 ? (
                <>
                  项目根：
                  <span className="font-mono text-[var(--color-ink)]/80">
                    {roots.length === 1
                      ? shortPath(roots[0])
                      : `${roots.length} 个目录`}
                  </span>
                </>
              ) : (
                "未配置扫描根时仅统计全局工具缓存"
              )}
            </p>
            <div className="flex items-center gap-2">
              {phase === "scanning" && (
                <button
                  type="button"
                  onClick={cancelScan}
                  className="btn-press rounded-xl border border-[var(--color-sand)] px-3 py-2 text-[12px] font-medium text-[var(--color-ink)]/70 hover:bg-[var(--color-mist)]"
                >
                  取消
                </button>
              )}
              <button
                type="button"
                onClick={() => void startScan()}
                disabled={phase === "scanning"}
                className={[
                  "btn-press inline-flex min-w-[8rem] items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white",
                  phase === "scanning"
                    ? "bg-[var(--color-sea)]/85 cursor-wait"
                    : "bg-[var(--color-sea)] hover:bg-[var(--color-sea-bright)]",
                ].join(" ")}
              >
                {phase === "scanning" ? (
                  <>
                    <SpinnerGap
                      size={15}
                      weight="bold"
                      className="animate-spin-orbit"
                    />
                    统计中…
                  </>
                ) : (
                  <>
                    <MagnifyingGlass size={15} weight="bold" />
                    {dashboard ? "重新统计" : "开始统计"}
                  </>
                )}
              </button>
            </div>
          </div>

          {phase === "scanning" && (
            <p className="mt-3 truncate font-mono text-[11.5px] text-[var(--color-ink)]/45 animate-pulse-soft">
              {progressPath ? shortPath(progressPath) : "准备扫描…"}
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </div>

        {phase === "idle" && !dashboard && !error && (
          <div className="ws-empty flex flex-col items-center justify-center rounded-2xl px-6 py-14 text-center animate-fade-up">
            <span className="ws-mode-icon mb-3 flex size-12 items-center justify-center rounded-2xl opacity-80">
              <ChartBar size={26} weight="duotone" />
            </span>
            <p className="text-[13.5px] text-[var(--color-ink)]/50 max-w-[36ch] leading-relaxed">
              统计 npm / pnpm / Cargo / Gradle 等全局缓存，以及各项目的
              target、node_modules、构建产物占用。
            </p>
          </div>
        )}

        {dashboard && phase !== "scanning" && (
          <div className="space-y-5 animate-fade-up">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="ws-panel rounded-2xl px-4 py-3.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink)]/45">
                  全局工具缓存
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-[var(--color-sea)]">
                  {formatBytes(dashboard.totalToolBytes)}
                </p>
                <p className="mt-1 text-[12px] text-[var(--color-ink)]/48">
                  {dashboard.toolGroups.length} 组工具
                </p>
              </div>
              <div className="ws-panel rounded-2xl px-4 py-3.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink)]/45">
                  项目可释放
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-[var(--color-ink)]">
                  {formatBytes(dashboard.totalProjectBytes)}
                </p>
                <p className="mt-1 text-[12px] text-[var(--color-ink)]/48">
                  {dashboard.projects.length} 个项目
                </p>
              </div>
            </div>

            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-[14px] font-semibold tracking-tight">
                  按工具
                </h2>
                {dashboard.toolGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={() => jumpDevWithRoot()}
                    className="btn-press inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-sea)] hover:underline"
                  >
                    去开发清理
                    <ArrowRight size={12} weight="bold" />
                  </button>
                )}
              </div>
              {dashboard.toolGroups.length === 0 ? (
                <p className="text-[12.5px] text-[var(--color-ink)]/45">
                  未发现占用显著的全局开发缓存
                </p>
              ) : (
                <ul className="ws-list divide-y divide-[var(--color-sand)]/45 overflow-hidden rounded-2xl">
                  {dashboard.toolGroups.map((g) => {
                    const open = expandedTool === g.id;
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedTool(open ? null : g.id)
                          }
                          className="btn-press flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-white/55"
                        >
                          <span className="min-w-0 truncate text-[13px] font-medium">
                            {g.label}
                            <span className="ml-2 font-mono text-[11px] text-[var(--color-ink)]/40">
                              {g.paths.length} 项
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">
                            {formatBytes(g.bytes)}
                          </span>
                        </button>
                        {open && (
                          <ul className="border-t border-[var(--color-sand)]/40 bg-[var(--color-mist)]/35 px-3.5 py-2 space-y-1.5">
                            {g.paths.map((p) => (
                              <li
                                key={p.path}
                                className="flex items-center justify-between gap-2 text-[11.5px]"
                              >
                                <span
                                  className="min-w-0 truncate font-mono text-[var(--color-ink)]/65"
                                  title={p.path}
                                >
                                  {shortPath(p.path)}
                                </span>
                                <span className="shrink-0 font-mono tabular-nums text-[var(--color-ink)]/50">
                                  {formatBytes(p.bytes)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-[14px] font-semibold tracking-tight">
                  项目浪费榜
                </h2>
              </div>
              {dashboard.projects.length === 0 ? (
                <p className="text-[12.5px] text-[var(--color-ink)]/45">
                  在扫描根下未发现可汇总的项目构建产物
                </p>
              ) : (
                <ul className="ws-list divide-y divide-[var(--color-sand)]/45 overflow-hidden rounded-2xl">
                  {dashboard.projects.map((p: ProjectWasteItem) => {
                    const open = expandedProject === p.projectPath;
                    return (
                      <li key={p.projectPath}>
                        <div className="flex items-stretch gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedProject(open ? null : p.projectPath)
                            }
                            className="btn-press min-w-0 flex-1 px-3.5 py-2.5 text-left hover:bg-white/55"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="min-w-0">
                                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                                  <FolderSimple
                                    size={14}
                                    weight="duotone"
                                    className="shrink-0 text-[var(--color-sea)]"
                                  />
                                  <span className="truncate">
                                    {p.projectName}
                                  </span>
                                </span>
                                <span
                                  className="mt-0.5 block truncate font-mono text-[11px] text-[var(--color-ink)]/40"
                                  title={p.projectPath}
                                >
                                  {shortPath(p.projectPath)}
                                </span>
                              </span>
                              <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums">
                                {formatBytes(p.bytes)}
                              </span>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => jumpDevWithRoot(p.projectPath)}
                            className="btn-press shrink-0 self-center mr-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-sea)] hover:bg-[var(--color-sea)]/10"
                            title="用开发清理扫描此项目"
                          >
                            清理
                          </button>
                        </div>
                        {open && (
                          <ul className="border-t border-[var(--color-sand)]/40 bg-[var(--color-mist)]/35 px-3.5 py-2 space-y-1.5">
                            {p.details.map((d) => (
                              <li
                                key={d.path}
                                className="flex items-center justify-between gap-2 text-[11.5px]"
                              >
                                <span className="min-w-0 truncate font-mono text-[var(--color-ink)]/65">
                                  {d.categoryLabel} · {shortPath(d.path)}
                                </span>
                                <span className="shrink-0 font-mono tabular-nums text-[var(--color-ink)]/50">
                                  {formatBytes(d.bytes)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
