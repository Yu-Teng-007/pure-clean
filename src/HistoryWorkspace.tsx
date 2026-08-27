import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ClockCountdown, MagnifyingGlass, Trash } from "@phosphor-icons/react";
import ConfirmDialog from "./ConfirmDialog";
import HistoryDetailModal from "./HistoryDetailModal";
import { closeWithAnimation } from "./motion";
import WorkspaceHeader from "./WorkspaceHeader";
import { cleanModeLabel } from "./modes";
import { formatBytes, type HistoryEntry } from "./types";

interface HistoryWorkspaceProps {
  onBack: () => void;
}

type FilterMode = "all" | "optimize" | "clean";

export default function HistoryWorkspace({ onBack }: HistoryWorkspaceProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryEntry | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLeaving, setDetailLeaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearConfirmLeaving, setClearConfirmLeaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await invoke<HistoryEntry[]>("load_history");
      setHistory(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return history.filter((h) => {
      if (filter === "optimize" && h.mode !== "optimize") return false;
      if (filter === "clean" && h.mode === "optimize") return false;
      if (!q) return true;
      const label = cleanModeLabel(h.mode).toLowerCase();
      return label.includes(q) || h.timestamp.toLowerCase().includes(q);
    });
  }, [history, filter, searchQuery]);

  const stats = useMemo(() => {
    const real = history.filter((h) => !h.dryRun);
    return {
      totalFreed: real.reduce((s, h) => s + h.freedBytes, 0),
      totalSuccess: real.reduce((s, h) => s + h.successCount, 0),
      totalFailed: real.reduce((s, h) => s + h.failureCount, 0),
    };
  }, [history]);

  const openDetail = (entry: HistoryEntry) => {
    setDetail(entry);
    setDetailLeaving(false);
    setDetailOpen(true);
  };

  const closeDetail = useCallback(() => {
    if (detailLeaving) return;
    closeWithAnimation(setDetailLeaving, () => {
      setDetailOpen(false);
      setDetailLeaving(false);
      setDetail(null);
    });
  }, [detailLeaving]);

  const closeClearConfirm = useCallback(() => {
    if (clearConfirmLeaving || clearing) return;
    closeWithAnimation(setClearConfirmLeaving, () => {
      setClearConfirmOpen(false);
      setClearConfirmLeaving(false);
    });
  }, [clearConfirmLeaving, clearing]);

  const clearAll = async () => {
    if (!history.length) return;
    setClearing(true);
    try {
      await invoke("clear_history");
      setHistory([]);
      setError(null);
      setClearConfirmOpen(false);
      setClearConfirmLeaving(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setClearing(false);
    }
  };

  const filters: { id: FilterMode; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "optimize", label: "智能优化" },
    { id: "clean", label: "场景清理" },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <WorkspaceHeader
        title="清理历史"
        subtitle={`最多保留 50 条 · 当前 ${history.length} 条`}
        icon={<ClockCountdown size={18} weight="duotone" />}
        onBack={onBack}
        actions={
          <button
            type="button"
            disabled={!history.length || clearing}
            onClick={() => {
              setClearConfirmLeaving(false);
              setClearConfirmOpen(true);
            }}
            className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white/70 px-3 py-1.5 text-[12px] font-medium text-[var(--color-ink)]/70 hover:bg-white disabled:opacity-40"
          >
            <Trash size={14} weight="bold" />
            清空
          </button>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-7 pb-7">
        {history.length > 0 && (
          <div
            className="mb-4 grid grid-cols-3 gap-2.5 animate-fade-up"
            aria-label="历史统计"
          >
            <div className="home-stat rounded-2xl px-3.5 py-3">
              <p className="text-[10.5px] text-[var(--color-ink)]/45">累计释放</p>
              <p className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-[var(--color-sea)]">
                {formatBytes(stats.totalFreed)}
              </p>
            </div>
            <div className="home-stat rounded-2xl px-3.5 py-3">
              <p className="text-[10.5px] text-[var(--color-ink)]/45">成功项</p>
              <p className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-[var(--color-ink)]">
                {stats.totalSuccess}
              </p>
            </div>
            <div className="home-stat rounded-2xl px-3.5 py-3">
              <p className="text-[10.5px] text-[var(--color-ink)]/45">失败项</p>
              <p className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-[var(--color-danger)]">
                {stats.totalFailed}
              </p>
            </div>
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2 animate-fade-up">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={[
                "btn-press rounded-xl px-2.5 py-1 text-xs font-medium border",
                filter === f.id
                  ? "border-[var(--color-sea)] bg-[var(--color-sea)]/10 text-[var(--color-sea)]"
                  : "border-[var(--color-sand)] bg-white text-[var(--color-ink)]/70 hover:bg-[var(--color-mist)]",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
          {history.length > 3 && (
            <div className="relative ml-auto min-w-[10rem] flex-1 max-w-xs">
              <MagnifyingGlass
                size={14}
                weight="bold"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-ink)]/35"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索记录…"
                className="home-input w-full rounded-xl border border-[var(--color-sand)] bg-white/85 py-1.5 pl-8 pr-3 text-[12px] outline-none focus:border-[var(--color-sea-bright)]"
              />
            </div>
          )}
        </div>

        {error && (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
            {error}
          </p>
        )}

        {filtered.length === 0 ? (
          <div className="ws-empty flex flex-col items-center justify-center rounded-2xl px-6 py-14 text-center animate-fade-up">
            <span className="ws-mode-icon mb-3 flex size-12 items-center justify-center rounded-2xl opacity-80">
              <ClockCountdown size={26} weight="duotone" />
            </span>
            <p className="text-[13.5px] text-[var(--color-ink)]/50">
              {history.length === 0
                ? "完成一次清理后，记录会出现在这里"
                : "当前筛选下没有记录"}
            </p>
          </div>
        ) : (
          <ul className="ws-list divide-y divide-[var(--color-sand)]/45 overflow-hidden rounded-2xl animate-fade-up">
            {filtered.map((h, i) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => openDetail(h)}
                  className="btn-press w-full px-3.5 py-3 text-left hover:bg-white/55 animate-row-enter"
                  style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-[var(--color-ink)]">
                        {cleanModeLabel(h.mode)}
                        {h.toRecycleBin ? (
                          <span className="ml-2 rounded-md bg-[var(--color-sea)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-sea)]">
                            回收站
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-[var(--color-ink)]/42">
                        {h.timestamp}
                        {h.failureCount > 0
                          ? ` · 失败 ${h.failureCount}`
                          : ` · 成功 ${h.successCount}`}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-[13px] font-semibold tabular-nums text-[var(--color-sea)]">
                      {formatBytes(h.freedBytes)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <HistoryDetailModal
        open={detailOpen}
        leaving={detailLeaving}
        entry={detail}
        onClose={closeDetail}
        onRestored={(updated) => {
          setDetail(updated);
          setHistory((prev) =>
            prev.map((h) => (h.id === updated.id ? updated : h)),
          );
        }}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        leaving={clearConfirmLeaving}
        title="清空全部历史？"
        description={
          <>
            将删除全部 {history.length} 条清理记录，此操作不可撤销。
            已清理的文件不会因此恢复。
          </>
        }
        confirmLabel="清空历史"
        variant="danger"
        busy={clearing}
        onConfirm={() => void clearAll()}
        onCancel={closeClearConfirm}
      />
    </div>
  );
}
