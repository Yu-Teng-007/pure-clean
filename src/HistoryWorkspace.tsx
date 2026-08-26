import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ClockCountdown, Trash } from "@phosphor-icons/react";
import HistoryDetailModal from "./HistoryDetailModal";
import WorkspaceHeader from "./WorkspaceHeader";
import { cleanModeLabel } from "./modes";
import { formatBytes, type HistoryEntry } from "./types";

interface HistoryWorkspaceProps {
  onBack: () => void;
}

const MODAL_OUT_MS = 180;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
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
    return history.filter((h) => {
      if (filter === "optimize") return h.mode === "optimize";
      if (filter === "clean") return h.mode !== "optimize";
      return true;
    });
  }, [history, filter]);

  const openDetail = (entry: HistoryEntry) => {
    setDetail(entry);
    setDetailLeaving(false);
    setDetailOpen(true);
  };

  const closeDetail = useCallback(() => {
    if (detailLeaving) return;
    if (prefersReducedMotion()) {
      setDetailOpen(false);
      setDetailLeaving(false);
      setDetail(null);
      return;
    }
    setDetailLeaving(true);
    window.setTimeout(() => {
      setDetailOpen(false);
      setDetailLeaving(false);
      setDetail(null);
    }, MODAL_OUT_MS);
  }, [detailLeaving]);

  const clearAll = async () => {
    if (!history.length) return;
    if (!window.confirm("确定清空全部清理历史？此操作不可撤销。")) return;
    setClearing(true);
    try {
      await invoke("clear_history");
      setHistory([]);
      setError(null);
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
            onClick={() => void clearAll()}
            className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white/70 px-3 py-1.5 text-[12px] font-medium text-[var(--color-ink)]/70 hover:bg-white disabled:opacity-40"
          >
            <Trash size={14} weight="bold" />
            清空
          </button>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-7">
        <div className="mb-4 flex flex-wrap gap-1.5 animate-fade-up">
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
      />
    </div>
  );
}
