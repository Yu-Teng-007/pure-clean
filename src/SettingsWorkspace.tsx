import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowsClockwise,
  Bell,
  DownloadSimple,
  FolderSimplePlus,
  GearSix,
  HardDrives,
  Moon,
  Recycle,
  ShieldCheck,
  ShieldWarning,
  Tray,
  Trash,
  UploadSimple,
  Wrench,
  X,
} from "@phosphor-icons/react";
import WorkspaceHeader from "./WorkspaceHeader";
import { showToast } from "./Toast";
import {
  AppConfig,
  CATEGORY_ORDER,
  DEFAULT_MIN_FILE_BYTES,
  DEFAULT_STALE_DAYS,
  formatBytes,
  MIN_FILE_PRESETS,
  STALE_DAY_PRESETS,
  type Category,
  type ServiceSuggestion,
  type WinSxSHint,
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
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>(
    {},
  );
  const [elevated, setElevated] = useState<boolean | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [globInput, setGlobInput] = useState("");
  const [explorerMenu, setExplorerMenu] = useState<boolean | null>(null);
  const [winsxsHint, setWinsxsHint] = useState<WinSxSHint | null>(null);
  const [services, setServices] = useState<ServiceSuggestion[]>([]);

  const load = useCallback(async () => {
    try {
      const [cfg, categories, isAdmin, menuRegistered] = await Promise.all([
        invoke<AppConfig>("load_config"),
        invoke<Array<{ id: string; label: string }>>("get_categories"),
        invoke<boolean>("is_elevated"),
        invoke<boolean>("is_explorer_menu_registered"),
      ]);
      setConfig(cfg);
      setElevated(isAdmin);
      setExplorerMenu(menuRegistered);
      setCategoryLabels(
        Object.fromEntries(categories.map((c) => [c.id, c.label])),
      );
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
      showToast(okMsg);
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

  const toggleCategory = async (category: Category) => {
    const enabled = new Set(config.enabledCategories);
    if (enabled.has(category)) {
      enabled.delete(category);
    } else {
      enabled.add(category);
    }
    const next = CATEGORY_ORDER.filter((c) => enabled.has(c));
    if (next.length === 0) {
      showToast("至少保留一个扫描类别");
      return;
    }
    await persist({ ...config, enabledCategories: next });
  };

  const enableAllCategories = async () => {
    await persist({ ...config, enabledCategories: [...CATEGORY_ORDER] });
  };

  const restartAsAdmin = async () => {
    try {
      await invoke("restart_as_admin");
    } catch (e) {
      setError(String(e));
      showToast(String(e));
    }
  };

  const checkUpdates = async () => {
    setUpdateStatus("检查中…");
    try {
      const msg = await invoke<string>("check_for_updates");
      setUpdateStatus(msg);
      showToast(msg);
    } catch (e) {
      const err = String(e);
      setUpdateStatus(err);
      showToast(err);
    }
  };

  const testReminder = async () => {
    try {
      const payload = await invoke<{ message: string }>("trigger_cleanup_reminder");
      showToast(payload.message);
    } catch (e) {
      showToast(String(e));
    }
  };

  const exportCfg = async () => {
    try {
      const json = await invoke<string>("export_config");
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pure-clean-config.json";
      a.click();
      URL.revokeObjectURL(url);
      showToast("配置已导出");
    } catch (e) {
      setError(String(e));
    }
  };

  const importCfg = async () => {
    try {
      const picked = await open({
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
      });
      if (typeof picked !== "string") return;
      const next = await invoke<AppConfig>("import_config_from_path", { path: picked });
      setConfig(next);
      showToast("配置已导入");
    } catch (e) {
      setError(String(e));
    }
  };

  const toggleExplorerMenu = async (register: boolean) => {
    try {
      if (register) {
        await invoke("register_explorer_menu");
        showToast("已注册资源管理器右键菜单");
      } else {
        await invoke("unregister_explorer_menu");
        showToast("已移除资源管理器右键菜单");
      }
      setExplorerMenu(register);
    } catch (e) {
      setError(String(e));
    }
  };

  const loadWinsxs = async () => {
    try {
      const hint = await invoke<WinSxSHint>("analyze_winsxs");
      setWinsxsHint(hint);
    } catch (e) {
      setError(String(e));
    }
  };

  const loadServices = async () => {
    try {
      const list = await invoke<ServiceSuggestion[]>("list_service_suggestions");
      setServices(list);
    } catch (e) {
      setError(String(e));
    }
  };

  const addGlob = async () => {
    const trimmed = globInput.trim();
    if (!trimmed || !config) return;
    const globs = config.protectedGlobs ?? [];
    if (globs.includes(trimmed)) {
      setGlobInput("");
      return;
    }
    await persist({ ...config, protectedGlobs: [...globs, trimmed] });
    setGlobInput("");
  };

  const removeGlob = async (g: string) => {
    if (!config) return;
    await persist({
      ...config,
      protectedGlobs: (config.protectedGlobs ?? []).filter((x) => x !== g),
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
          style={{ animationDelay: "20ms" }}
        >
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} weight="duotone" className="text-[var(--color-sea)]" />
            <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
              管理员权限
            </h2>
          </div>
          <p className="mt-1 text-[11.5px] text-[var(--color-ink)]/45">
            以管理员身份运行可清理系统缓存、深度刷新内存待机列表，并修改本机注册表开机项
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={[
                "inline-flex items-center rounded-lg px-2.5 py-1 text-[11.5px] font-medium",
                elevated
                  ? "bg-[var(--color-sea)]/10 text-[var(--color-sea)]"
                  : "bg-amber-500/10 text-[var(--color-warn)]",
              ].join(" ")}
            >
              {elevated === null
                ? "检测中…"
                : elevated
                  ? "当前已以管理员身份运行"
                  : "当前为普通用户权限"}
            </span>
            {!elevated && (
              <button
                type="button"
                onClick={() => void restartAsAdmin()}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-sea)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--color-sea-bright)]"
              >
                以管理员身份重启
              </button>
            )}
          </div>
        </section>

        <section
          className="ws-panel rounded-2xl px-4 py-4 animate-fade-up"
          style={{ animationDelay: "30ms" }}
        >
          <div className="flex items-center gap-2">
            <Tray size={15} weight="duotone" className="text-[var(--color-sea)]" />
            <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
              托盘与提醒
            </h2>
          </div>
          <div className="mt-3 space-y-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <input
                type="checkbox"
                checked={config.runInTray ?? true}
                disabled={saving}
                onChange={(e) =>
                  void persist({ ...config, runInTray: e.target.checked })
                }
                className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-sea)]"
              />
              <span>
                <span className="font-medium">关闭时最小化到托盘</span>
                <span className="mt-0.5 block text-[11.5px] text-[var(--color-ink)]/45">
                  点击关闭按钮时隐藏窗口，可从系统托盘重新打开
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <input
                type="checkbox"
                checked={config.scheduleReminderEnabled ?? false}
                disabled={saving}
                onChange={(e) =>
                  void persist({
                    ...config,
                    scheduleReminderEnabled: e.target.checked,
                  })
                }
                className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-sea)]"
              />
              <span>
                <span className="font-medium">定期清理提醒</span>
                <span className="mt-0.5 block text-[11.5px] text-[var(--color-ink)]/45">
                  按设定间隔在指定小时后发送系统通知
                </span>
              </span>
            </label>
            {config.scheduleReminderEnabled && (
              <div className="flex flex-wrap items-center gap-2 pl-6">
                <span className="text-[12px] text-[var(--color-ink)]/55">每</span>
                {[3, 7, 14, 30].map((days) => (
                  <button
                    key={days}
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void persist({ ...config, scheduleReminderDays: days })
                    }
                    className={[
                      "btn-press rounded-xl px-2.5 py-1 text-xs font-medium border",
                      (config.scheduleReminderDays ?? 7) === days
                        ? "border-[var(--color-sea)] bg-[var(--color-sea)]/10 text-[var(--color-sea)]"
                        : "border-[var(--color-sand)] bg-white text-[var(--color-ink)]/70",
                    ].join(" ")}
                  >
                    {days} 天
                  </button>
                ))}
                <span className="text-[12px] text-[var(--color-ink)]/55">·</span>
                <span className="text-[12px] text-[var(--color-ink)]/55">自</span>
                {[9, 10, 12, 18].map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void persist({ ...config, scheduleReminderHour: hour })
                    }
                    className={[
                      "btn-press rounded-xl px-2.5 py-1 text-xs font-medium border",
                      (config.scheduleReminderHour ?? 10) === hour
                        ? "border-[var(--color-sea)] bg-[var(--color-sea)]/10 text-[var(--color-sea)]"
                        : "border-[var(--color-sand)] bg-white text-[var(--color-ink)]/70",
                    ].join(" ")}
                  >
                    {hour}:00
                  </button>
                ))}
                <span className="text-[12px] text-[var(--color-ink)]/55">起可提醒</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => void testReminder()}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
            >
              <Bell size={14} weight="duotone" />
              发送测试提醒
            </button>
          </div>
        </section>

        <section
          className="ws-panel rounded-2xl px-4 py-4 animate-fade-up"
          style={{ animationDelay: "35ms" }}
        >
          <div className="flex items-center gap-2">
            <ArrowsClockwise size={15} weight="duotone" className="text-[var(--color-sea)]" />
            <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
              软件更新
            </h2>
          </div>
          <div className="mt-3 space-y-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
              <input
                type="checkbox"
                checked={config.checkUpdatesOnStart ?? true}
                disabled={saving}
                onChange={(e) =>
                  void persist({
                    ...config,
                    checkUpdatesOnStart: e.target.checked,
                  })
                }
                className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-sea)]"
              />
              <span>
                <span className="font-medium">启动时检查更新</span>
                <span className="mt-0.5 block text-[11.5px] text-[var(--color-ink)]/45">
                  需在发布时配置更新服务器后生效
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void checkUpdates()}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
              >
                <ArrowsClockwise size={14} weight="bold" />
                立即检查更新
              </button>
              {updateStatus && (
                <span className="text-[11.5px] text-[var(--color-ink)]/55">
                  {updateStatus}
                </span>
              )}
            </div>
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
          style={{ animationDelay: "60ms" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">
              扫描类别
            </h2>
            <button
              type="button"
              disabled={saving}
              onClick={() => void enableAllCategories()}
              className="btn-press text-[11px] font-medium text-[var(--color-sea)] hover:underline"
            >
              全部启用
            </button>
          </div>
          <p className="mt-1 text-[11.5px] text-[var(--color-ink)]/45">
            全局开关：关闭的类别在所有清理模式中都不会被扫描
          </p>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {CATEGORY_ORDER.map((category) => {
              const checked = config.enabledCategories.includes(category);
              return (
                <li key={category}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--color-sand)]/60 bg-white/50 px-3 py-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving}
                      onChange={() => void toggleCategory(category)}
                      className="mt-0.5 size-3.5 rounded border-[var(--color-sand)] text-[var(--color-sea)]"
                    />
                    <span className="min-w-0 leading-snug">
                      {categoryLabels[category] ?? category}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
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
              onClick={() => void loadWinsxs()}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
            >
              分析 WinSxS (DISM)
            </button>
            <button
              type="button"
              onClick={() => void loadServices()}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
            >
              加载服务建议
            </button>
            <button
              type="button"
              onClick={() => void invoke("open_services_console").catch((e) => setError(String(e)))}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
            >
              打开 services.msc
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
          {winsxsHint && (
            <p className="mt-3 text-[12px] text-[var(--color-ink)]/62 leading-relaxed rounded-xl border border-[var(--color-sand)]/60 px-3 py-2">
              {winsxsHint.summary}
              {winsxsHint.reclaimableBytes != null && (
                <span className="block mt-1 font-mono text-[var(--color-sea)]">
                  {formatBytes(winsxsHint.reclaimableBytes)}
                </span>
              )}
            </p>
          )}
          {services.length > 0 && (
            <ul className="mt-3 max-h-48 overflow-y-auto scroll-thin divide-y divide-[var(--color-sand)]/40 rounded-xl border border-[var(--color-sand)]/60">
              {services.slice(0, 15).map((s) => (
                <li key={s.name} className="px-3 py-2 text-[11.5px]">
                  <p className="font-medium text-[var(--color-ink)]">{s.displayName}</p>
                  <p className="text-[var(--color-ink)]/45">{s.hint}</p>
                </li>
              ))}
            </ul>
          )}
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

        <section className="ws-panel rounded-2xl px-4 py-4 animate-fade-up">
          <div className="flex items-center gap-2">
            <Moon size={15} weight="duotone" className="text-[var(--color-sea)]" />
            <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">外观</h2>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["system", "light", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={saving}
                onClick={() =>
                  void persist({ ...config, theme: t }).then(() => {
                    document.documentElement.setAttribute(
                      "data-theme",
                      t === "system"
                        ? window.matchMedia("(prefers-color-scheme: dark)").matches
                          ? "dark"
                          : "light"
                        : t,
                    );
                  })
                }
                className={[
                  "btn-press rounded-xl px-3 py-1.5 text-[12px] font-medium border",
                  (config.theme ?? "system") === t
                    ? "border-[var(--color-sea)] bg-[var(--color-sea)]/10 text-[var(--color-sea)]"
                    : "border-[var(--color-sand)] bg-white hover:bg-[var(--color-mist)]",
                ].join(" ")}
              >
                {t === "system" ? "跟随系统" : t === "light" ? "浅色" : "深色"}
              </button>
            ))}
          </div>
        </section>

        <section className="ws-panel rounded-2xl px-4 py-4 animate-fade-up">
          <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">配置备份</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void exportCfg()}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
            >
              <DownloadSimple size={14} weight="bold" />
              导出配置
            </button>
            <button
              type="button"
              onClick={() => void importCfg()}
              className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
            >
              <UploadSimple size={14} weight="bold" />
              导入配置
            </button>
          </div>
        </section>

        <section className="ws-panel rounded-2xl px-4 py-4 animate-fade-up">
          <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">资源管理器集成</h2>
          <p className="mt-1 text-[11.5px] text-[var(--color-ink)]/45">
            在文件夹右键添加「用净界分析磁盘占用」
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={explorerMenu === true}
              onClick={() => void toggleExplorerMenu(true)}
              className="btn-press rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)] disabled:opacity-40"
            >
              注册右键菜单
            </button>
            <button
              type="button"
              disabled={explorerMenu === false}
              onClick={() => void toggleExplorerMenu(false)}
              className="btn-press rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)] disabled:opacity-40"
            >
              移除
            </button>
          </div>
        </section>

        <section className="ws-panel rounded-2xl px-4 py-4 animate-fade-up">
          <h2 className="text-[13px] font-semibold text-[var(--color-ink)]">保护路径 Glob</h2>
          <p className="mt-1 text-[11.5px] text-[var(--color-ink)]/45">
            文件级模式，如 **\.env、**\secret\**
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={globInput}
              onChange={(e) => setGlobInput(e.target.value)}
              placeholder="**\node_modules\**"
              className="min-w-0 flex-1 rounded-xl border border-[var(--color-sand)] bg-white/80 px-3 py-2 text-[12.5px] font-mono outline-none focus:border-[var(--color-sea-bright)]"
            />
            <button
              type="button"
              onClick={() => void addGlob()}
              className="btn-press rounded-xl border border-[var(--color-sand)] bg-white px-3 py-2 text-[12px] font-medium hover:bg-[var(--color-mist)]"
            >
              添加
            </button>
          </div>
          <ul className="mt-2 space-y-1">
            {(config.protectedGlobs ?? []).map((g) => (
              <li
                key={g}
                className="flex items-center gap-2 rounded-lg border border-[var(--color-sand)]/60 px-2 py-1.5 font-mono text-[11px]"
              >
                <span className="flex-1 truncate">{g}</span>
                <button type="button" onClick={() => void removeGlob(g)} className="text-[var(--color-danger)]">
                  <X size={12} weight="bold" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
