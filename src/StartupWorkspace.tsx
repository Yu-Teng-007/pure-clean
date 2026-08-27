import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowsClockwise,
  Lightning,
  MagnifyingGlass,
  RocketLaunch,
} from "@phosphor-icons/react";
import { impactLabel, locationLabel } from "./appView";
import ScrollEdgeFabs from "./ScrollEdgeFabs";
import StartupOptimizeModal, {
  type StartupOptimizePhase,
} from "./StartupOptimizeModal";
import WorkspaceHeader from "./WorkspaceHeader";
import { useKeyboardShortcut } from "./useKeyboardShortcut";
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

type ListFilter = "all" | "suggest" | "disabled";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

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

function chipClass(active: boolean): string {
  return [
    "btn-press rounded-xl px-2.5 py-1 text-xs font-medium border transition-colors duration-150 disabled:opacity-50",
    active
      ? "border-[var(--color-sea)] bg-[var(--color-sea)]/10 text-[var(--color-sea)]"
      : "border-[var(--color-sand)] bg-white text-[var(--color-ink)]/70 hover:bg-[var(--color-mist)]",
  ].join(" ");
}

function StartupListSkeleton() {
  return (
    <div className="space-y-4 animate-fade-up">
      {[0, 1].map((g) => (
        <section key={g} className="ws-list rounded-2xl overflow-hidden">
          <div className="h-9 border-b border-[var(--color-sand)]/50 px-4 flex items-center">
            <div className="h-2.5 w-24 rounded bg-[var(--color-sand)]/55 animate-pulse-soft" />
          </div>
          <ul className="divide-y divide-[var(--color-sand)]/45">
            {[0, 1, 2].map((i) => (
              <li key={i} className="px-4 py-3.5 flex items-start gap-3">
                <div className="size-9 shrink-0 rounded-xl bg-[var(--color-sand)]/50 animate-pulse-soft" />
                <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                  <div className="h-3 w-36 max-w-full rounded bg-[var(--color-sand)]/55 animate-pulse-soft" />
                  <div className="h-2.5 w-full max-w-sm rounded bg-[var(--color-sand)]/40 animate-pulse-soft" />
                </div>
                <div className="mt-0.5 h-6 w-11 shrink-0 rounded-full bg-[var(--color-sand)]/45 animate-pulse-soft" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function StartupWorkspace({ onBack }: StartupWorkspaceProps) {
  const [items, setItems] = useState<StartupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set());
  const [scrollTargetId, setScrollTargetId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalLeaving, setModalLeaving] = useState(false);
  const [optimizePhase, setOptimizePhase] =
    useState<StartupOptimizePhase>("confirm");
  const [optimizeReport, setOptimizeReport] =
    useState<StartupOptimizeReport | null>(null);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);
  const [runStage, setRunStage] = useState(0);
  const [runProgress, setRunProgress] = useState(8);
  const optimizingRef = useRef(false);
  const modalLeavingRef = useRef(false);

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

  const suggestItems = useMemo(
    () => items.filter((i) => i.suggestDisable && i.enabled),
    [items],
  );

  const suggestCount = suggestItems.length;
  const enabledCount = items.filter((i) => i.enabled).length;
  const disabledCount = items.length - enabledCount;
  const enabledPct =
    items.length > 0 ? Math.round((enabledCount / items.length) * 100) : 0;

  const filteredItems = useMemo(() => {
    let base: StartupItem[];
    switch (listFilter) {
      case "suggest":
        base = suggestItems;
        break;
      case "disabled":
        base = items.filter((i) => !i.enabled);
        break;
      default:
        base = items;
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.command.toLowerCase().includes(q) ||
        (i.publisherHint?.toLowerCase().includes(q) ?? false),
    );
  }, [items, listFilter, suggestItems, searchQuery]);

  const groups = useMemo(() => {
    const map = new Map<StartupLocation, StartupItem[]>();
    for (const loc of GROUP_ORDER) map.set(loc, []);
    for (const item of filteredItems) {
      const list = map.get(item.location) ?? [];
      list.push(item);
      map.set(item.location, list);
    }
    return GROUP_ORDER.map((loc) => ({
      location: loc,
      items: map.get(loc) ?? [],
    })).filter((g) => g.items.length > 0);
  }, [filteredItems]);

  useEffect(() => {
    if (listFilter === "suggest" && suggestCount === 0) {
      setListFilter("all");
    }
    if (listFilter === "disabled" && disabledCount === 0) {
      setListFilter("all");
    }
  }, [listFilter, suggestCount, disabledCount]);

  const resetModalState = useCallback(() => {
    setOptimizePhase("confirm");
    setOptimizeReport(null);
    setOptimizeError(null);
    setRunStage(0);
    setRunProgress(8);
  }, []);

  const closeModal = useCallback(() => {
    if (optimizingRef.current || modalLeavingRef.current) return;
    if (prefersReducedMotion()) {
      setModalOpen(false);
      setModalLeaving(false);
      resetModalState();
      return;
    }
    modalLeavingRef.current = true;
    setModalLeaving(true);
    window.setTimeout(() => {
      setModalOpen(false);
      setModalLeaving(false);
      modalLeavingRef.current = false;
      resetModalState();
    }, MODAL_OUT_MS);
  }, [resetModalState]);

  const handleModalClose = useCallback(() => {
    const disabledIds = optimizeReport?.disabled.map((i) => i.id) ?? [];
    const shouldFocusList =
      optimizePhase === "done" && disabledIds.length > 0;
    closeModal();
    if (!shouldFocusList) return;
    setListFilter("disabled");
    setSearchQuery("");
    setScrollTargetId(disabledIds[0] ?? null);
    window.setTimeout(() => {
      scrollRef.current
        ?.querySelector<HTMLElement>('[data-scroll-target="true"]')
        ?.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "center",
        });
    }, MODAL_OUT_MS + 60);
  }, [closeModal, optimizePhase, optimizeReport]);

  const openOptimize = useCallback(() => {
    setModalOpen(true);
    setModalLeaving(false);
    modalLeavingRef.current = false;
    setOptimizePhase("confirm");
    setOptimizeReport(null);
    setOptimizeError(null);
    setRunStage(0);
    setRunProgress(8);
  }, []);

  const runOptimize = useCallback(async () => {
    if (optimizingRef.current || suggestCount === 0) return;
    optimizingRef.current = true;
    setOptimizePhase("running");
    setOptimizeReport(null);
    setOptimizeError(null);
    setRunStage(0);
    setRunProgress(8);

    const minSpin = prefersReducedMotion()
      ? Promise.resolve()
      : new Promise<void>((r) => window.setTimeout(r, 680));

    try {
      const [result] = await Promise.all([
        invoke<StartupOptimizeReport>("run_startup_smart_optimize"),
        minSpin,
      ]);
      setRunProgress(100);
      setRunStage(3);
      setOptimizeReport(result);
      setOptimizePhase("done");

      const disabledIds = new Set(result.disabled.map((i) => i.id));
      setHighlightIds(disabledIds);
      setScrollTargetId(result.disabled[0]?.id ?? null);

      const list = await invoke<StartupItem[]>("list_startup_items");
      setItems(list);
      setRowErrors({});

      if (disabledIds.size > 0) {
        window.setTimeout(() => {
          setHighlightIds(new Set());
          setScrollTargetId(null);
        }, 2600);
      }
    } catch (e) {
      setOptimizeError(String(e));
      setOptimizePhase("error");
    } finally {
      optimizingRef.current = false;
    }
  }, [suggestCount]);

  const retryOptimize = useCallback(() => {
    if (optimizingRef.current) return;
    if (suggestCount > 0) {
      void runOptimize();
    } else {
      openOptimize();
    }
  }, [suggestCount, runOptimize, openOptimize]);

  useEffect(() => {
    if (!modalOpen || optimizePhase !== "running") return;

    if (prefersReducedMotion()) {
      setRunProgress(72);
      return;
    }

    let stage = 0;
    let progress = 8;

    const stageTimer = window.setInterval(() => {
      stage = Math.min(2, stage + 1);
      setRunStage(stage);
    }, 380);

    const progressTimer = window.setInterval(() => {
      progress = Math.min(92, progress + 4 + Math.random() * 4);
      setRunProgress(progress);
    }, 150);

    return () => {
      window.clearInterval(stageTimer);
      window.clearInterval(progressTimer);
    };
  }, [modalOpen, optimizePhase]);

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

  const pageBusy = modalOpen || busyId !== null;

  useKeyboardShortcut("mod+f", () => searchInputRef.current?.focus(), {
    enabled: !modalOpen && items.length > 0,
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <WorkspaceHeader
        title="开机项管理"
        subtitle="注册表 Run 与 Startup 文件夹"
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
                <span className="rounded-md bg-white/20 px-1.5 py-0.5 font-mono text-[10px] tabular-nums">
                  {suggestCount}
                </span>
              )}
            </button>
          </>
        }
      />

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto px-6 pb-6 space-y-4 scroll-thin"
        >
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-[var(--color-danger)] animate-fade-up">
            {error}
          </p>
        )}

        {!loading && items.length > 0 && (
          <div
            className="flex items-center gap-3 pt-1 animate-fade-up"
            role="meter"
            aria-valuenow={enabledPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`已启用 ${enabledCount} / ${items.length}`}
          >
            <div className="home-disk-track flex-1 h-1.5">
              <div
                className="home-disk-fill"
                style={{ width: `${enabledPct}%` }}
              />
            </div>
            <p className="shrink-0 text-[11px] font-mono text-[var(--color-ink)]/45 tabular-nums">
              {enabledCount}/{items.length} 启用
              {disabledCount > 0 ? ` · ${disabledCount} 禁用` : ""}
            </p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="ws-toolbar flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5">
            <div className="relative min-w-[10rem] flex-1">
              <MagnifyingGlass
                size={14}
                weight="bold"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink)]/35"
              />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索名称或路径…（Ctrl+F）"
                disabled={pageBusy}
                className="home-input w-full rounded-xl border border-[var(--color-sand)]/80 bg-white/85 py-1.5 pl-8 pr-3 text-[12.5px] outline-none focus:border-[var(--color-sea-bright)] disabled:opacity-50"
              />
            </div>
            <button
              type="button"
              onClick={() => setListFilter("all")}
              disabled={pageBusy}
              className={chipClass(listFilter === "all")}
            >
              全部
              <span className="ml-1 font-mono text-[10px] opacity-70">
                {items.length}
              </span>
            </button>
            {suggestCount > 0 && (
              <button
                type="button"
                onClick={() => setListFilter("suggest")}
                disabled={pageBusy}
                className={chipClass(listFilter === "suggest")}
              >
                可优化
                <span className="ml-1 font-mono text-[10px] opacity-70">
                  {suggestCount}
                </span>
              </button>
            )}
            {disabledCount > 0 && (
              <button
                type="button"
                onClick={() => setListFilter("disabled")}
                disabled={pageBusy}
                className={chipClass(listFilter === "disabled")}
              >
                已禁用
                <span className="ml-1 font-mono text-[10px] opacity-70">
                  {disabledCount}
                </span>
              </button>
            )}
            <span className="text-[11px] font-mono text-[var(--color-ink)]/45 tabular-nums">
              {filteredItems.length} 项可见
              {searchQuery.trim() ? ` / ${items.length} 总计` : ""}
            </span>
          </div>
        )}

        {loading && items.length === 0 ? (
          <StartupListSkeleton />
        ) : items.length === 0 ? (
          <div className="ws-empty rounded-2xl px-5 py-14 text-center text-[13px] text-[var(--color-ink)]/45">
            未发现开机启动项
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="ws-empty rounded-2xl px-5 py-14 text-center text-[13px] text-[var(--color-ink)]/45">
            {searchQuery.trim()
              ? `没有匹配「${searchQuery}」的开机项`
              : listFilter === "suggest"
                ? "没有仍启用的可优化项"
                : "没有已禁用的开机项"}
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <section
                key={group.location}
                className="ws-list rounded-2xl overflow-hidden"
              >
                <h2 className="px-4 py-2.5 text-[12px] font-semibold text-[var(--color-ink)]/60 border-b border-[var(--color-sand)]/50">
                  {locationLabel(group.location)}
                  <span className="ml-2 font-mono text-[11px] text-[var(--color-ink)]/40">
                    {group.items.length}
                  </span>
                </h2>
                <ul className="divide-y divide-[var(--color-sand)]/45">
                  {group.items.map((item, index) => {
                    const busy = busyId === item.id;
                    const rowErr = rowErrors[item.id];
                    const isSuggestable =
                      item.suggestDisable && item.enabled;
                    const justOptimized = highlightIds.has(item.id);
                    const isScrollTarget = scrollTargetId === item.id;
                    const enterStyle = {
                      animationDelay: `${Math.min(index, 12) * 24}ms`,
                    } satisfies CSSProperties;
                    return (
                      <li
                        key={item.id}
                        data-scroll-target={isScrollTarget ? "true" : undefined}
                        className={[
                          "ws-row px-4 py-3 transition-[background-color,opacity] duration-300 animate-row-enter hover:bg-white/70",
                          isSuggestable
                            ? "bg-[var(--color-warn)]/[0.04]"
                            : "",
                          !item.enabled ? "opacity-70" : "",
                          justOptimized ? "animate-success-glow ring-1 ring-inset ring-[var(--color-sea)]/25" : "",
                          busy ? "pointer-events-none" : "",
                        ].join(" ")}
                        style={enterStyle}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={[
                              "mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-white/70 transition-transform duration-200",
                              isSuggestable
                                ? "border-[var(--color-warn)]/35"
                                : "border-[var(--color-sand)]/70",
                              busy ? "scale-95 opacity-70" : "",
                            ].join(" ")}
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
                              {isSuggestable && (
                                <span className="rounded-md bg-[var(--color-warn)]/12 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-warn)]">
                                  可优化
                                </span>
                              )}
                              {!item.enabled && (
                                <span className="rounded-md bg-[var(--color-ink)]/6 px-1.5 py-0.5 text-[10px] text-[var(--color-ink)]/45">
                                  已禁用
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
                              {item.name}
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

        <ScrollEdgeFabs
          scrollRef={scrollRef}
          contentKey={`${listFilter}-${searchQuery}-${filteredItems.length}`}
        />
      </div>

      <StartupOptimizeModal
        open={modalOpen}
        leaving={modalLeaving}
        phase={optimizePhase}
        suggestItems={suggestItems}
        runStage={runStage}
        runProgress={runProgress}
        report={optimizeReport}
        error={optimizeError}
        onClose={handleModalClose}
        onConfirm={() => void runOptimize()}
        onRetry={() => retryOptimize()}
      />
    </div>
  );
}
