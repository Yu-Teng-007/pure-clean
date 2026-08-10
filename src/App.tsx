import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AppConfig,
  CATEGORY_ORDER,
  Category,
  CleanProgress,
  CleanReport,
  DEFAULT_MIN_FILE_BYTES,
  formatBytes,
  MIN_FILE_PRESETS,
  ScanItem,
  ScanProgress,
  ScanResult,
} from "./types";

type Phase = "idle" | "scanning" | "ready" | "cleaning" | "done";

const EXIT_MS = 380;
const MODAL_OUT_MS = 180;

function riskLabel(risk: ScanItem["risk"]): string {
  switch (risk) {
    case "safe":
      return "安全";
    case "caution":
      return "谨慎";
    case "dangerous":
      return "高风险";
  }
}

function riskClass(risk: ScanItem["risk"]): string {
  switch (risk) {
    case "safe":
      return "text-[var(--color-sea)] bg-[var(--color-sea)]/10";
    case "caution":
      return "text-[var(--color-warn)] bg-amber-500/10";
    case "dangerous":
      return "text-[var(--color-danger)] bg-red-500/10";
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function useAnimatedNumber(target: number, duration = 420): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    const from = valueRef.current;
    const delta = target - from;
    if (delta === 0) return;

    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(from + delta * eased);
      setValue(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

function matchItemByPath(items: ScanItem[], path: string): ScanItem | undefined {
  return items.find(
    (i) =>
      i.path === path ||
      (i.special === "recycle_bin" &&
        (path === "回收站" || path.includes("回收站"))),
  );
}

function SuccessCheck() {
  return (
    <svg
      className="success-check animate-check-pop"
      viewBox="0 0 28 28"
      aria-hidden
    >
      <circle className="success-check__circle" cx="14" cy="14" r="12" />
      <path className="success-check__mark" d="M8.5 14.2l3.4 3.4 7.6-7.6" />
    </svg>
  );
}

export default function App() {
  const [roots, setRoots] = useState<string[]>([]);
  const [rootInput, setRootInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<ScanItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [cleanProgress, setCleanProgress] = useState<CleanProgress | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmLeaving, setConfirmLeaving] = useState(false);
  const [selectCaution, setSelectCaution] = useState(false);
  const [minFileBytes, setMinFileBytes] = useState(DEFAULT_MIN_FILE_BYTES);
  const [activeCleanId, setActiveCleanId] = useState<string | null>(null);
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  const [goneIds, setGoneIds] = useState<Set<string>>(new Set());
  const [listEpoch, setListEpoch] = useState(0);
  const [freedFlash, setFreedFlash] = useState(0);

  const itemsRef = useRef(items);
  const selectedRef = useRef(selected);
  const lastCleanedIdRef = useRef<string | null>(null);
  const exitTimersRef = useRef<number[]>([]);
  const goneIdsRef = useRef<Set<string>>(new Set());
  const exitingIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    goneIdsRef.current = goneIds;
  }, [goneIds]);
  useEffect(() => {
    exitingIdsRef.current = exitingIds;
  }, [exitingIds]);

  const clearExitTimers = () => {
    exitTimersRef.current.forEach((t) => clearTimeout(t));
    exitTimersRef.current = [];
  };

  const markExiting = useCallback((id: string) => {
    if (goneIdsRef.current.has(id) || exitingIdsRef.current.has(id)) return;
    exitingIdsRef.current = new Set(exitingIdsRef.current).add(id);
    setExitingIds(new Set(exitingIdsRef.current));
    const delay = prefersReducedMotion() ? 0 : EXIT_MS;
    const t = window.setTimeout(() => {
      exitingIdsRef.current = new Set(exitingIdsRef.current);
      exitingIdsRef.current.delete(id);
      goneIdsRef.current = new Set(goneIdsRef.current).add(id);
      setGoneIds(new Set(goneIdsRef.current));
      setExitingIds(new Set(exitingIdsRef.current));
    }, delay);
    exitTimersRef.current.push(t);
  }, []);

  const animatedFreed = useAnimatedNumber(cleanProgress?.freedBytes ?? 0);
  const animatedReportFreed = useAnimatedNumber(report?.freedBytes ?? 0, 700);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await invoke<AppConfig>("load_config");
        setRoots(cfg.scanRoots.length ? cfg.scanRoots : ["D:\\YHDJA"]);
        setSelectCaution(cfg.selectCautionByDefault);
        setMinFileBytes(cfg.minFileBytes ?? DEFAULT_MIN_FILE_BYTES);
      } catch {
        setRoots(["D:\\YHDJA"]);
      }
    })();
  }, []);

  useEffect(() => {
    let unsubs: Array<() => void> = [];
    (async () => {
      const u1 = await listen<ScanProgress>("scan_progress", (e) => {
        setScanProgress(e.payload);
      });
      const u2 = await listen<CleanProgress>("clean_progress", (e) => {
        const progress = e.payload;
        setCleanProgress(progress);

        const match = matchItemByPath(itemsRef.current, progress.currentPath);
        if (match) {
          if (
            lastCleanedIdRef.current &&
            lastCleanedIdRef.current !== match.id
          ) {
            markExiting(lastCleanedIdRef.current);
          }
          lastCleanedIdRef.current = match.id;
          setActiveCleanId(match.id);
        }

        setFreedFlash((n) => n + 1);
      });
      unsubs = [u1, u2];
    })();
    return () => {
      unsubs.forEach((u) => u());
      clearExitTimers();
    };
  }, [markExiting]);

  const persistConfig = useCallback(
    async (patch: Partial<AppConfig> & { scanRoots?: string[] }) => {
      try {
        const cfg = await invoke<AppConfig>("load_config");
        await invoke("save_config", {
          config: { ...cfg, ...patch },
        });
      } catch {
        /* ignore persist errors in UI */
      }
    },
    [],
  );

  const persistRoots = useCallback(
    async (next: string[]) => {
      setRoots(next);
      await persistConfig({ scanRoots: next });
    },
    [persistConfig],
  );

  const updateMinFileBytes = useCallback(
    async (bytes: number) => {
      setMinFileBytes(bytes);
      await persistConfig({ minFileBytes: bytes });
    },
    [persistConfig],
  );

  const addRoot = async () => {
    const trimmed = rootInput.trim();
    if (!trimmed) {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string" && !roots.includes(picked)) {
        await persistRoots([...roots, picked]);
      }
      return;
    }
    if (!roots.includes(trimmed)) {
      await persistRoots([...roots, trimmed]);
    }
    setRootInput("");
  };

  const removeRoot = async (path: string) => {
    await persistRoots(roots.filter((r) => r !== path));
  };

  const startScan = async () => {
    setError(null);
    setReport(null);
    clearExitTimers();
    setExitingIds(new Set());
    setGoneIds(new Set());
    exitingIdsRef.current = new Set();
    goneIdsRef.current = new Set();
    setActiveCleanId(null);
    lastCleanedIdRef.current = null;
    setPhase("scanning");
    setScanProgress({ currentPath: "准备扫描…", itemsFound: 0, bytesFound: 0 });
    try {
      const result = await invoke<ScanResult>("scan", {
        request: {
          roots,
          categories: null,
          maxDepth: 6,
          minFileBytes,
        },
      });
      setItems(result.items);
      setListEpoch((n) => n + 1);
      const next = new Set<string>();
      for (const item of result.items) {
        if (
          item.selectedByDefault ||
          (selectCaution && item.risk === "caution")
        ) {
          next.add(item.id);
        }
      }
      setSelected(next);
      setPhase("ready");
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<Category, ScanItem[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const item of items) {
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return [...map.entries()].filter(([, list]) => list.length > 0);
  }, [items]);

  const selectedItems = useMemo(
    () =>
      items.filter(
        (i) =>
          selected.has(i.id) && !exitingIds.has(i.id) && !goneIds.has(i.id),
      ),
    [items, selected, exitingIds, goneIds],
  );

  const selectedBytes = useMemo(
    () => selectedItems.reduce((s, i) => s + i.bytes, 0),
    [selectedItems],
  );

  const toggleItem = (id: string) => {
    if (phase === "cleaning") return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (catItems: ScanItem[], on: boolean) => {
    if (phase === "cleaning") return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of catItems) {
        if (on) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const selectAllSafe = () => {
    setSelected(new Set(items.filter((i) => i.risk === "safe").map((i) => i.id)));
  };

  const closeConfirm = (after?: () => void) => {
    if (confirmLeaving) return;
    if (prefersReducedMotion()) {
      setConfirmOpen(false);
      setConfirmLeaving(false);
      after?.();
      return;
    }
    setConfirmLeaving(true);
    window.setTimeout(() => {
      setConfirmOpen(false);
      setConfirmLeaving(false);
      after?.();
    }, MODAL_OUT_MS);
  };

  const runClean = async () => {
    closeConfirm(async () => {
      setPhase("cleaning");
      setReport(null);
      clearExitTimers();
      setExitingIds(new Set());
      setGoneIds(new Set());
      exitingIdsRef.current = new Set();
      goneIdsRef.current = new Set();
      setActiveCleanId(null);
      lastCleanedIdRef.current = null;
      const selectedNow = itemsRef.current.filter((i) =>
        selectedRef.current.has(i.id),
      );
      setCleanProgress({
        currentPath: "开始清理…",
        done: 0,
        total: selectedNow.length,
        freedBytes: 0,
      });
      try {
        const paths = selectedNow
          .filter((i) => !i.special)
          .map((i) => i.path);
        const specials = selectedNow
          .filter((i) => i.special)
          .map((i) => i.special as string);
        const result = await invoke<CleanReport>("clean", {
          request: { paths, specials },
        });

        const failedPaths = new Set(result.failures.map((f) => f.path));
        const successIds = selectedNow
          .filter((i) => {
            if (i.special === "recycle_bin") {
              return !result.failures.some((f) => f.path === "回收站");
            }
            return !failedPaths.has(i.path);
          })
          .map((i) => i.id);

        setActiveCleanId(null);
        const pendingExit = successIds.filter(
          (id) => !goneIdsRef.current.has(id),
        );
        for (const id of pendingExit) markExiting(id);
        if (pendingExit.length && !prefersReducedMotion()) {
          await new Promise((r) => setTimeout(r, EXIT_MS));
        }

        setItems((prev) =>
          prev.filter((i) => {
            if (!selectedRef.current.has(i.id)) return true;
            if (i.special === "recycle_bin") {
              return result.failures.some((f) => f.path === "回收站");
            }
            return failedPaths.has(i.path);
          }),
        );
        clearExitTimers();
        setExitingIds(new Set());
        setGoneIds(new Set());
        exitingIdsRef.current = new Set();
        goneIdsRef.current = new Set();
        setSelected(new Set());
        lastCleanedIdRef.current = null;
        setReport(result);
        setPhase("done");
      } catch (e) {
        setError(String(e));
        setPhase("ready");
        setActiveCleanId(null);
        clearExitTimers();
        setExitingIds(new Set());
        setGoneIds(new Set());
        exitingIdsRef.current = new Set();
        goneIdsRef.current = new Set();
      }
    });
  };

  const cleanPct =
    cleanProgress && cleanProgress.total
      ? Math.min(100, (cleanProgress.done / cleanProgress.total) * 100)
      : 0;

  let rowIndex = 0;

  return (
    <div className="min-h-full flex flex-col">
      <header className="px-8 pt-8 pb-4 animate-fade-up">
        <p className="text-[var(--color-sea)] text-sm font-medium tracking-[0.18em] uppercase mb-2">
          Developer Disk Cleaner
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--color-ink)]">
          Pure Clean
        </h1>
        <p className="mt-2 max-w-xl text-[var(--color-ink)]/65 text-[15px] leading-relaxed">
          扫描构建产物、依赖缓存、大文件与系统临时文件，勾选后安全释放磁盘空间。
        </p>
      </header>

      <section
        className="px-8 pb-4 animate-fade-up"
        style={{ animationDelay: "60ms" }}
      >
        <div className="rounded-2xl border border-[var(--color-sand)]/80 bg-white/55 backdrop-blur-sm px-5 py-4">
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={rootInput}
              onChange={(e) => setRootInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRoot()}
              placeholder="添加扫描根目录，如 D:\YHDJA"
              className="flex-1 min-w-[220px] rounded-lg border border-[var(--color-sand)] bg-white/80 px-3 py-2 text-sm font-mono outline-none focus:border-[var(--color-sea-bright)] transition-[border-color] duration-150"
            />
            <button
              type="button"
              onClick={addRoot}
              className="btn-press rounded-lg border border-[var(--color-sand)] bg-white px-3 py-2 text-sm font-medium hover:bg-[var(--color-mist)]"
            >
              添加 / 浏览
            </button>
            <button
              type="button"
              onClick={startScan}
              disabled={
                phase === "scanning" || phase === "cleaning" || roots.length === 0
              }
              className="btn-press rounded-lg bg-[var(--color-sea)] text-white px-4 py-2 text-sm font-semibold hover:bg-[var(--color-sea-bright)] disabled:opacity-50"
            >
              {phase === "scanning" ? "扫描中…" : "开始扫描"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {roots.map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--color-mist)] px-3 py-1 text-xs font-mono text-[var(--color-ink)]/80"
              >
                {r}
                <button
                  type="button"
                  onClick={() => removeRoot(r)}
                  className="btn-press text-[var(--color-ink)]/45 hover:text-[var(--color-danger)]"
                  aria-label={`移除 ${r}`}
                >
                  ×
                </button>
              </span>
            ))}
            <span className="text-xs text-[var(--color-ink)]/45 self-center">
              全局缓存与系统路径会自动包含
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--color-ink)]/55">
              大文件阈值
            </span>
            {MIN_FILE_PRESETS.map((preset) => {
              const active = minFileBytes === preset.bytes;
              return (
                <button
                  key={preset.bytes}
                  type="button"
                  disabled={phase === "scanning" || phase === "cleaning"}
                  onClick={() => void updateMinFileBytes(preset.bytes)}
                  className={[
                    "btn-press rounded-lg px-2.5 py-1 text-xs font-medium border transition-colors duration-150 disabled:opacity-50",
                    active
                      ? "border-[var(--color-sea)] bg-[var(--color-sea)]/10 text-[var(--color-sea)]"
                      : "border-[var(--color-sand)] bg-white text-[var(--color-ink)]/70 hover:bg-[var(--color-mist)]",
                  ].join(" ")}
                >
                  {preset.label}
                </button>
              );
            })}
            <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink)]/55">
              自定义
              <input
                type="number"
                min={1}
                step={1}
                disabled={phase === "scanning" || phase === "cleaning"}
                value={Math.max(1, Math.round(minFileBytes / (1024 * 1024)))}
                onChange={(e) => {
                  const mb = Number(e.target.value);
                  if (!Number.isFinite(mb) || mb < 1) return;
                  void updateMinFileBytes(Math.round(mb) * 1024 * 1024);
                }}
                className="w-16 rounded-md border border-[var(--color-sand)] bg-white/80 px-2 py-1 text-xs font-mono outline-none focus:border-[var(--color-sea-bright)] disabled:opacity-50"
              />
              MB
            </label>
          </div>
          {phase === "scanning" && scanProgress && (
            <div className="mt-3">
              <div className="scan-rail" aria-hidden />
              <p className="mt-2 text-xs font-mono text-[var(--color-ink)]/55 truncate animate-pulse-soft">
                {scanProgress.currentPath}
                <span className="ml-2">
                  · 已发现 {scanProgress.itemsFound} 项 /{" "}
                  {formatBytes(scanProgress.bytesFound)}
                </span>
              </p>
            </div>
          )}
          {error && (
            <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
          )}
        </div>
      </section>

      <main
        className="flex-1 px-8 pb-28 overflow-auto animate-fade-up"
        style={{ animationDelay: "120ms" }}
      >
        {phase === "idle" && items.length === 0 && (
          <div className="h-48 flex items-center justify-center text-[var(--color-ink)]/40 text-sm">
            添加扫描根目录后点击「开始扫描」
          </div>
        )}

        {phase === "done" && report && (
          <div className="mb-4 rounded-2xl border border-[var(--color-sea)]/30 bg-[var(--color-sea)]/8 px-5 py-4 animate-fade-up animate-success-glow">
            <div className="flex items-start gap-3">
              <SuccessCheck />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-[var(--color-sea)] tabular-nums">
                  预计释放 {formatBytes(animatedReportFreed)}
                </p>
                <p className="text-sm text-[var(--color-ink)]/65 mt-1">
                  成功 {report.successCount} 项
                  {report.failures.length > 0 &&
                    ` · 失败 ${report.failures.length} 项`}
                </p>
                {report.failures.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {report.failures.map((f) => (
                      <li
                        key={f.path}
                        className="text-xs font-mono text-[var(--color-danger)]"
                      >
                        {f.path}: {f.error}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {phase === "cleaning" && cleanProgress && (
          <div className="mb-5 rounded-2xl border border-[var(--color-sea)]/20 bg-white/50 backdrop-blur-sm px-5 py-4 animate-fade-up">
            <div className="flex items-center gap-4">
              <div className="clean-orb" aria-hidden>
                <div className="clean-orb__ring" />
                <div className="clean-orb__core" />
                <div className="clean-orb__dot" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <p className="text-sm font-semibold text-[var(--color-ink)]">
                    正在清理
                  </p>
                  <p
                    key={freedFlash}
                    className="text-sm font-mono tabular-nums text-[var(--color-sea)] animate-freed-flash"
                  >
                    已释放 {formatBytes(animatedFreed)}
                  </p>
                </div>
                <div className="progress-track h-1.5">
                  <div
                    className="progress-fill"
                    style={{ width: `${cleanPct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs font-mono text-[var(--color-ink)]/55 truncate">
                  <span className="animate-pulse-soft">
                    {cleanProgress.currentPath}
                  </span>
                  <span className="ml-2 tabular-nums text-[var(--color-ink)]/40">
                    {cleanProgress.done}/{cleanProgress.total}
                  </span>
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-5">
          {grouped.map(([category, catItems]) => {
            const visibleItems = catItems.filter((i) => !goneIds.has(i.id));
            if (visibleItems.length === 0) return null;
            const label = visibleItems[0]?.categoryLabel ?? category;
            const catBytes = visibleItems.reduce((s, i) => s + i.bytes, 0);
            const selectable = visibleItems.filter((i) => !exitingIds.has(i.id));
            const allOn =
              selectable.length > 0 &&
              selectable.every((i) => selected.has(i.id));
            return (
              <section key={category}>
                <div className="flex items-baseline justify-between mb-2 px-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold tracking-wide">
                      {label}
                    </h2>
                    <button
                      type="button"
                      onClick={() => toggleCategory(catItems, !allOn)}
                      disabled={phase === "cleaning"}
                      className="text-xs text-[var(--color-sea)] hover:underline disabled:opacity-40"
                    >
                      {allOn ? "取消全选" : "全选"}
                    </button>
                  </div>
                  <span className="text-xs font-mono text-[var(--color-ink)]/50">
                    {formatBytes(catBytes)} · {visibleItems.length} 项
                  </span>
                </div>
                <ul className="rounded-xl border border-[var(--color-sand)]/70 bg-white/40 divide-y divide-[var(--color-sand)]/50 overflow-hidden">
                  {visibleItems.map((item) => {
                    const idx = rowIndex++;
                    const isExiting = exitingIds.has(item.id);
                    const isCleaning =
                      phase === "cleaning" && activeCleanId === item.id;
                    const isSelected = selected.has(item.id);
                    return (
                      <li
                        key={`${listEpoch}-${item.id}`}
                        className={[
                          "flex items-start gap-3 px-4 py-3 transition-[background-color] duration-150",
                          isExiting
                            ? "animate-row-exit"
                            : "animate-row-enter hover:bg-white/60",
                          isCleaning ? "animate-row-cleaning" : "",
                          phase === "cleaning" && isSelected && !isCleaning
                            ? "opacity-70"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        style={
                          isExiting
                            ? undefined
                            : {
                                animationDelay: `${Math.min(idx, 24) * 28}ms`,
                              }
                        }
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleItem(item.id)}
                          disabled={phase === "cleaning" || isExiting}
                          className="mt-1 accent-[var(--color-sea)] transition-transform duration-100 active:scale-90"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={[
                                "text-sm font-mono truncate transition-colors duration-200",
                                isCleaning
                                  ? "text-[var(--color-sea)]"
                                  : isExiting
                                    ? "line-through text-[var(--color-ink)]/35"
                                    : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              title={item.path}
                            >
                              {item.path}
                            </span>
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${riskClass(item.risk)}`}
                            >
                              {riskLabel(item.risk)}
                            </span>
                            {isCleaning && (
                              <span className="text-[10px] font-medium text-[var(--color-sea-bright)] animate-pulse-soft">
                                清理中
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-sm font-mono tabular-nums whitespace-nowrap text-[var(--color-ink)]/70">
                          {formatBytes(item.bytes)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </main>

      {(phase === "cleaning" ||
        ((phase === "ready" || phase === "done") &&
          items.some((i) => !goneIds.has(i.id)))) && (
          <footer className="fixed bottom-0 inset-x-0 border-t border-[var(--color-sand)] bg-[var(--color-foam)]/90 backdrop-blur-md px-8 py-4 animate-footer-rise">
            <div className="flex flex-wrap items-center gap-3 justify-between max-w-[1100px]">
              <div>
                {phase === "cleaning" && cleanProgress ? (
                  <>
                    <p className="text-sm font-medium tabular-nums">
                      清理进度 {cleanProgress.done}/{cleanProgress.total}
                      <span className="ml-2 font-mono text-[var(--color-sea)]">
                        {formatBytes(animatedFreed)}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink)]/45">
                      请稍候，正在安全删除所选项目
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">
                      已选 {selectedItems.length} 项 ·{" "}
                      <span className="font-mono text-[var(--color-sea)]">
                        {formatBytes(selectedBytes)}
                      </span>
                    </p>
                    <div className="mt-1 flex gap-3 text-xs">
                      <button
                        type="button"
                        onClick={selectAllSafe}
                        className="text-[var(--color-sea)] hover:underline"
                      >
                        仅选安全项
                      </button>
                      <button
                        type="button"
                        onClick={clearSelection}
                        className="text-[var(--color-ink)]/50 hover:underline"
                      >
                        清空选择
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                disabled={selectedItems.length === 0 || phase === "cleaning"}
                onClick={() => {
                  setConfirmLeaving(false);
                  setConfirmOpen(true);
                }}
                className="btn-press rounded-lg bg-[var(--color-ink)] text-white px-5 py-2.5 text-sm font-semibold hover:bg-[var(--color-sea)] disabled:opacity-40 min-w-[7.5rem]"
              >
                {phase === "cleaning" ? "清理中…" : "清理所选"}
              </button>
            </div>
          </footer>
        )}

      {confirmOpen && (
        <div
          className={[
            "fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 backdrop-blur-[2px] px-4",
            confirmLeaving ? "animate-backdrop-out" : "animate-backdrop-in",
          ].join(" ")}
          onClick={() => closeConfirm()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className={[
              "w-full max-w-md rounded-2xl bg-white p-6 shadow-xl",
              confirmLeaving ? "animate-modal-out" : "animate-modal-in",
            ].join(" ")}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-title" className="text-lg font-semibold">
              确认清理？
            </h3>
            <p className="mt-2 text-sm text-[var(--color-ink)]/70 leading-relaxed">
              将删除 <strong>{selectedItems.length}</strong> 项，预计释放{" "}
              <strong className="font-mono">
                {formatBytes(selectedBytes)}
              </strong>
              。缓存类目录通常可安全重建；高风险项请确认无程序占用。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => closeConfirm()}
                className="btn-press rounded-lg px-4 py-2 text-sm border border-[var(--color-sand)] hover:bg-[var(--color-mist)]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void runClean()}
                className="btn-press rounded-lg px-4 py-2 text-sm bg-[var(--color-sea)] text-white font-semibold hover:bg-[var(--color-sea-bright)]"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
