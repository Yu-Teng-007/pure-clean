import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CaretDown,
  Copy,
  FolderOpen,
  FolderSimplePlus,
  MagnifyingGlass,
  ShieldWarning,
  SortDescending,
  X,
} from "@phosphor-icons/react";
import { copyText } from "./clipboard";
import { MODAL_OUT_MS, closeWithAnimation, prefersReducedMotion } from "./motion";
import { showToast } from "./Toast";
import { useKeyboardShortcut } from "./useKeyboardShortcut";
import ScrollEdgeFabs from "./ScrollEdgeFabs";
import { MODES, type CleanMode } from "./modes";
import { MODE_ICONS } from "./modeIcons";
import ProtectPathsModal from "./ProtectPathsModal";
import CleanProgressModal, { type DiskCleanPhase } from "./CleanProgressModal";
import WorkspaceHeader from "./WorkspaceHeader";
import {
  AppConfig,
  CATEGORY_ORDER,
  Category,
  CleanProgress,
  CleanReport,
  DEFAULT_DUPE_MIN_BYTES,
  DEFAULT_INSTALLER_MIN_BYTES,
  DEFAULT_MIN_FILE_BYTES,
  DEFAULT_STALE_DAYS,
  DUPE_MIN_PRESETS,
  formatBytes,
  INSTALLER_MIN_PRESETS,
  MIN_FILE_PRESETS,
  STALE_DAY_PRESETS,
  ScanItem,
  ScanProgress,
  ScanResult,
  ScanRoot,
} from "./types";

type Phase = "idle" | "scanning" | "ready" | "cleaning" | "done";

const EXIT_MS = 380;
const SORT_PREF_KEY = "pure-clean-sort-by-size";

function isFilesystemPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path.trim()) || path.startsWith("\\\\");
}

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

function scanHintClass(hint: string): string {
  if (hint.includes("请勿删除") || hint.includes("不可")) {
    return "text-[var(--color-warn)]";
  }
  return "text-[var(--color-ink)]/48";
}

function defaultThresholdBytes(mode: CleanMode): number {
  const kind = MODES[mode].thresholdKind;
  if (kind === "dupes") return DEFAULT_DUPE_MIN_BYTES;
  if (kind === "installers") return DEFAULT_INSTALLER_MIN_BYTES;
  return DEFAULT_MIN_FILE_BYTES;
}

function thresholdPresets(mode: CleanMode) {
  const kind = MODES[mode].thresholdKind;
  if (kind === "dupes") return DUPE_MIN_PRESETS;
  if (kind === "installers") return INSTALLER_MIN_PRESETS;
  return MIN_FILE_PRESETS;
}

function thresholdLabel(mode: CleanMode): string {
  const kind = MODES[mode].thresholdKind;
  if (kind === "dupes") return "最小文件大小";
  if (kind === "installers") return "最小体积";
  return "大文件阈值";
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
        (path === "回收站" || path.includes("回收站"))) ||
      (i.special === "docker_prune" &&
        (path === "docker_prune" ||
          path.includes("Docker") ||
          path.toLowerCase().includes("docker"))) ||
      (i.special === "open_disk_cleanup" &&
        (path.includes("WinSxS") || path.includes("磁盘清理"))),
  );
}

function isAdvisoryOnly(item: ScanItem): boolean {
  return item.special === "advisory_only";
}

function isSelectable(item: ScanItem): boolean {
  return !isAdvisoryOnly(item);
}

interface CleanWorkspaceProps {
  mode: CleanMode;
  onBack: () => void;
  initialRoots?: string[];
}

export default function CleanWorkspace({
  mode,
  onBack,
  initialRoots,
}: CleanWorkspaceProps) {
  const meta = MODES[mode];
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
  const [minFileBytes, setMinFileBytes] = useState(() =>
    defaultThresholdBytes(mode),
  );
  const [staleDays, setStaleDays] = useState(DEFAULT_STALE_DAYS);
  const [protectedPaths, setProtectedPaths] = useState<string[]>([]);
  const [protectInput, setProtectInput] = useState("");
  const [protectOpen, setProtectOpen] = useState(false);
  const [protectLeaving, setProtectLeaving] = useState(false);
  const [toRecycleBin, setToRecycleBin] = useState(false);
  const [dangerousAck, setDangerousAck] = useState(false);
  const [activeCleanId, setActiveCleanId] = useState<string | null>(null);
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  const [goneIds, setGoneIds] = useState<Set<string>>(new Set());
  const [listEpoch, setListEpoch] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBySize, setSortBySize] = useState(() => {
    try {
      return localStorage.getItem(SORT_PREF_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [scanBannerDismissed, setScanBannerDismissed] = useState(false);
  const [lastScanSummary, setLastScanSummary] = useState<{
    count: number;
    bytes: number;
  } | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<Category>>(
    () => new Set(),
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [cleanModalOpen, setCleanModalOpen] = useState(false);
  const [cleanModalLeaving, setCleanModalLeaving] = useState(false);
  const [cleanPhase, setCleanPhase] = useState<DiskCleanPhase>("running");
  const [cleanStage, setCleanStage] = useState(0);
  const [cleanProgressPct, setCleanProgressPct] = useState(0);
  const [lastCleanSelectedCount, setLastCleanSelectedCount] = useState(0);
  const [lastCleanSelectedBytes, setLastCleanSelectedBytes] = useState(0);

  const cleaningRef = useRef(false);
  const scanCancelledRef = useRef(false);
  const cleanCancelledRef = useRef(false);
  const itemsRef = useRef(items);
  const selectedRef = useRef(selected);
  const lastCleanedIdRef = useRef<string | null>(null);
  const exitTimersRef = useRef<number[]>([]);
  const goneIdsRef = useRef<Set<string>>(new Set());
  const exitingIdsRef = useRef<Set<string>>(new Set());
  const toRecycleBinRef = useRef(false);

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

  // 清理弹窗：阶段 + 平滑进度（与内存清理一致，并与后端真实进度取较大值）
  useEffect(() => {
    if (!cleanModalOpen || cleanPhase !== "running") return;

    if (prefersReducedMotion()) {
      setCleanProgressPct(70);
      return;
    }

    let stage = 0;
    let simulated = 8;

    const stageTimer = window.setInterval(() => {
      stage = Math.min(2, stage + 1);
      setCleanStage(stage);
    }, 480);

    const progressTimer = window.setInterval(() => {
      simulated = Math.min(92, simulated + 2 + Math.random() * 4);
      setCleanProgressPct((prev) => {
        const real =
          cleanProgress && cleanProgress.total > 0
            ? (cleanProgress.done / cleanProgress.total) * 100
            : 0;
        return Math.min(92, Math.max(prev, simulated, real));
      });
    }, 160);

    return () => {
      window.clearInterval(stageTimer);
      window.clearInterval(progressTimer);
    };
  }, [cleanModalOpen, cleanPhase, cleanProgress?.done, cleanProgress?.total]);

  useEffect(() => {
    if (cleanPhase !== "running" || !cleanProgress?.total) return;
    const real = (cleanProgress.done / cleanProgress.total) * 100;
    if (real >= 25) setCleanStage((s) => Math.max(s, 1));
    if (real >= 55) setCleanStage((s) => Math.max(s, 2));
  }, [cleanPhase, cleanProgress?.done, cleanProgress?.total]);

  useEffect(() => {
    try {
      localStorage.setItem(SORT_PREF_KEY, String(sortBySize));
    } catch {
      /* ignore */
    }
  }, [sortBySize]);

  useEffect(() => {
    toRecycleBinRef.current = toRecycleBin;
  }, [toRecycleBin]);

  const revealInExplorer = useCallback(async (path: string) => {
    try {
      await invoke("reveal_in_explorer", { path });
    } catch (e) {
      showToast(String(e));
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await invoke<AppConfig>("load_config");
        const fromInitial =
          initialRoots && initialRoots.length > 0 ? initialRoots : null;
        if (fromInitial) {
          setRoots(fromInitial);
        } else if (cfg.scanRoots.length) {
          setRoots(cfg.scanRoots);
        } else {
          const defaults = await invoke<ScanRoot[]>("get_default_roots");
          setRoots(
            defaults
              .filter((r) => r.kind === "project")
              .map((r) => r.path),
          );
        }
        setSelectCaution(cfg.selectCautionByDefault);
        setStaleDays(cfg.staleDays ?? DEFAULT_STALE_DAYS);
        setProtectedPaths(cfg.protectedPaths ?? []);
        setToRecycleBin(cfg.toRecycleBinByDefault ?? false);
        if (meta.needsThreshold) {
          setMinFileBytes(defaultThresholdBytes(mode));
        } else {
          setMinFileBytes(cfg.minFileBytes ?? DEFAULT_MIN_FILE_BYTES);
        }
      } catch {
        setRoots(initialRoots && initialRoots.length > 0 ? initialRoots : []);
      }
    })();
  }, [meta.needsThreshold, mode, initialRoots]);

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
      });
      unsubs = [u1, u2];
    })();
    return () => {
      unsubs.forEach((u) => u());
      clearExitTimers();
    };
  }, [markExiting]);

  const persistConfig = useCallback(
    async (patch: Partial<AppConfig>) => {
      try {
        const cfg = await invoke<AppConfig>("load_config");
        await invoke("save_config", {
          config: { ...cfg, ...patch },
        });
      } catch {
        /* ignore */
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
      if (meta.thresholdKind === "large") {
        await persistConfig({ minFileBytes: bytes });
      }
    },
    [persistConfig, meta.thresholdKind],
  );

  const updateStaleDays = useCallback(
    async (days: number) => {
      setStaleDays(days);
      await persistConfig({ staleDays: days });
    },
    [persistConfig],
  );

  const persistProtected = useCallback(
    async (next: string[]) => {
      setProtectedPaths(next);
      await persistConfig({ protectedPaths: next });
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

  const removeProtected = async (path: string) => {
    await persistProtected(protectedPaths.filter((p) => p !== path));
  };

  const closeProtect = useCallback(() => {
    if (protectLeaving) return;
    closeWithAnimation(setProtectLeaving, () => {
      setProtectOpen(false);
      setProtectLeaving(false);
    });
  }, [protectLeaving]);

  useEffect(() => {
    if (!protectOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeProtect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [protectOpen, closeProtect]);

  const canScan =
    phase !== "scanning" &&
    phase !== "cleaning" &&
    (!meta.needsRoots || roots.length > 0);

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
    scanCancelledRef.current = false;
    setPhase("scanning");
    setScanProgress({ currentPath: "准备扫描…", itemsFound: 0, bytesFound: 0 });
    try {
      const result = await invoke<ScanResult>("scan", {
        request: {
          roots: meta.needsRoots ? roots : [],
          categories: meta.categories,
          maxDepth: mode === "dupes" ? 8 : 6,
          minFileBytes: meta.needsThreshold ? minFileBytes : undefined,
          staleDays: meta.needsStaleDays ? staleDays : undefined,
          safeOnly: meta.safeOnly ? true : undefined,
          protectedPaths,
        },
      });
      setItems(result.items);
      setListEpoch((n) => n + 1);
      setSearchQuery("");
      setCollapsedCategories(new Set());
      setScanBannerDismissed(false);
      setLastScanSummary({
        count: result.items.length,
        bytes: result.totalBytes,
      });
      const next = new Set<string>();
      for (const item of result.items) {
        if (
          meta.safeOnly ||
          item.selectedByDefault ||
          (selectCaution && item.risk === "caution")
        ) {
          next.add(item.id);
        }
      }
      setSelected(next);
      setPhase("ready");
      if (result.items.length === 0) {
        showToast("未发现可清理项，可调整阈值后重试");
      } else {
        showToast(
          `发现 ${result.items.length} 项 · ${formatBytes(result.totalBytes)}`,
        );
      }
      if (scanCancelledRef.current && result.items.length > 0) {
        setError("扫描已取消，已保留目前发现的结果");
      }
    } catch (e) {
      setError(String(e));
      setPhase("idle");
    }
  };

  const cancelScan = () => {
    scanCancelledRef.current = true;
    void invoke("cancel_scan").catch(() => {});
  };

  const grouped = useMemo(() => {
    const map = new Map<Category, ScanItem[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    const q = searchQuery.trim().toLowerCase();
    for (const item of items) {
      if (q && !item.path.toLowerCase().includes(q)) continue;
      const list = map.get(item.category) ?? [];
      list.push(item);
      map.set(item.category, list);
    }
    return [...map.entries()]
      .filter(([, list]) => list.length > 0)
      .map(([category, list]) => {
        const sorted = sortBySize
          ? [...list].sort((a, b) => b.bytes - a.bytes)
          : list;
        return [category, sorted] as const;
      });
  }, [items, searchQuery, sortBySize]);

  const visibleItemCount = useMemo(
    () => grouped.reduce((sum, [, list]) => sum + list.length, 0),
    [grouped],
  );

  const toggleCategoryCollapse = (category: Category) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const selectedItems = useMemo(
    () =>
      items.filter(
        (i) =>
          selected.has(i.id) &&
          isSelectable(i) &&
          !exitingIds.has(i.id) &&
          !goneIds.has(i.id),
      ),
    [items, selected, exitingIds, goneIds],
  );

  const selectedBytes = useMemo(
    () => selectedItems.reduce((s, i) => s + i.bytes, 0),
    [selectedItems],
  );

  const dangerousSelected = useMemo(
    () => selectedItems.filter((i) => i.risk === "dangerous"),
    [selectedItems],
  );

  const confirmItems = useMemo(
    () => [...selectedItems].sort((a, b) => b.bytes - a.bytes),
    [selectedItems],
  );

  const toggleItem = (id: string) => {
    if (phase === "cleaning") return;
    const item = items.find((i) => i.id === id);
    if (item && !isSelectable(item)) return;
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
        if (!isSelectable(item)) continue;
        if (on) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const selectAllSafe = useCallback(() => {
    setSelected(
      new Set(
        items
          .filter((i) => i.risk === "safe" && isSelectable(i))
          .map((i) => i.id),
      ),
    );
  }, [items]);

  useKeyboardShortcut("mod+f", () => searchInputRef.current?.focus(), {
    enabled: phase === "ready" || phase === "done",
  });

  useKeyboardShortcut("mod+shift+a", selectAllSafe, {
    enabled: (phase === "ready" || phase === "done") && !cleanModalOpen,
  });

  const openDiskCleanup = async () => {
    try {
      await invoke("open_disk_cleanup", { drive: null });
    } catch (e) {
      setError(String(e));
    }
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

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen, confirmLeaving]);

  const closeCleanModal = useCallback(() => {
    if (cleaningRef.current || cleanModalLeaving) return;
    if (cleanPhase === "running") return;
    if (prefersReducedMotion()) {
      setCleanModalOpen(false);
      setCleanModalLeaving(false);
      if (cleanPhase === "done") {
        setPhase("ready");
        setReport(null);
      }
      return;
    }
    setCleanModalLeaving(true);
    window.setTimeout(() => {
      setCleanModalOpen(false);
      setCleanModalLeaving(false);
      if (cleanPhase === "done") {
        setPhase("ready");
        setReport(null);
      }
    }, MODAL_OUT_MS);
  }, [cleanModalLeaving, cleanPhase]);

  const executeClean = async () => {
    if (cleaningRef.current) return;
    cleaningRef.current = true;
    cleanCancelledRef.current = false;

    const useRecycle = toRecycleBinRef.current;

    setCleanModalOpen(true);
    setCleanModalLeaving(false);
    setCleanPhase("running");
    setCleanStage(0);
    setCleanProgressPct(8);
    setPhase("cleaning");
    setReport(null);
    setError(null);
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
    setLastCleanSelectedCount(selectedNow.length);
    setLastCleanSelectedBytes(selectedNow.reduce((s, i) => s + i.bytes, 0));
    setCleanProgress({
      currentPath: "开始清理…",
      done: 0,
      total: selectedNow.length,
      freedBytes: 0,
    });
    try {
      const result = await invoke<CleanReport>("clean", {
        request: {
          targets: selectedNow.map((i) => ({
            path: i.path,
            category: i.category,
            bytes: i.bytes,
            special: i.special,
          })),
          toRecycleBin: useRecycle,
          protectedPaths,
          mode,
        },
      });

      const failedPaths = new Set(result.failures.map((f) => f.path));
      const successIds = selectedNow
        .filter((i) => {
          if (i.special === "recycle_bin") {
            return !result.failures.some((f) => f.path === "回收站");
          }
          if (i.special === "docker_prune") {
            return !result.failures.some(
              (f) =>
                f.path === "Docker system prune" ||
                f.path.toLowerCase().includes("docker"),
            );
          }
          if (i.special === "open_disk_cleanup") {
            return false;
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
          if (i.special === "docker_prune") {
            return result.failures.some(
              (f) =>
                f.path === "Docker system prune" ||
                f.path.toLowerCase().includes("docker"),
            );
          }
          if (i.special === "open_disk_cleanup") {
            return true;
          }
          return failedPaths.has(i.path);
        }),
      );
      setSelected(new Set());

      clearExitTimers();
      setExitingIds(new Set());
      setGoneIds(new Set());
      exitingIdsRef.current = new Set();
      goneIdsRef.current = new Set();
      lastCleanedIdRef.current = null;
      setCleanProgressPct(100);
      setCleanStage(3);
      setReport(result);
      setCleanPhase("done");
      setPhase("done");
      if (cleanCancelledRef.current) {
        setError("清理已取消，已完成部分项目");
        showToast("清理已取消，已完成部分项目");
      } else if (result.freedBytes > 0) {
        showToast(
          `已释放 ${formatBytes(result.freedBytes)} · 成功 ${result.successCount} 项`,
        );
      } else {
        showToast(`清理完成 · 成功 ${result.successCount} 项`);
      }
    } catch (e) {
      setError(String(e));
      setCleanPhase("error");
      setPhase("ready");
      setActiveCleanId(null);
      clearExitTimers();
      setExitingIds(new Set());
      setGoneIds(new Set());
      exitingIdsRef.current = new Set();
      goneIdsRef.current = new Set();
    } finally {
      cleaningRef.current = false;
    }
  };

  const cancelClean = () => {
    cleanCancelledRef.current = true;
    void invoke("cancel_clean").catch(() => {});
  };

  const runClean = async () => {
    closeConfirm(() => {
      void executeClean();
    });
  };

  let rowIndex = 0;
  const backDisabled =
    phase === "cleaning" || (cleanModalOpen && cleanPhase === "running");
  const presets = thresholdPresets(mode);

  const ModeIcon = MODE_ICONS[mode];
  const showFooter =
    !cleanModalOpen &&
    (phase === "ready" || phase === "done") &&
    items.some((i) => !goneIds.has(i.id));

  const chipClass = (active: boolean) =>
    [
      "btn-press rounded-xl px-2.5 py-1 text-xs font-medium border transition-colors duration-150 disabled:opacity-50",
      active
        ? "border-[var(--color-sea)] bg-[var(--color-sea)]/10 text-[var(--color-sea)]"
        : "border-[var(--color-sand)] bg-white text-[var(--color-ink)]/70 hover:bg-[var(--color-mist)]",
    ].join(" ");

  const renderItemRow = (item: ScanItem) => {
    const idx = rowIndex++;
    const isExiting = exitingIds.has(item.id);
    const isCleaning = phase === "cleaning" && activeCleanId === item.id;
    const isSelected = selected.has(item.id);
    const advisory = isAdvisoryOnly(item);
    const opensTool = item.special === "open_disk_cleanup";
    const canReveal = isFilesystemPath(item.path);
    return (
      <li
        key={`${listEpoch}-${item.id}`}
        className={[
          "ws-row flex items-start gap-3 px-3.5 py-2.5 transition-[background-color] duration-150",
          isExiting ? "animate-row-exit" : "animate-row-enter hover:bg-white/70",
          isCleaning ? "animate-row-cleaning" : "",
          phase === "cleaning" && isSelected && !isCleaning ? "opacity-70" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          isExiting
            ? undefined
            : { animationDelay: `${Math.min(idx, 24) * 28}ms` }
        }
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => toggleItem(item.id)}
          disabled={phase === "cleaning" || isExiting || advisory}
          className="mt-1 accent-[var(--color-sea)] transition-transform duration-100 active:scale-90 disabled:opacity-40"
        />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={[
                "text-[13px] font-mono truncate transition-colors duration-200",
                isCleaning
                  ? "text-[var(--color-sea)]"
                  : isExiting
                    ? "line-through text-[var(--color-ink)]/35"
                    : "text-[var(--color-ink)]/85",
              ]
                .filter(Boolean)
                .join(" ")}
              title={item.path}
            >
              {item.path}
            </span>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${riskClass(item.risk)}`}
            >
              {riskLabel(item.risk)}
            </span>
            {item.isKeeper === true && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--color-sea)]/10 text-[var(--color-sea)]">
                保留
              </span>
            )}
            {item.isKeeper === false && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-[var(--color-warn)]">
                副本
              </span>
            )}
            {advisory && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--color-ink)]/8 text-[var(--color-ink)]/55">
                仅检测
              </span>
            )}
            {opensTool && (
              <button
                type="button"
                onClick={() => void openDiskCleanup()}
                disabled={phase === "cleaning"}
                className="btn-press text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--color-sea)]/10 text-[var(--color-sea)] hover:underline disabled:opacity-40"
              >
                打开磁盘清理
              </button>
            )}
            {isCleaning && (
              <span className="text-[10px] font-medium text-[var(--color-sea-bright)] animate-pulse-soft">
                清理中
              </span>
            )}
          </div>
          {item.hint && (
            <p className={`mt-0.5 text-[11px] leading-snug ${scanHintClass(item.hint)}`}>
              {item.hint}
            </p>
          )}
        </div>
        <div className="ws-row-actions flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => void copyText(item.path, "路径已复制")}
            disabled={phase === "cleaning" || isExiting}
            className="btn-press rounded-lg p-1.5 text-[var(--color-ink)]/40 hover:bg-white hover:text-[var(--color-sea)] disabled:opacity-30"
            title="复制路径"
            aria-label="复制路径"
          >
            <Copy size={13} weight="bold" />
          </button>
          {canReveal && (
            <button
              type="button"
              onClick={() => void revealInExplorer(item.path)}
              disabled={phase === "cleaning" || isExiting}
              className="btn-press rounded-lg p-1.5 text-[var(--color-ink)]/40 hover:bg-white hover:text-[var(--color-sea)] disabled:opacity-30"
              title="在资源管理器中显示"
              aria-label="在资源管理器中显示"
            >
              <FolderOpen size={13} weight="bold" />
            </button>
          )}
        </div>
        <span className="text-[13px] font-mono tabular-nums whitespace-nowrap text-[var(--color-ink)]/55">
          {formatBytes(item.bytes)}
        </span>
      </li>
    );
  };

  return (
    <div className="ws-shell h-full flex flex-col overflow-hidden">
      <WorkspaceHeader
        title={meta.title}
        subtitle={meta.subtitle}
        icon={<ModeIcon size={18} weight="duotone" />}
        onBack={onBack}
        backDisabled={backDisabled}
        backAriaLabel="返回首页"
        actions={
          <button
            type="button"
            onClick={() => setProtectOpen(true)}
            disabled={backDisabled}
            className="btn-press shrink-0 inline-flex items-center gap-2 rounded-xl border border-[var(--color-sand)]/80 bg-white/55 px-3 py-2 text-xs font-medium text-[var(--color-ink)]/75 hover:bg-white/80 hover:text-[var(--color-ink)] disabled:opacity-40"
            aria-haspopup="dialog"
          >
            <ShieldWarning
              size={15}
              weight="duotone"
              className="text-[var(--color-warn)]"
            />
            保护路径
            {protectedPaths.length > 0 && (
              <span className="rounded-md bg-[var(--color-warn)]/12 px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-warn)]">
                {protectedPaths.length}
              </span>
            )}
          </button>
        }
      />

      <section
        className="px-7 pb-4 animate-fade-up"
        style={{ animationDelay: "50ms" }}
      >
        <div className="ws-panel rounded-2xl p-4">
          {meta.needsRoots && (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  value={rootInput}
                  onChange={(e) => setRootInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void addRoot()}
                  placeholder="添加扫描根目录，如 D:\Projects"
                  disabled={phase === "scanning" || phase === "cleaning"}
                  className="home-input flex-1 min-w-[200px] rounded-xl border border-[var(--color-sand)] bg-white/85 px-3 py-2 text-sm font-mono outline-none focus:border-[var(--color-sea-bright)] disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void addRoot()}
                  disabled={phase === "scanning" || phase === "cleaning"}
                  className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-sm font-medium hover:bg-[var(--color-mist)] disabled:opacity-50"
                >
                  <FolderSimplePlus size={15} weight="bold" />
                  添加
                </button>
                <button
                  type="button"
                  onClick={() => void startScan()}
                  disabled={!canScan}
                  className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-sea)] text-white px-4 py-2 text-sm font-semibold hover:bg-[var(--color-sea-bright)] disabled:opacity-50"
                >
                  <MagnifyingGlass size={15} weight="bold" />
                  {phase === "scanning" ? "扫描中…" : "开始扫描"}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {roots.map((r) => (
                  <span
                    key={r}
                    className="inline-flex max-w-full items-center gap-2 rounded-xl bg-[var(--color-mist)] px-3 py-1.5 text-xs font-mono text-[var(--color-ink)]/80"
                  >
                    <span className="truncate">{r}</span>
                    <button
                      type="button"
                      onClick={() => void removeRoot(r)}
                      disabled={phase === "scanning" || phase === "cleaning"}
                      className="btn-press shrink-0 rounded-md p-0.5 text-[var(--color-ink)]/40 hover:text-[var(--color-danger)] disabled:opacity-40"
                      aria-label={`移除 ${r}`}
                    >
                      <X size={12} weight="bold" />
                    </button>
                  </span>
                ))}
                {meta.rootsHint && (
                  <span className="text-xs text-[var(--color-ink)]/45 self-center">
                    {meta.rootsHint}
                  </span>
                )}
              </div>
            </>
          )}

          {!meta.needsRoots && (
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <p className="text-[13px] text-[var(--color-ink)]/60 max-w-[52ch] leading-relaxed">
                {mode === "docker"
                  ? "将扫描 Docker / WSL 虚拟磁盘，并可执行 docker system prune"
                  : "将扫描 Temp、回收站、浏览器全配置、应用缓存、升级残留与崩溃转储"}
              </p>
              <button
                type="button"
                onClick={() => void startScan()}
                disabled={!canScan}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-sea)] text-white px-4 py-2 text-sm font-semibold hover:bg-[var(--color-sea-bright)] disabled:opacity-50"
              >
                <MagnifyingGlass size={15} weight="bold" />
                {phase === "scanning" ? "扫描中…" : "开始扫描"}
              </button>
            </div>
          )}

          {meta.needsThreshold && (
            <div
              className={[
                "flex flex-wrap items-center gap-2",
                meta.needsRoots ? "mt-3 pt-3 border-t border-[var(--color-sand)]/50" : "mt-1",
              ].join(" ")}
            >
              <span className="text-xs text-[var(--color-ink)]/55">
                {thresholdLabel(mode)}
              </span>
              {presets.map((preset) => (
                <button
                  key={preset.bytes}
                  type="button"
                  disabled={phase === "scanning" || phase === "cleaning"}
                  onClick={() => void updateMinFileBytes(preset.bytes)}
                  className={chipClass(minFileBytes === preset.bytes)}
                >
                  {preset.label}
                </button>
              ))}
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
                  className="w-16 rounded-lg border border-[var(--color-sand)] bg-white/80 px-2 py-1 text-xs font-mono outline-none focus:border-[var(--color-sea-bright)] disabled:opacity-50"
                />
                MB
              </label>
            </div>
          )}

          {meta.needsStaleDays && (
            <div
              className={[
                "flex flex-wrap items-center gap-2",
                meta.needsRoots || meta.needsThreshold
                  ? "mt-3 pt-3 border-t border-[var(--color-sand)]/50"
                  : "mt-1",
              ].join(" ")}
            >
              <span className="text-xs text-[var(--color-ink)]/55">
                {mode === "stale" ? "闲置天数" : "闲置 node_modules"}
              </span>
              {STALE_DAY_PRESETS.map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  disabled={phase === "scanning" || phase === "cleaning"}
                  onClick={() => void updateStaleDays(preset.days)}
                  className={chipClass(staleDays === preset.days)}
                >
                  {preset.label}
                </button>
              ))}
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink)]/55">
                自定义
                <input
                  type="number"
                  min={1}
                  step={1}
                  disabled={phase === "scanning" || phase === "cleaning"}
                  value={Math.max(1, staleDays)}
                  onChange={(e) => {
                    const days = Number(e.target.value);
                    if (!Number.isFinite(days) || days < 1) return;
                    void updateStaleDays(Math.round(days));
                  }}
                  className="w-16 rounded-lg border border-[var(--color-sand)] bg-white/80 px-2 py-1 text-xs font-mono outline-none focus:border-[var(--color-sea-bright)] disabled:opacity-50"
                />
                天未修改
              </label>
            </div>
          )}

          {phase === "scanning" && scanProgress && (
            <div className="mt-3 pt-3 border-t border-[var(--color-sand)]/50">
              <div className="scan-rail" aria-hidden />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="min-w-0 flex-1 text-xs font-mono text-[var(--color-ink)]/55 truncate animate-pulse-soft">
                  {scanProgress.currentPath}
                  <span className="ml-2">
                    已发现 {scanProgress.itemsFound} 项 /{" "}
                    {formatBytes(scanProgress.bytesFound)}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={cancelScan}
                  className="btn-press shrink-0 rounded-lg border border-[var(--color-sand)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-ink)]/70 hover:bg-[var(--color-mist)]"
                >
                  取消扫描
                </button>
              </div>
            </div>
          )}
          {error && (
            <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
          )}
        </div>
      </section>

      <main
        ref={scrollRef}
        className={[
          "relative flex-1 min-h-0 px-7 overflow-auto scroll-thin",
          showFooter ? "pb-28" : "pb-7",
        ].join(" ")}
      >
        <div className="animate-fade-up" style={{ animationDelay: "90ms" }}>
        {phase === "idle" && items.length === 0 && (
          <div className="ws-empty flex flex-col items-center justify-center rounded-2xl px-6 py-14 text-center">
            <span className="ws-mode-icon mb-3 flex size-12 items-center justify-center rounded-2xl opacity-80">
              <ModeIcon size={26} weight="duotone" />
            </span>
            <p className="text-[13.5px] text-[var(--color-ink)]/50 max-w-[36ch] leading-relaxed">
              {meta.emptyHint}
            </p>
          </div>
        )}

        {(phase === "ready" || phase === "done" || phase === "cleaning") &&
          items.length > 0 && (
            <div className="ws-toolbar mb-4 flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5">
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
                  placeholder="搜索路径…（Ctrl+F）"
                  disabled={phase === "cleaning"}
                  className="home-input w-full rounded-xl border border-[var(--color-sand)]/80 bg-white/85 py-1.5 pl-8 pr-3 text-[12.5px] font-mono outline-none focus:border-[var(--color-sea-bright)] disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={() => setSortBySize((v) => !v)}
                disabled={phase === "cleaning"}
                className={chipClass(sortBySize)}
                title="按体积从大到小排序"
              >
                <SortDescending size={13} weight="bold" className="inline mr-1 -mt-px" />
                按大小
              </button>
              <span className="text-[11px] font-mono text-[var(--color-ink)]/45 tabular-nums">
                {visibleItemCount} 项可见
                {searchQuery.trim() ? ` / ${items.length} 总计` : ""}
              </span>
            </div>
          )}

        {lastScanSummary &&
          !scanBannerDismissed &&
          (phase === "ready" || phase === "done") &&
          items.length > 0 && (
            <div className="ws-scan-banner mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-3.5 py-2.5 animate-fade-up">
              <p className="text-[12.5px] text-[var(--color-ink)]/70">
                扫描完成：发现{" "}
                <span className="font-mono font-semibold text-[var(--color-sea)]">
                  {lastScanSummary.count}
                </span>{" "}
                项，合计{" "}
                <span className="font-mono font-semibold text-[var(--color-sea)]">
                  {formatBytes(lastScanSummary.bytes)}
                </span>
                。悬停行可复制路径或定位到文件夹。
              </p>
              <button
                type="button"
                onClick={() => setScanBannerDismissed(true)}
                className="btn-press shrink-0 rounded-lg p-1 text-[var(--color-ink)]/40 hover:bg-white/80 hover:text-[var(--color-ink)]"
                aria-label="关闭提示"
              >
                <X size={14} weight="bold" />
              </button>
            </div>
          )}

        {searchQuery.trim() && visibleItemCount === 0 && items.length > 0 && (
          <div className="ws-empty mb-4 rounded-2xl px-6 py-10 text-center">
            <p className="text-[13px] text-[var(--color-ink)]/50">
              没有匹配「{searchQuery}」的结果
            </p>
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="btn-press mt-2 text-[12px] font-medium text-[var(--color-sea)] hover:underline"
            >
              清除搜索
            </button>
          </div>
        )}

        <div className="space-y-4">
          {grouped.map(([category, catItems]) => {
            const visibleItems = catItems.filter((i) => !goneIds.has(i.id));
            if (visibleItems.length === 0) return null;
            const label = visibleItems[0]?.categoryLabel ?? category;
            const catBytes = visibleItems.reduce((s, i) => s + i.bytes, 0);
            const selectable = visibleItems.filter(
              (i) => !exitingIds.has(i.id) && isSelectable(i),
            );
            const allOn =
              selectable.length > 0 &&
              selectable.every((i) => selected.has(i.id));
            const collapsed = collapsedCategories.has(category);

            const dupeGroups =
              category === "duplicate_files"
                ? (() => {
                    const g = new Map<string, ScanItem[]>();
                    for (const item of visibleItems) {
                      const key = item.groupId ?? item.id;
                      const list = g.get(key) ?? [];
                      list.push(item);
                      g.set(key, list);
                    }
                    return [...g.entries()];
                  })()
                : null;

            return (
              <section key={category}>
                <div className="flex items-center justify-between mb-2 px-0.5 gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleCategoryCollapse(category)}
                      className="btn-press inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-[var(--color-ink)]/45 hover:bg-white/70 hover:text-[var(--color-ink)]"
                      aria-expanded={!collapsed}
                      aria-label={collapsed ? "展开分类" : "折叠分类"}
                    >
                      <CaretDown
                        size={14}
                        weight="bold"
                        className={[
                          "ws-category-toggle",
                          collapsed ? "ws-category-toggle--collapsed" : "",
                        ].join(" ")}
                      />
                    </button>
                    <h2 className="text-[13px] font-semibold tracking-tight text-[var(--color-ink)] truncate">
                      {label}
                    </h2>
                    <button
                      type="button"
                      onClick={() => toggleCategory(catItems, !allOn)}
                      disabled={phase === "cleaning" || collapsed}
                      className="btn-press shrink-0 text-xs text-[var(--color-sea)] hover:underline disabled:opacity-40"
                    >
                      {allOn ? "取消全选" : "全选"}
                    </button>
                  </div>
                  <span className="shrink-0 text-[11px] font-mono text-[var(--color-ink)]/45">
                    {formatBytes(catBytes)} · {visibleItems.length} 项
                  </span>
                </div>

                {!collapsed && (
                  <>
                {dupeGroups ? (
                  <div className="space-y-2.5">
                    {dupeGroups.map(([gid, group]) => (
                      <div
                        key={gid}
                        className="ws-list rounded-2xl overflow-hidden"
                      >
                        <div className="px-3.5 py-2 text-[11px] text-[var(--color-ink)]/50 border-b border-[var(--color-sand)]/50 bg-white/30">
                          重复组 · {group.length} 份 ·{" "}
                          {formatBytes(group[0]?.bytes ?? 0)}
                        </div>
                        <ul className="divide-y divide-[var(--color-sand)]/45">
                          {group.map((item) => renderItemRow(item))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul className="ws-list rounded-2xl divide-y divide-[var(--color-sand)]/45 overflow-hidden">
                    {visibleItems.map((item) => renderItemRow(item))}
                  </ul>
                )}
                  </>
                )}
              </section>
            );
          })}
        </div>
        </div>
        <ScrollEdgeFabs
          scrollRef={scrollRef}
          contentKey={`${listEpoch}-${visibleItemCount}-${phase}`}
        />
      </main>

      {showFooter && (
        <footer className="fixed bottom-0 inset-x-0 z-40 border-t border-[var(--color-sand)]/80 bg-[var(--color-foam)]/92 backdrop-blur-md px-7 py-3.5 animate-footer-rise">
          <div className="flex flex-wrap items-center gap-3 justify-between max-w-[1100px]">
            <div className="min-w-0">
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
            </div>
            <button
              type="button"
              disabled={selectedItems.length === 0 || cleanModalOpen}
              onClick={() => {
                setDangerousAck(false);
                setConfirmLeaving(false);
                setConfirmOpen(true);
              }}
              className="btn-press rounded-xl bg-[var(--color-ink)] text-white px-5 py-2.5 text-sm font-semibold hover:bg-[var(--color-sea)] disabled:opacity-40 min-w-[7.5rem]"
            >
              清理所选
            </button>
          </div>
        </footer>
      )}

      {confirmOpen && (
        <div
          className={[
            "fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 backdrop-blur-[2px] px-4 py-6",
            confirmLeaving ? "animate-backdrop-out" : "animate-backdrop-in",
          ].join(" ")}
          onClick={() => closeConfirm()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className={[
              "flex w-full max-w-lg max-h-[min(88vh,640px)] flex-col rounded-2xl bg-white shadow-xl overflow-hidden",
              confirmLeaving ? "animate-modal-out" : "animate-modal-in",
            ].join(" ")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-6 pt-6 pb-3">
              <h3
                id="confirm-title"
                className="text-lg font-semibold tracking-tight"
              >
                确认清理？
              </h3>
              <p className="mt-2 text-sm text-[var(--color-ink)]/70 leading-relaxed">
                将{toRecycleBin ? "移入回收站" : "永久删除"}{" "}
                <strong>{selectedItems.length}</strong> 项，预计释放{" "}
                <strong className="font-mono">
                  {formatBytes(selectedBytes)}
                </strong>
                。
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-6 pb-2">
              <section
                aria-label="所选清理项"
                className="rounded-xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/35 overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2 border-b border-[var(--color-sand)]/50 px-3 py-2">
                  <p className="text-[12px] font-semibold text-[var(--color-ink)]/75">
                    所选项目
                  </p>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink)]/45">
                    {confirmItems.length} 项
                  </span>
                </div>
                <ul className="max-h-52 divide-y divide-[var(--color-sand)]/45 overflow-y-auto scroll-thin">
                  {confirmItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-2.5 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate font-mono text-[11.5px] text-[var(--color-ink)]/80"
                          title={item.path}
                        >
                          {item.path}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${riskClass(item.risk)}`}
                          >
                            {riskLabel(item.risk)}
                          </span>
                          {item.categoryLabel && (
                            <span className="truncate text-[10px] text-[var(--color-ink)]/42">
                              {item.categoryLabel}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-[var(--color-ink)]/55">
                        {formatBytes(item.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {dangerousSelected.length > 0 && (
                <div className="mt-3 rounded-xl border border-[var(--color-danger)]/30 bg-red-50 px-3.5 py-3">
                  <p className="text-[12.5px] font-medium text-[var(--color-danger)]">
                    含 {dangerousSelected.length} 项高风险内容，请仔细核对
                  </p>
                  <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[12.5px] text-[var(--color-ink)]/80">
                    <input
                      type="checkbox"
                      checked={dangerousAck}
                      onChange={(e) => setDangerousAck(e.target.checked)}
                      className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-danger)] focus:ring-[var(--color-danger)]/30"
                    />
                    <span>我了解风险，确认处理这些高风险项</span>
                  </label>
                </div>
              )}

              <div className="mt-3 rounded-xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/40 p-3.5">
                <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-[var(--color-ink)]/80">
                  <input
                    type="checkbox"
                    checked={toRecycleBin}
                    onChange={(e) => setToRecycleBin(e.target.checked)}
                    className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-sea)] focus:ring-[var(--color-sea)]/30"
                  />
                  <span>
                    <span className="font-medium">移到回收站</span>
                    <span className="mt-0.5 block text-[11.5px] text-[var(--color-ink)]/45">
                      代替永久删除，可从回收站恢复
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="shrink-0 flex justify-end gap-2 border-t border-[var(--color-sand)]/50 px-6 py-4">
              <button
                type="button"
                onClick={() => closeConfirm()}
                className="btn-press rounded-xl px-4 py-2 text-sm border border-[var(--color-sand)] hover:bg-[var(--color-mist)]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={
                  dangerousSelected.length > 0 && !dangerousAck
                }
                onClick={() => void runClean()}
                className="btn-press rounded-xl px-4 py-2 text-sm bg-[var(--color-sea)] text-white font-semibold hover:bg-[var(--color-sea-bright)] disabled:opacity-40"
              >
                {toRecycleBin ? "移入回收站" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProtectPathsModal
        open={protectOpen}
        leaving={protectLeaving}
        paths={protectedPaths}
        input={protectInput}
        onInputChange={setProtectInput}
        onAdd={() => void addProtected()}
        onRemove={(p) => void removeProtected(p)}
        onClose={closeProtect}
      />

      <CleanProgressModal
        open={cleanModalOpen}
        leaving={cleanModalLeaving}
        phase={cleanPhase}
        cleanStage={cleanStage}
        cleanProgressPct={cleanProgressPct}
        cleanProgress={cleanProgress}
        report={report}
        error={error}
        animatedFreed={
          cleanPhase === "done" ? animatedReportFreed : animatedFreed
        }
        selectedCount={lastCleanSelectedCount}
        selectedBytes={lastCleanSelectedBytes}
        onClose={closeCleanModal}
        onRetry={() => void executeClean()}
        onCancel={cancelClean}
      />
    </div>
  );
}
