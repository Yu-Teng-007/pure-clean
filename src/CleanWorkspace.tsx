import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CaretDown,
  MagnifyingGlass,
  ShieldWarning,
  SortDescending,
  X,
} from "@phosphor-icons/react";
import { MODAL_OUT_MS, closeWithAnimation, prefersReducedMotion } from "./motion";
import { showToast } from "./Toast";
import { useKeyboardShortcut } from "./useKeyboardShortcut";
import ScrollEdgeFabs from "./ScrollEdgeFabs";
import { MODES, type CleanMode } from "./modes";
import { MODE_ICONS } from "./modeIcons";
import ProtectPathsModal from "./ProtectPathsModal";
import CleanProgressModal, { type DiskCleanPhase } from "./CleanProgressModal";
import WorkspaceHeader from "./WorkspaceHeader";
import CleanItemRow from "./cleanWorkspace/CleanItemRow";
import CleanScanPanel from "./cleanWorkspace/CleanScanPanel";
import CleanConfirmDialog from "./cleanWorkspace/CleanConfirmDialog";
import {
  chipClass,
  defaultThresholdBytes,
  EXIT_MS,
  isSelectable,
  matchItemByPath,
  SORT_PREF_KEY,
  thresholdPresets,
} from "./cleanWorkspace/helpers";
import { useAnimatedNumber } from "./cleanWorkspace/useAnimatedNumber";
import {
  AppConfig,
  CATEGORY_ORDER,
  Category,
  CleanProgress,
  CleanReport,
  DEFAULT_MIN_FILE_BYTES,
  DEFAULT_STALE_DAYS,
  formatBytes,
  ScanItem,
  ScanProgress,
  ScanResult,
  ScanRoot,
} from "./types";

type Phase = "idle" | "scanning" | "ready" | "cleaning" | "done";

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
  const [dupExtensions, setDupExtensions] = useState("");
  const [dupEstimateHint, setDupEstimateHint] = useState<string | null>(null);
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
      } catch (e) {
        showToast(`加载配置失败：${String(e)}`);
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
      } catch (e) {
        showToast(`保存配置失败：${String(e)}`);
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
    setDupEstimateHint(null);
    if (mode === "dupes" && roots.length > 0) {
      try {
        const extList = dupExtensions
          .split(/[,;\s]+/)
          .map((e) => e.trim())
          .filter(Boolean);
        const est = await invoke<{
          candidateFiles: number;
          estimatedSeconds: number;
        }>("estimate_duplicate_scan", {
          root: roots[0],
          minBytes: minFileBytes,
          maxDepth: 8,
          extensions: extList.length ? extList : null,
        });
        if (est.candidateFiles > 0) {
          const mins = Math.max(1, Math.round(est.estimatedSeconds / 60));
          setDupEstimateHint(
            `预计扫描 ${est.candidateFiles.toLocaleString()} 个候选文件，约需 ${mins} 分钟`,
          );
        }
      } catch {
        /* estimate optional */
      }
    }
    try {
      const extList = dupExtensions
        .split(/[,;\s]+/)
        .map((e) => e.trim())
        .filter(Boolean);
      const result = await invoke<ScanResult>("scan", {
        request: {
          roots: meta.needsRoots ? roots : [],
          categories: meta.categories,
          maxDepth: mode === "dupes" ? 8 : 6,
          minFileBytes: meta.needsThreshold ? minFileBytes : undefined,
          staleDays: meta.needsStaleDays ? staleDays : undefined,
          safeOnly: meta.safeOnly ? true : undefined,
          protectedPaths,
          dupExtensions: extList.length ? extList : undefined,
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
      if (result.dupEstimateSeconds && result.dupCandidateFiles) {
        const mins = Math.max(1, Math.round(result.dupEstimateSeconds / 60));
        showToast(
          `重复文件扫描完成 · ${result.dupCandidateFiles.toLocaleString()} 个候选 · 预估 ${mins} 分钟级`,
        );
      } else if (result.items.length === 0) {
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

  const renderItemRow = (item: ScanItem) => {
    const idx = rowIndex++;
    return (
      <CleanItemRow
        key={`${listEpoch}-${item.id}`}
        item={item}
        listEpoch={listEpoch}
        phase={phase}
        isExiting={exitingIds.has(item.id)}
        isCleaning={phase === "cleaning" && activeCleanId === item.id}
        isSelected={selected.has(item.id)}
        animationIndex={idx}
        onToggle={toggleItem}
        onOpenDiskCleanup={() => void openDiskCleanup()}
        onReveal={(path) => void revealInExplorer(path)}
      />
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

      <CleanScanPanel
        mode={mode}
        phase={phase}
        roots={roots}
        rootInput={rootInput}
        canScan={canScan}
        minFileBytes={minFileBytes}
        staleDays={staleDays}
        scanProgress={scanProgress}
        error={error}
        presets={presets}
        onRootInputChange={setRootInput}
        onAddRoot={() => void addRoot()}
        onRemoveRoot={(r) => void removeRoot(r)}
        onStartScan={() => void startScan()}
        onCancelScan={cancelScan}
        onMinFileBytesChange={(b) => void updateMinFileBytes(b)}
        onStaleDaysChange={(d) => void updateStaleDays(d)}
        dupExtensions={dupExtensions}
        dupEstimateHint={dupEstimateHint}
        onDupExtensionsChange={setDupExtensions}
      />

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
        <CleanConfirmDialog
          open={confirmOpen}
          leaving={confirmLeaving}
          selectedCount={selectedItems.length}
          selectedBytes={selectedBytes}
          confirmItems={confirmItems}
          dangerousCount={dangerousSelected.length}
          dangerousAck={dangerousAck}
          onDangerousAckChange={setDangerousAck}
          toRecycleBin={toRecycleBin}
          onToRecycleBinChange={setToRecycleBin}
          onConfirm={() => void runClean()}
          onCancel={() => closeConfirm()}
        />
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
