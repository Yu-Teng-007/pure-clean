import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AppConfig,
  CATEGORY_ORDER,
  Category,
  CleanProgress,
  CleanReport,
  formatBytes,
  ScanItem,
  ScanProgress,
  ScanResult,
} from "./types";

type Phase = "idle" | "scanning" | "ready" | "cleaning" | "done";

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
  const [selectCaution, setSelectCaution] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await invoke<AppConfig>("load_config");
        setRoots(cfg.scanRoots.length ? cfg.scanRoots : ["D:\\YHDJA"]);
        setSelectCaution(cfg.selectCautionByDefault);
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
        setCleanProgress(e.payload);
      });
      unsubs = [u1, u2];
    })();
    return () => unsubs.forEach((u) => u());
  }, []);

  const persistRoots = useCallback(async (next: string[]) => {
    setRoots(next);
    try {
      const cfg = await invoke<AppConfig>("load_config");
      await invoke("save_config", {
        config: { ...cfg, scanRoots: next },
      });
    } catch {
      /* ignore persist errors in UI */
    }
  }, []);

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
    setPhase("scanning");
    setScanProgress({ currentPath: "准备扫描…", itemsFound: 0, bytesFound: 0 });
    try {
      const result = await invoke<ScanResult>("scan", {
        request: {
          roots,
          categories: null,
          maxDepth: 6,
        },
      });
      setItems(result.items);
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
    () => items.filter((i) => selected.has(i.id)),
    [items, selected],
  );

  const selectedBytes = useMemo(
    () => selectedItems.reduce((s, i) => s + i.bytes, 0),
    [selectedItems],
  );

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCategory = (catItems: ScanItem[], on: boolean) => {
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

  const runClean = async () => {
    setConfirmOpen(false);
    setPhase("cleaning");
    setCleanProgress({
      currentPath: "开始清理…",
      done: 0,
      total: selectedItems.length,
      freedBytes: 0,
    });
    try {
      const paths = selectedItems
        .filter((i) => !i.special)
        .map((i) => i.path);
      const specials = selectedItems
        .filter((i) => i.special)
        .map((i) => i.special as string);
      const result = await invoke<CleanReport>("clean", {
        request: { paths, specials },
      });
      setReport(result);
      setPhase("done");
      // Remove successfully cleaned items from list
      const failedPaths = new Set(result.failures.map((f) => f.path));
      setItems((prev) =>
        prev.filter((i) => {
          if (!selected.has(i.id)) return true;
          if (i.special === "recycle_bin") {
            return result.failures.some((f) => f.path === "回收站");
          }
          return failedPaths.has(i.path);
        }),
      );
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
      setPhase("ready");
    }
  };

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
          扫描构建产物、依赖缓存与系统临时文件，勾选后安全释放磁盘空间。
        </p>
      </header>

      <section className="px-8 pb-4 animate-fade-up" style={{ animationDelay: "60ms" }}>
        <div className="rounded-2xl border border-[var(--color-sand)]/80 bg-white/55 backdrop-blur-sm px-5 py-4">
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={rootInput}
              onChange={(e) => setRootInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRoot()}
              placeholder="添加扫描根目录，如 D:\YHDJA"
              className="flex-1 min-w-[220px] rounded-lg border border-[var(--color-sand)] bg-white/80 px-3 py-2 text-sm font-mono outline-none focus:border-[var(--color-sea-bright)]"
            />
            <button
              type="button"
              onClick={addRoot}
              className="rounded-lg border border-[var(--color-sand)] bg-white px-3 py-2 text-sm font-medium hover:bg-[var(--color-mist)] transition"
            >
              添加 / 浏览
            </button>
            <button
              type="button"
              onClick={startScan}
              disabled={phase === "scanning" || phase === "cleaning" || roots.length === 0}
              className="rounded-lg bg-[var(--color-sea)] text-white px-4 py-2 text-sm font-semibold hover:bg-[var(--color-sea-bright)] disabled:opacity-50 transition"
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
                  className="text-[var(--color-ink)]/45 hover:text-[var(--color-danger)]"
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
          {phase === "scanning" && scanProgress && (
            <p className="mt-3 text-xs font-mono text-[var(--color-ink)]/55 truncate animate-pulse-soft">
              {scanProgress.currentPath}
              <span className="ml-2">
                · 已发现 {scanProgress.itemsFound} 项 / {formatBytes(scanProgress.bytesFound)}
              </span>
            </p>
          )}
          {error && (
            <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p>
          )}
        </div>
      </section>

      <main className="flex-1 px-8 pb-28 overflow-auto animate-fade-up" style={{ animationDelay: "120ms" }}>
        {phase === "idle" && items.length === 0 && (
          <div className="h-48 flex items-center justify-center text-[var(--color-ink)]/40 text-sm">
            添加扫描根目录后点击「开始扫描」
          </div>
        )}

        {phase === "done" && report && (
          <div className="mb-4 rounded-2xl border border-[var(--color-sea)]/30 bg-[var(--color-sea)]/8 px-5 py-4">
            <p className="text-lg font-semibold text-[var(--color-sea)]">
              预计释放 {formatBytes(report.freedBytes)}
            </p>
            <p className="text-sm text-[var(--color-ink)]/65 mt-1">
              成功 {report.successCount} 项
              {report.failures.length > 0 && ` · 失败 ${report.failures.length} 项`}
            </p>
            {report.failures.length > 0 && (
              <ul className="mt-2 space-y-1">
                {report.failures.map((f) => (
                  <li key={f.path} className="text-xs font-mono text-[var(--color-danger)]">
                    {f.path}: {f.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {phase === "cleaning" && cleanProgress && (
          <div className="mb-4">
            <div className="h-1.5 rounded-full bg-[var(--color-sand)] overflow-hidden">
              <div
                className="h-full bg-[var(--color-sea-bright)] transition-all duration-300"
                style={{
                  width: `${cleanProgress.total ? (cleanProgress.done / cleanProgress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs font-mono text-[var(--color-ink)]/55 truncate animate-pulse-soft">
              {cleanProgress.currentPath} · {cleanProgress.done}/{cleanProgress.total}
            </p>
          </div>
        )}

        <div className="space-y-5">
          {grouped.map(([category, catItems]) => {
            const label = catItems[0]?.categoryLabel ?? category;
            const catBytes = catItems.reduce((s, i) => s + i.bytes, 0);
            const allOn = catItems.every((i) => selected.has(i.id));
            return (
              <section key={category}>
                <div className="flex items-baseline justify-between mb-2 px-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold tracking-wide">{label}</h2>
                    <button
                      type="button"
                      onClick={() => toggleCategory(catItems, !allOn)}
                      className="text-xs text-[var(--color-sea)] hover:underline"
                    >
                      {allOn ? "取消全选" : "全选"}
                    </button>
                  </div>
                  <span className="text-xs font-mono text-[var(--color-ink)]/50">
                    {formatBytes(catBytes)} · {catItems.length} 项
                  </span>
                </div>
                <ul className="rounded-xl border border-[var(--color-sand)]/70 bg-white/40 divide-y divide-[var(--color-sand)]/50 overflow-hidden">
                  {catItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-white/60 transition"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleItem(item.id)}
                        className="mt-1 accent-[var(--color-sea)]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-mono truncate" title={item.path}>
                            {item.path}
                          </span>
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${riskClass(item.risk)}`}
                          >
                            {riskLabel(item.risk)}
                          </span>
                        </div>
                      </div>
                      <span className="text-sm font-mono tabular-nums whitespace-nowrap text-[var(--color-ink)]/70">
                        {formatBytes(item.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </main>

      {(phase === "ready" || phase === "done" || phase === "cleaning") && items.length > 0 && (
        <footer className="fixed bottom-0 inset-x-0 border-t border-[var(--color-sand)] bg-[var(--color-foam)]/90 backdrop-blur-md px-8 py-4">
          <div className="flex flex-wrap items-center gap-3 justify-between max-w-[1100px]">
            <div>
              <p className="text-sm font-medium">
                已选 {selectedItems.length} 项 ·{" "}
                <span className="font-mono text-[var(--color-sea)]">
                  {formatBytes(selectedBytes)}
                </span>
              </p>
              <div className="mt-1 flex gap-3 text-xs">
                <button type="button" onClick={selectAllSafe} className="text-[var(--color-sea)] hover:underline">
                  仅选安全项
                </button>
                <button type="button" onClick={clearSelection} className="text-[var(--color-ink)]/50 hover:underline">
                  清空选择
                </button>
              </div>
            </div>
            <button
              type="button"
              disabled={selectedItems.length === 0 || phase === "cleaning"}
              onClick={() => setConfirmOpen(true)}
              className="rounded-lg bg-[var(--color-ink)] text-white px-5 py-2.5 text-sm font-semibold hover:bg-[var(--color-sea)] disabled:opacity-40 transition"
            >
              清理所选
            </button>
          </div>
        </footer>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-ink)]/40 backdrop-blur-[2px] px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-fade-up">
            <h3 className="text-lg font-semibold">确认清理？</h3>
            <p className="mt-2 text-sm text-[var(--color-ink)]/70 leading-relaxed">
              将删除 <strong>{selectedItems.length}</strong> 项，预计释放{" "}
              <strong className="font-mono">{formatBytes(selectedBytes)}</strong>
              。缓存类目录通常可安全重建；高风险项请确认无程序占用。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-4 py-2 text-sm border border-[var(--color-sand)] hover:bg-[var(--color-mist)]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={runClean}
                className="rounded-lg px-4 py-2 text-sm bg-[var(--color-sea)] text-white font-semibold hover:bg-[var(--color-sea-bright)]"
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
