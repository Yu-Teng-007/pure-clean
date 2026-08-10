import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowsClockwise,
  Broom,
  Memory,
} from "@phosphor-icons/react";
import MemoryCleanModal, {
  type MemoryCleanPhase,
} from "./MemoryCleanModal";
import ScrollEdgeFabs from "./ScrollEdgeFabs";
import WorkspaceHeader from "./WorkspaceHeader";
import {
  formatBytes,
  type MemoryCleanReport,
  type MemorySnapshot,
  type ProcessMemoryItem,
} from "./types";

interface MemoryWorkspaceProps {
  onBack: () => void;
}

const MODAL_OUT_MS = 180;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function useAnimatedNumber(target: number, duration = 520): number {
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
      setValue(Math.round(from + delta * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

export default function MemoryWorkspace({ onBack }: MemoryWorkspaceProps) {
  const [snap, setSnap] = useState<MemorySnapshot | null>(null);
  const [processes, setProcesses] = useState<ProcessMemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPid, setBusyPid] = useState<number | null>(null);
  const [activeCleanPid, setActiveCleanPid] = useState<number | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [rowHint, setRowHint] = useState<Record<number, string>>({});

  const [modalOpen, setModalOpen] = useState(false);
  const [modalLeaving, setModalLeaving] = useState(false);
  const [phase, setPhase] = useState<MemoryCleanPhase>("running");
  const [cleanStage, setCleanStage] = useState(0);
  const [cleanProgress, setCleanProgress] = useState(0);
  const [report, setReport] = useState<MemoryCleanReport | null>(null);
  const [cleanError, setCleanError] = useState<string | null>(null);
  const [beforeSnap, setBeforeSnap] = useState<MemorySnapshot | null>(null);
  const cleaningRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const animatedUsed = useAnimatedNumber(snap?.usedBytes ?? 0);
  const animatedAvailable = useAnimatedNumber(snap?.availableBytes ?? 0);
  const animatedFreed = useAnimatedNumber(report?.freedBytes ?? 0);
  const animatedPct = useAnimatedNumber(
    snap ? Math.round(Math.min(100, Math.max(0, snap.usedPercent))) : 0,
    640,
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const [s, list] = await Promise.all([
        invoke<MemorySnapshot>("get_memory_snapshot"),
        invoke<ProcessMemoryItem[]>("list_memory_processes", { limit: 60 }),
      ]);
      setSnap(s);
      setProcesses(list);
    } catch (e) {
      setListError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 弹窗清理进行中：阶段 + 进度
  useEffect(() => {
    if (!modalOpen || phase !== "running") return;

    if (prefersReducedMotion()) {
      setCleanProgress(70);
      return;
    }

    let stage = 0;
    let progress = 8;

    const stageTimer = window.setInterval(() => {
      stage = Math.min(2, stage + 1);
      setCleanStage(stage);
    }, 420);

    const progressTimer = window.setInterval(() => {
      progress = Math.min(92, progress + 3 + Math.random() * 5);
      setCleanProgress(progress);
    }, 160);

    return () => {
      window.clearInterval(stageTimer);
      window.clearInterval(progressTimer);
    };
  }, [modalOpen, phase]);

  const closeModal = useCallback(() => {
    if (cleaningRef.current || modalLeaving) return;
    if (prefersReducedMotion()) {
      setModalOpen(false);
      setModalLeaving(false);
      return;
    }
    setModalLeaving(true);
    window.setTimeout(() => {
      setModalOpen(false);
      setModalLeaving(false);
    }, MODAL_OUT_MS);
  }, [modalLeaving]);

  const runClean = async () => {
    if (cleaningRef.current || busyPid != null) return;
    cleaningRef.current = true;

    setModalOpen(true);
    setModalLeaving(false);
    setPhase("running");
    setCleanStage(0);
    setCleanProgress(8);
    setReport(null);
    setCleanError(null);
    setBeforeSnap(snap);

    const minSpin = prefersReducedMotion()
      ? Promise.resolve()
      : new Promise<void>((r) => window.setTimeout(r, 720));

    try {
      const [result] = await Promise.all([
        invoke<MemoryCleanReport>("clean_memory"),
        minSpin,
      ]);
      setCleanProgress(100);
      setCleanStage(3);
      setReport(result);
      setSnap(result.after);
      setPhase("done");

      const list = await invoke<ProcessMemoryItem[]>("list_memory_processes", {
        limit: 60,
      });
      setProcesses(list);
    } catch (e) {
      setCleanError(String(e));
      setPhase("error");
    } finally {
      cleaningRef.current = false;
    }
  };

  const trimOne = async (item: ProcessMemoryItem) => {
    if (busyPid != null || cleaningRef.current || modalOpen) return;
    setBusyPid(item.pid);
    setActiveCleanPid(item.pid);
    setRowHint((prev) => {
      const next = { ...prev };
      delete next[item.pid];
      return next;
    });
    try {
      const freed = await invoke<number>("trim_process_working_set", {
        pid: item.pid,
      });
      setRowHint((prev) => ({
        ...prev,
        [item.pid]: `已压缩约 ${formatBytes(freed)}`,
      }));
      const s = await invoke<MemorySnapshot>("get_memory_snapshot");
      setSnap(s);
      setProcesses((prev) =>
        prev.map((p) =>
          p.pid === item.pid
            ? {
                ...p,
                workingSetBytes: Math.max(0, p.workingSetBytes - freed),
              }
            : p,
        ),
      );
      void invoke<ProcessMemoryItem[]>("list_memory_processes", {
        limit: 60,
      }).then(setProcesses);
    } catch (e) {
      setRowHint((prev) => ({ ...prev, [item.pid]: String(e) }));
    } finally {
      setBusyPid(null);
      setActiveCleanPid(null);
    }
  };

  const pct = animatedPct;
  const tight = pct >= 90;
  const pageBusy = modalOpen || busyPid != null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <WorkspaceHeader
        title="内存清理"
        subtitle="压缩进程工作集并尝试刷新待机内存"
        icon={<Memory size={18} weight="duotone" />}
        onBack={onBack}
        backDisabled={modalOpen && phase === "running"}
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
              onClick={() => void runClean()}
              disabled={pageBusy || loading}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-sea)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--color-sea-bright)] disabled:opacity-50"
            >
              <Broom size={14} weight="bold" />
              一键清理
            </button>
          </>
        }
      />

      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto px-6 pb-6 space-y-4"
        >
        {listError && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-[var(--color-danger)] animate-fade-up">
            {listError}
          </p>
        )}

        <section className="ws-list rounded-2xl overflow-hidden">
          <h2 className="px-4 pt-3.5 pb-1 text-[12px] font-semibold text-[var(--color-ink)]/60">
            内存概况
          </h2>
          <div className="px-4 pt-3 pb-4">
            {snap ? (
              <>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] text-[var(--color-ink)]/45">已用</p>
                    <p className="mt-0.5 font-mono text-[1.35rem] font-semibold tracking-tight text-[var(--color-ink)] tabular-nums">
                      {formatBytes(animatedUsed)}
                      <span className="ml-1.5 text-[12px] font-medium text-[var(--color-ink)]/40">
                        {pct}%
                      </span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-[var(--color-ink)]/45">
                      可用 / 总计
                    </p>
                    <p className="mt-0.5 font-mono text-[13px] text-[var(--color-ink)]/70 tabular-nums">
                      {formatBytes(animatedAvailable)} /{" "}
                      {formatBytes(snap.totalBytes)}
                    </p>
                  </div>
                </div>
                <div
                  className="home-disk-track"
                  role="meter"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`内存已用 ${pct}%`}
                >
                  <div
                    className={`home-disk-fill ${tight ? "home-disk-fill--tight" : ""}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            ) : (
              <p className="text-[12px] text-[var(--color-ink)]/45">
                {loading ? "正在读取内存信息…" : "暂无数据"}
              </p>
            )}
          </div>
        </section>

        <section className="ws-list rounded-2xl overflow-hidden">
          <h2 className="px-4 pt-3.5 pb-1 text-[12px] font-semibold text-[var(--color-ink)]/60 flex items-center justify-between gap-2">
            <span>
              占用进程
              <span className="ml-2 font-mono text-[11px] text-[var(--color-ink)]/40">
                {processes.length}
              </span>
            </span>
            <span className="font-normal text-[11px] text-[var(--color-ink)]/40">
              按工作集排序
            </span>
          </h2>

          {loading && processes.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-[var(--color-ink)]/45">
              正在枚举进程…
            </div>
          ) : processes.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-[var(--color-ink)]/45">
              未获取到进程内存信息
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-sand)]/45">
              {processes.map((item, index) => {
                const rowBusy = busyPid === item.pid;
                const sweeping = activeCleanPid === item.pid;
                const hint = rowHint[item.pid];
                const enterStyle = {
                  animationDelay: `${Math.min(index, 12) * 28}ms`,
                } satisfies CSSProperties;
                return (
                  <li
                    key={`${item.pid}-${item.name}`}
                    className={[
                      "px-4 py-3.5 transition-[background-color] duration-200 animate-row-enter",
                      sweeping ? "animate-row-cleaning" : "",
                    ].join(" ")}
                    style={enterStyle}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={[
                          "mt-0.5 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--color-sand)]/70 bg-white/70 transition-transform duration-200",
                          sweeping ? "scale-105" : "",
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
                          <Memory
                            size={18}
                            weight="duotone"
                            className={
                              sweeping
                                ? "text-[var(--color-sea)]"
                                : "text-[var(--color-ink)]/35"
                            }
                          />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13.5px] font-semibold text-[var(--color-ink)]">
                            {item.name}
                          </span>
                          <span className="rounded-md bg-[var(--color-ink)]/6 px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-ink)]/45">
                            PID {item.pid}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono text-[12px] text-[var(--color-sea)] tabular-nums">
                          工作集 {formatBytes(item.workingSetBytes)}
                          <span className="ml-2 text-[var(--color-ink)]/40">
                            提交 {formatBytes(item.privateBytes)}
                          </span>
                        </p>
                        {item.path && (
                          <p
                            className="mt-0.5 truncate text-[11px] text-[var(--color-ink)]/40"
                            title={item.path}
                          >
                            {item.path}
                          </p>
                        )}
                        {hint && (
                          <p
                            className={[
                              "mt-1 text-[11.5px] animate-fade-up",
                              hint.startsWith("已压缩")
                                ? "text-[var(--color-sea)]"
                                : "text-[var(--color-danger)]",
                            ].join(" ")}
                          >
                            {hint}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void trimOne(item)}
                        disabled={pageBusy}
                        className="btn-press shrink-0 rounded-lg border border-[var(--color-sand)]/80 bg-white/70 px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-ink)]/70 hover:border-[var(--color-sea)]/30 hover:text-[var(--color-sea)] disabled:opacity-50"
                      >
                        {rowBusy ? "压缩中" : "压缩"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="px-1 text-[11px] leading-relaxed text-[var(--color-ink)]/40">
          压缩工作集不会结束进程，仅将未活跃页退回系统；部分受保护进程可能失败。深度清理待机列表通常需要管理员权限。
        </p>
        </div>

        <ScrollEdgeFabs
          scrollRef={scrollRef}
          contentKey={processes.length}
        />
      </div>

      <MemoryCleanModal
        open={modalOpen}
        leaving={modalLeaving}
        phase={phase}
        cleanStage={cleanStage}
        cleanProgress={cleanProgress}
        report={report}
        error={cleanError}
        animatedFreed={animatedFreed}
        beforeSnap={beforeSnap}
        onClose={closeModal}
        onRetry={() => void runClean()}
      />
    </div>
  );
}
