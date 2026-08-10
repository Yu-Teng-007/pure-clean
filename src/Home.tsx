import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { MODE_ORDER, MODES, type CleanMode } from "./modes";
import {
  AppConfig,
  DriveInfo,
  formatBytes,
  HistoryEntry,
} from "./types";

interface HomeProps {
  onEnter: (mode: CleanMode) => void;
}

export default function Home({ onEnter }: HomeProps) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [protectedPaths, setProtectedPaths] = useState<string[]>([]);
  const [protectInput, setProtectInput] = useState("");

  const persistProtected = useCallback(async (next: string[]) => {
    setProtectedPaths(next);
    try {
      const cfg = await invoke<AppConfig>("load_config");
      await invoke("save_config", {
        config: { ...cfg, protectedPaths: next },
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [d, h, cfg] = await Promise.all([
          invoke<DriveInfo[]>("list_drives"),
          invoke<HistoryEntry[]>("load_history"),
          invoke<AppConfig>("load_config"),
        ]);
        setDrives(d);
        setHistory(h.slice(0, 3));
        setProtectedPaths(cfg.protectedPaths ?? []);
      } catch {
        /* ignore */
      }
    })();
  }, []);

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

  return (
    <div className="min-h-full flex flex-col">
      <header className="px-8 pt-10 pb-6 animate-fade-up">
        <p className="text-[var(--color-sea)] text-sm font-medium tracking-[0.18em] uppercase mb-2">
          Developer Disk Cleaner
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--color-ink)]">
          Pure Clean
        </h1>
        <p className="mt-2 max-w-xl text-[var(--color-ink)]/65 text-[15px] leading-relaxed">
          选择一种清理方式进入，按场景扫描并释放磁盘空间。
        </p>
      </header>

      {drives.length > 0 && (
        <section
          className="px-8 pb-4 animate-fade-up"
          style={{ animationDelay: "40ms" }}
          aria-label="磁盘空间"
        >
          <div className="max-w-xl space-y-3">
            {drives.map((drive) => {
              const used = Math.max(0, drive.totalBytes - drive.freeBytes);
              const pct =
                drive.totalBytes > 0
                  ? Math.min(100, (used / drive.totalBytes) * 100)
                  : 0;
              return (
                <div
                  key={drive.name}
                  className="rounded-xl border border-[var(--color-sand)]/70 bg-white/45 px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <span className="text-sm font-semibold font-mono">
                      {drive.name}
                    </span>
                    <span className="text-xs font-mono text-[var(--color-ink)]/55">
                      可用 {formatBytes(drive.freeBytes)} /{" "}
                      {formatBytes(drive.totalBytes)}
                    </span>
                  </div>
                  <div className="progress-track h-1.5">
                    <div
                      className="progress-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section
          className="px-8 pb-4 animate-fade-up"
          style={{ animationDelay: "60ms" }}
          aria-label="最近清理"
        >
          <p className="text-xs text-[var(--color-ink)]/45 mb-2 max-w-xl">
            最近清理
          </p>
          <ul className="max-w-xl space-y-1.5">
            {history.map((h) => (
              <li
                key={h.id}
                className="text-xs text-[var(--color-ink)]/60 font-mono"
              >
                {h.timestamp}
                {" · "}
                {h.dryRun ? "模拟 " : ""}
                {formatBytes(h.freedBytes)}
                {" · 成功 "}
                {h.successCount}
                {h.failureCount > 0 ? ` · 失败 ${h.failureCount}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        className="px-8 pb-4 animate-fade-up"
        style={{ animationDelay: "70ms" }}
        aria-label="保护路径"
      >
        <div className="max-w-xl rounded-xl border border-[var(--color-sand)]/70 bg-white/45 px-4 py-3">
          <p className="text-xs text-[var(--color-ink)]/55 mb-2">
            保护路径（永不扫描 / 删除）
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={protectInput}
              onChange={(e) => setProtectInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addProtected()}
              placeholder="添加保护目录"
              className="flex-1 min-w-[160px] rounded-lg border border-[var(--color-sand)] bg-white/80 px-3 py-1.5 text-xs font-mono outline-none focus:border-[var(--color-sea-bright)]"
            />
            <button
              type="button"
              onClick={() => void addProtected()}
              className="btn-press rounded-lg border border-[var(--color-sand)] bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--color-mist)]"
            >
              添加
            </button>
          </div>
          {protectedPaths.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {protectedPaths.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-mono text-[var(--color-warn)]"
                >
                  {p}
                  <button
                    type="button"
                    onClick={() =>
                      void persistProtected(
                        protectedPaths.filter((x) => x !== p),
                      )
                    }
                    className="btn-press hover:text-[var(--color-danger)]"
                    aria-label={`移除保护 ${p}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <nav
        className="flex-1 px-8 pb-10 animate-fade-up"
        style={{ animationDelay: "80ms" }}
        aria-label="清理入口"
      >
        <ul className="max-w-xl divide-y divide-[var(--color-sand)]/70 border-y border-[var(--color-sand)]/70">
          {MODE_ORDER.map((id, index) => {
            const mode = MODES[id];
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onEnter(id)}
                  className="btn-press group w-full flex items-center gap-4 py-5 text-left hover:bg-white/40 transition-colors duration-150"
                  style={{ animationDelay: `${120 + index * 40}ms` }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-semibold tracking-tight text-[var(--color-ink)] group-hover:text-[var(--color-sea)] transition-colors duration-150">
                      {mode.title}
                    </span>
                    <span className="mt-1 block text-sm text-[var(--color-ink)]/55 leading-relaxed">
                      {mode.subtitle}
                    </span>
                  </span>
                  <span
                    className="shrink-0 text-[var(--color-ink)]/35 group-hover:text-[var(--color-sea)] group-hover:translate-x-0.5 transition-[color,transform] duration-150"
                    aria-hidden
                  >
                    →
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
