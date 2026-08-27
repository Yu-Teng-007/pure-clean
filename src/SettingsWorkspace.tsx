import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderSimplePlus,
  GearSix,
  HardDrives,
  Recycle,
  ShieldWarning,
  Trash,
  Wrench,
  X,
} from "@phosphor-icons/react";
import WorkspaceHeader from "./WorkspaceHeader";
import {
  AppConfig,
  DEFAULT_MIN_FILE_BYTES,
  DEFAULT_STALE_DAYS,
  formatBytes,
  MIN_FILE_PRESETS,
  STALE_DAY_PRESETS,
} from "./types";

interface SettingsWorkspaceProps {
  onBack: () => void;
}

export default function SettingsWorkspace({ onBack }: SettingsWorkspaceProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [rootInput, setRootInput] = useState("");
  const [protectInput, setProtectInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const cfg = await invoke<AppConfig>("load_config");
      setConfig(cfg);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (next: AppConfig, okMsg = "已保存") => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await invoke("save_config", { config: next });
      setConfig(next);
      setMessage(okMsg);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <WorkspaceHeader
          title="设置"
          subtitle="默认清理行为与扫描参数"
          icon={<GearSix size={18} weight="duotone" />}
          onBack={onBack}
        />
        <div className="px-7 text-sm text-[var(--color-ink)]/50">加载中…</div>
      </div>
    );
  }

  const addRoot = async () => {
    const trimmed = rootInput.trim();
    let path = trimmed;
    if (!path) {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      path = picked;
    }
    if (config.scanRoots.includes(path)) {
      setRootInput("");
      return;
    }
    await persist({ ...config, scanRoots: [...config.scanRoots, path] });
    setRootInput("");
  };

  const removeRoot = async (path: string) => {
    await persist({
      ...config,
      scanRoots: config.scanRoots.filter((p) => p !== path),
    });
  };

  const addProtect = async () => {
    const trimmed = protectInput.trim();
    let path = trimmed;
    if (!path) {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      path = picked;
    }
    if (config.protectedPaths.includes(path)) {
      setProtectInput("");
      return;
    }
    await persist({
      ...config,
      protectedPaths: [...config.protectedPaths, path],
    });
    setProtectInput("");
  };

  const removeProtect = async (path: string) => {
    await persist({
      ...config,
      protectedPaths: config.protectedPaths.filter((p) => p !== path),
    });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <WorkspaceHeader
        title="设置"
        subtitle="默认清理行为、扫描根与保护路径"
        icon={<GearSix size={18} weight="duotone" />}
        onBack={onBack}
      />

      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-7 space-y-4">
        {(message || error) && (
          <p
            className={[
              "text-[12.5px] rounded-xl px-3 py-2 border",
              error
                ? "border-red-200 bg-red-50 text-[var(--color-danger)]"
                : "border-[var(--color-sea)]/25 bg-[var(--color-sea)]/8 text-[var(--color-sea)]",
            ].join(" ")}
          >
            {error ?? message}
          </p>
        )}

        <section className="ws-panel rounded-2xl px-4 py-4 animate-fade-up">
          <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
            清理默认行为
          </h2>
          <div className="mt-3 space-y-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <input
                type="checkbox"
                checked={config.toRecycleBinByDefault}
                disabled={saving}
                onChange={(e) =>
                  void persist({
                    ...config,
                    toRecycleBinByDefault: e.target.checked,
                  })
                }
                className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-sea)]"
              />
              <span>
                <span className="font-medium">默认移到回收站</span>
                <span className="mt-0.5 block text-[11.5px] text-[var(--color-ink)]/45">
                  清理确认对话框默认勾选「移到回收站」
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <input
                type="checkbox"
                checked={config.selectCautionByDefault}
                disabled={saving}
                onChange={(e) =>
                  void persist({
                    ...config,
                    selectCautionByDefault: e.target.checked,
                  })
                }
                className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-sea)]"
              />
              <span>
                <span className="font-medium">默认勾选「谨慎」风险项</span>
                <span className="mt-0.5 block text-[11.5px] text-[var(--color-ink)]/45">
                  扫描结果中谨慎级项目也会默认选中
                </span>
              </span>
            </label>
          </div>
        </section>

        <section
          className="ws-panel rounded-2xl px-4 py-4 animate-fade-up"
          style={{ animationDelay: "40ms" }}
        >
          <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
            扫描阈值
          </h2>
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-[12px] text-[var(--color-ink)]/55 mb-1.5">
                大文件默认阈值（当前{" "}
                <span className="font-mono">
                  {formatBytes(config.minFileBytes || DEFAULT_MIN_FILE_BYTES)}
                </span>
                ）
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MIN_FILE_PRESETS.map((p) => (
                  <button
                    key={p.bytes}
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void persist({ ...config, minFileBytes: p.bytes })
                    }
                    className={[
                      "btn-press rounded-xl px-2.5 py-1 text-xs font-medium border",
                      config.minFileBytes === p.bytes
                        ? "border-[var(--color-sea)] bg-[var(--color-sea)]/10 text-[var(--color-sea)]"
                        : "border-[var(--color-sand)] bg-white text-[var(--color-ink)]/70 hover:bg-[var(--color-mist)]",
                    ].join(" ")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[12px] text-[var(--color-ink)]/55 mb-1.5">
                闲置天数（当前 {config.staleDays ?? DEFAULT_STALE_DAYS} 天）
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STALE_DAY_PRESETS.map((p) => (
                  <button
                    key={p.days}
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void persist({ ...config, staleDays: p.days })
                    }
                    className={[
                      "btn-press rounded-xl px-2.5 py-1 text-xs font-medium border",
                      config.staleDays === p.days
                        ? "border-[var(--color-sea)] bg-[var(--color-sea)]/10 text-[var(--color-sea)]"
                        : "border-[var(--color-sand)] bg-white text-[var(--color-ink)]/70 hover:bg-[var(--color-mist)]",
                    ].join(" ")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          className="ws-panel rounded-2xl px-4 py-4 animate-fade-up"
          style={{ animationDelay: "80ms" }}
        >
          <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
            默认扫描根目录
          </h2>
          <div className="mt-3 flex gap-2">
            <input
              value={rootInput}
              onChange={(e) => setRootInput(e.target.value)}
              placeholder="路径，或留空点添加选择文件夹"
              className="min-w-0 flex-1 rounded-xl border border-[var(--color-sand)] bg-white/80 px-3 py-2 text-[12.5px] font-mono outline-none focus:border-[var(--color-sea-bright)]"
            />
            <button
              type="button"
              onClick={() => void addRoot()}
              disabled={saving}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-sea)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
            >
              <FolderSimplePlus size={14} weight="bold" />
              添加
            </button>
          </div>
          <ul className="mt-3 space-y-1.5">
            {config.scanRoots.length === 0 ? (
              <li className="text-[12px] text-[var(--color-ink)]/45">
                尚未设置默认扫描根
              </li>
            ) : (
              config.scanRoots.map((p) => (
                <li
                  key={p}
                  className="flex items-center gap-2 rounded-xl border border-[var(--color-sand)]/60 bg-white/50 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                    {p}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeRoot(p)}
                    className="btn-press rounded-lg p-1 text-[var(--color-ink)]/40 hover:bg-[var(--color-mist)] hover:text-[var(--color-danger)]"
                    aria-label={`移除 ${p}`}
                  >
                    <X size={14} weight="bold" />
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        <section
          className="ws-panel rounded-2xl px-4 py-4 animate-fade-up"
          style={{ animationDelay: "160ms" }}
        >
          <div className="flex items-center gap-2">
            <Wrench size={15} weight="duotone" className="text-[var(--color-sea)]" />
            <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
              系统工具
            </h2>
          </div>
          <p className="mt-1 text-[11.5px] text-[var(--color-ink)]/45">
            调用 Windows 内置工具，处理 WinSxS 等需系统级清理的场景
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void invoke("open_disk_cleanup", { drive: null }).catch((e) => setError(String(e)))}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
            >
              <HardDrives size={14} weight="duotone" />
              打开磁盘清理
            </button>
            <button
              type="button"
              onClick={() => void invoke("open_recycle_bin").catch((e) => setError(String(e)))}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
            >
              <Recycle size={14} weight="duotone" />
              打开回收站
            </button>
          </div>
        </section>

        <section
          className="ws-panel rounded-2xl px-4 py-4 animate-fade-up"
          style={{ animationDelay: "120ms" }}
        >
          <div className="flex items-center gap-2">
            <ShieldWarning
              size={15}
              weight="duotone"
              className="text-[var(--color-warn)]"
            />
            <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
              保护路径
            </h2>
          </div>
          <p className="mt-1 text-[11.5px] text-[var(--color-ink)]/45">
            永不扫描 / 删除的白名单
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={protectInput}
              onChange={(e) => setProtectInput(e.target.value)}
              placeholder="路径，或留空点添加选择文件夹"
              className="min-w-0 flex-1 rounded-xl border border-[var(--color-sand)] bg-white/80 px-3 py-2 text-[12.5px] font-mono outline-none focus:border-[var(--color-sea-bright)]"
            />
            <button
              type="button"
              onClick={() => void addProtect()}
              disabled={saving}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
            >
              <FolderSimplePlus size={14} weight="bold" />
              添加
            </button>
          </div>
          <ul className="mt-3 space-y-1.5">
            {config.protectedPaths.length === 0 ? (
              <li className="text-[12px] text-[var(--color-ink)]/45">
                暂无保护路径
              </li>
            ) : (
              config.protectedPaths.map((p) => (
                <li
                  key={p}
                  className="flex items-center gap-2 rounded-xl border border-[var(--color-sand)]/60 bg-white/50 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                    {p}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeProtect(p)}
                    className="btn-press rounded-lg p-1 text-[var(--color-ink)]/40 hover:bg-[var(--color-mist)] hover:text-[var(--color-danger)]"
                    aria-label={`移除保护 ${p}`}
                  >
                    <Trash size={14} weight="bold" />
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
