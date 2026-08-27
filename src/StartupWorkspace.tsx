import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowsClockwise,
  Lightning,
  RocketLaunch,
} from "@phosphor-icons/react";
import { impactLabel, locationLabel } from "./appView";
import StartupOptimizeModal, {
  type StartupOptimizePhase,
} from "./StartupOptimizeModal";
import WorkspaceHeader from "./WorkspaceHeader";
import { showToast } from "./Toast";
import type {
  StartupImpact,
  StartupItem,
  StartupLocation,
  StartupOptimizeReport,
} from "./types";

interface StartupWorkspaceProps {
  onBack: () => void;
}

const GROUP_ORDER: StartupLocation[] = [
  "registry_hkcu",
  "registry_hklm",
  "folder_user",
  "folder_common",
];

const MODAL_OUT_MS = 180;

function impactClass(impact: StartupImpact): string {
  switch (impact) {
    case "low":
      return "text-[var(--color-sea)] bg-[var(--color-sea)]/10";
    case "medium":
      return "text-[var(--color-warn)] bg-amber-500/10";
    case "high":
      return "text-[var(--color-danger)] bg-red-500/10";
  }
}

export default function StartupWorkspace({ onBack }: StartupWorkspaceProps) {
  const [items, setItems] = useState<StartupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const [modalOpen, setModalOpen] = useState(false);
  const [modalLeaving, setModalLeaving] = useState(false);
  const [optimizePhase, setOptimizePhase] =
    useState<StartupOptimizePhase>("running");
  const [optimizeReport, setOptimizeReport] =
    useState<StartupOptimizeReport | null>(null);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const optimizingRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<StartupItem[]>("list_startup_items");
      setItems(list);
      setRowErrors({});
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groups = useMemo(() => {
    const map = new Map<StartupLocation, StartupItem[]>();
    for (const loc of GROUP_ORDER) map.set(loc, []);
    for (const item of items) {
      const list = map.get(item.location) ?? [];
      list.push(item);
      map.set(item.location, list);
    }
    return GROUP_ORDER.map((loc) => ({
      location: loc,
      items: map.get(loc) ?? [],
    })).filter((g) => g.items.length > 0);
  }, [items]);

  const suggestCount = useMemo(
    () => items.filter((i) => i.suggestDisable && i.enabled).length,
    [items],
  );

  const closeModal = useCallback(() => {
    if (optimizingRef.current) return;
    setModalLeaving(true);
    window.setTimeout(() => {
      setModalOpen(false);
      setModalLeaving(false);
      setOptimizePhase("running");
      setOptimizeReport(null);
      setOptimizeError(null);
    }, MODAL_OUT_MS);
  }, []);

  const runOptimize = useCallback(async () => {
    if (optimizingRef.current) return;
    optimizingRef.current = true;
    setOptimizePhase("running");
    setOptimizeReport(null);
    setOptimizeError(null);
    try {
      const result = await invoke<StartupOptimizeReport>(
        "run_startup_smart_optimize",
      );
      setOptimizeReport(result);
      setOptimizePhase("done");
      const list = await invoke<StartupItem[]>("list_startup_items");
      setItems(list);
      setRowErrors({});
      if (result.disabled.length > 0) {
        showToast(`已禁用 ${result.disabled.length} 项开机启动项`);
      } else {
        showToast("智能优化完成");
      }
    } catch (e) {
      setOptimizeError(String(e));
      setOptimizePhase("error");
    } finally {
      optimizingRef.current = false;
    }
  }, []);

  const openOptimize = useCallback(() => {
    setModalOpen(true);
    setModalLeaving(false);
    setOptimizePhase("running");
    setOptimizeReport(null);
    setOptimizeError(null);
    void runOptimize();
  }, [runOptimize]);

  const toggle = async (item: StartupItem) => {
    if (busyId || modalOpen) return;
    setBusyId(item.id);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    try {
      const updated = await invoke<StartupItem>("set_startup_enabled", {
        id: item.id,
        enabled: !item.enabled,
      });
      setItems((prev) =>
        prev.map((x) => (x.id === updated.id ? updated : x)),
      );
    } catch (e) {
      setRowErrors((prev) => ({ ...prev, [item.id]: String(e) }));
    } finally {
      setBusyId(null);
    }
  };

  const enabledCount = items.filter((i) => i.enabled).length;
  const pageBusy = modalOpen || busyId !== null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <WorkspaceHeader
        title="开机项管理"
        subtitle={
          <>
            注册表 Run 与 Startup 文件夹 · 已启用 {enabledCount} / {items.length}
          </>
        }
        icon={<RocketLaunch size={18} weight="duotone" />}
        onBack={onBack}
        backDisabled={modalOpen && optimizePhase === "running"}
        actions={
          <>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading || pageBusy}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)]/80 bg-white/55 px-3 py-2 text-xs font-medium text-[var(--color-ink)]/75 hover:bg-white/80 disabled:opacity-50"
            >
              <ArrowsClockwise
                size={14}
                weight="bold"
                className={loading && !modalOpen ? "animate-spin" : ""}
              />
              刷新
            </button>
            <button
              type="button"
              onClick={() => openOptimize()}
              disabled={pageBusy || loading || suggestCount === 0}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-sea)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-sea-bright)] disabled:opacity-50"
            >
              <Lightning size={14} weight="bold" />
              智能优化
              {suggestCount > 0 && (
                <span className="rounded-md bg-white/20 px-1.5 py-0.5 font-mono text-[10px]">
                  {suggestCount}
                </span>
              )}
            </button>
          </>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        {error && (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
            {error}
          </p>
        )}

        {!loading && suggestCount > 0 && (
          <section
            className="mb-4 rounded-2xl border border-[var(--color-sea)]/25 bg-[var(--color-sea)]/6 p-4 animate-fade-up"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-[var(--color-ink)]">
                  发现 {suggestCount} 项可优化开机项
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--color-ink)]/55">
                  智能优化将禁用更新程序与第三方自启项，保留 Windows 安全、驱动与常用同步组件。
                </p>
              </div>
              <button
                type="button"
                onClick={() => openOptimize()}
                disabled={pageBusy}
                className="btn-press shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-sea)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-sea-bright)] disabled:opacity-50"
              >
                <Lightning size={14} weight="bold" />
                立即优化
              </button>
            </div>
          </section>
        )}

        {loading && items.length === 0 ? (
          <div className="ws-empty rounded-2xl px-5 py-14 text-center text-[13px] text-[var(--color-ink)]/45">
            正在读取开机项…
          </div>
        ) : groups.length === 0 ? (
          <div className="ws-empty rounded-2xl px-5 py-14 text-center text-[13px] text-[var(--color-ink)]/45">
            未发现开机启动项
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.location} className="ws-list rounded-2xl overflow-hidden">
                <h2 className="px-4 py-2.5 text-[12px] font-semibold text-[var(--color-ink)]/60 border-b border-[var(--color-sand)]/50">
                  {locationLabel(group.location)}
                  <span className="ml-2 font-mono text-[11px] text-[var(--color-ink)]/40">
                    {group.items.length}
                  </span>
                </h2>
                <ul className="divide-y divide-[var(--color-sand)]/45">
                  {group.items.map((item) => {
                    const busy = busyId === item.id;
                    const rowErr = rowErrors[item.id];
                    return (
                      <li key={item.id} className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <span
                            className="mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--color-sand)]/70 bg-white/70"
                            aria-hidden
                          >
                            {item.iconDataUrl ? (
                              <img
                                src={item.iconDataUrl}
                                alt=""
                                className="size-7 object-contain"
                                draggable={false}
                              />
                            ) : (
                              <RocketLaunch
                                size={18}
                                weight="duotone"
                                className="text-[var(--color-ink)]/35"
                              />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13.5px] font-semibold text-[var(--color-ink)]">
                                {item.name}
                              </span>
                              <span
                                className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${impactClass(item.impact)}`}
                              >
                                {impactLabel(item.impact)}
                              </span>
                              {item.suggestDisable && item.enabled && (
                                <span className="rounded-md bg-[var(--color-ink)]/6 px-1.5 py-0.5 text-[10px] text-[var(--color-ink)]/50">
                                  可优化
                                </span>
                              )}
                              {item.publisherHint && (
                                <span className="text-[11px] text-[var(--color-ink)]/42">
                                  {item.publisherHint}
                                </span>
                              )}
                            </div>
                            <p
                              className="mt-1 font-mono text-[11px] leading-snug text-[var(--color-ink)]/45 truncate"
                              title={item.command}
                            >
                              {item.command}
                            </p>
                            {rowErr && (
                              <p className="mt-1.5 text-[11.5px] text-[var(--color-danger)]">
                                {rowErr}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={item.enabled}
                            disabled={busy || pageBusy}
                            onClick={() => void toggle(item)}
                            className={`btn-press relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-50 ${
                              item.enabled
                                ? "bg-[var(--color-sea)]"
                                : "bg-[var(--color-sand)]"
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                                item.enabled ? "translate-x-5" : ""
                              }`}
                            />
                            <span className="sr-only">
                              {item.enabled ? "禁用" : "启用"}
                            </span>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <StartupOptimizeModal
        open={modalOpen}
        leaving={modalLeaving}
        phase={optimizePhase}
        report={optimizeReport}
        error={optimizeError}
        onClose={closeModal}
        onRetry={() => void runOptimize()}
      />
    </div>
  );
}
