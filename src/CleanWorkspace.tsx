import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderSimplePlus,
  MagnifyingGlass,
  ShieldWarning,
  X,
} from "@phosphor-icons/react";
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
          path.toLowerCase().includes("docker"))),
  );
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
  const [dryRun, setDryRun] = useState(false);
  const [activeCleanId, setActiveCleanId] = useState<string | null>(null);
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  const [goneIds, setGoneIds] = useState<Set<string>>(new Set());
  const [listEpoch, setListEpoch] = useState(0);

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
  const dryRunRef = useRef(false);
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
    dryRunRef.current = dryRun;
  }, [dryRun]);
  useEffect(() => {
    toRecycleBinRef.current = toRecycleBin;
  }, [toRecycleBin]);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await invoke<AppConfig>("load_config");
        const fromInitial =
          initialRoots && initialRoots.length > 0 ? initialRoots : null;
        setRoots(
          fromInitial ??
            (cfg.scanRoots.length ? cfg.scanRoots : ["D:\\YHDJA"]),
        );
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
        setRoots(
          initialRoots && initialRoots.length > 0
            ? initialRoots
            : ["D:\\YHDJA"],
        );
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

    const useDryRun = dryRunRef.current;
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
          dryRun: useDryRun,
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
          return !failedPaths.has(i.path);
        })
        .map((i) => i.id);

      setActiveCleanId(null);

      // Dry-run does not delete — keep list intact.
      if (!result.dryRun) {
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
            return failedPaths.has(i.path);
          }),
        );
        setSelected(new Set());
      }

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
          disabled={phase === "cleaning" || isExiting}
          className="mt-1 accent-[var(--color-sea)] transition-transform duration-100 active:scale-90"
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
            {isCleaning && (
              <span className="text-[10px] font-medium text-[var(--color-sea-bright)] animate-pulse-soft">
                清理中
              </span>
            )}
          </div>
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
                  placeholder="添加扫描根目录，如 D:\YHDJA"
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
        className={[
          "flex-1 min-h-0 px-7 overflow-auto",
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

        <div className="space-y-4">
          {grouped.map(([category, catItems]) => {
            const visibleItems = catItems.filter((i) => !goneIds.has(i.id));
            if (visibleItems.length === 0) return null;
            const label = visibleItems[0]?.categoryLabel ?? category;
            const catBytes = visibleItems.reduce((s, i) => s + i.bytes, 0);
            const selectable = visibleItems.filter((i) => !exitingIds.has(i.id));
            const allOn =
              selectable.length > 0 &&
              selectable.every((i) => selected.has(i.id));

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
                  <div className="flex items-center gap-2.5 min-w-0">
                    <h2 className="text-[13px] font-semibold tracking-tight text-[var(--color-ink)]">
                      {label}
                    </h2>
                    <button
                      type="button"
                      onClick={() => toggleCategory(catItems, !allOn)}
                      disabled={phase === "cleaning"}
                      className="btn-press text-xs text-[var(--color-sea)] hover:underline disabled:opacity-40"
                    >
                      {allOn ? "取消全选" : "全选"}
                    </button>
                  </div>
                  <span className="shrink-0 text-[11px] font-mono text-[var(--color-ink)]/45">
                    {formatBytes(catBytes)} · {visibleItems.length} 项
                  </span>
                </div>

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
              </section>
            );
          })}
        </div>
        </div>
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
            <h3
              id="confirm-title"
              className="text-lg font-semibold tracking-tight"
            >
              确认清理？
            </h3>
            <p className="mt-2 text-sm text-[var(--color-ink)]/70 leading-relaxed">
              {dryRun ? (
                <>
                  将<strong>模拟</strong>处理{" "}
                  <strong>{selectedItems.length}</strong> 项，预计可释放{" "}
                  <strong className="font-mono">
                    {formatBytes(selectedBytes)}
                  </strong>
                  ，不会实际删除任何文件。
                </>
              ) : (
                <>
                  将{toRecycleBin ? "移入回收站" : "永久删除"}{" "}
                  <strong>{selectedItems.length}</strong> 项，预计释放{" "}
                  <strong className="font-mono">
                    {formatBytes(selectedBytes)}
                  </strong>
                  。缓存类目录通常可安全重建；高风险项请确认无程序占用。
                </>
              )}
            </p>

            <div className="mt-4 space-y-2.5 rounded-xl border border-[var(--color-sand)]/70 bg-[var(--color-mist)]/40 p-3.5">
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-[var(--color-ink)]/80">
                <input
                  type="checkbox"
                  checked={toRecycleBin}
                  disabled={dryRun}
                  onChange={(e) => setToRecycleBin(e.target.checked)}
                  className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-sea)] focus:ring-[var(--color-sea)]/30 disabled:opacity-40"
                />
                <span>
                  <span className="font-medium">移到回收站</span>
                  <span className="mt-0.5 block text-[11.5px] text-[var(--color-ink)]/45">
                    代替永久删除，可从回收站恢复
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-[var(--color-ink)]/80">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => {
                    setDryRun(e.target.checked);
                  }}
                  className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-sea)] focus:ring-[var(--color-sea)]/30"
                />
                <span>
                  <span className="font-medium">仅模拟（Dry-run）</span>
                  <span className="mt-0.5 block text-[11.5px] text-[var(--color-ink)]/45">
                    只估算释放空间，不实际删除
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => closeConfirm()}
                className="btn-press rounded-xl px-4 py-2 text-sm border border-[var(--color-sand)] hover:bg-[var(--color-mist)]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void runClean()}
                className="btn-press rounded-xl px-4 py-2 text-sm bg-[var(--color-sea)] text-white font-semibold hover:bg-[var(--color-sea-bright)]"
              >
                {dryRun ? "开始模拟" : toRecycleBin ? "移入回收站" : "确认删除"}
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
