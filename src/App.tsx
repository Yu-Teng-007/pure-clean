import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppTool, AppView, CleanBack } from "./appView";
import ContextMenuWorkspace from "./ContextMenuWorkspace";
import CleanToolsHub from "./CleanToolsHub";
import CleanWorkspace from "./CleanWorkspace";
import DevCacheWorkspace from "./DevCacheWorkspace";
import HardwareWorkspace from "./HardwareWorkspace";
import HistoryWorkspace from "./HistoryWorkspace";
import Home from "./Home";
import MemoryWorkspace from "./MemoryWorkspace";
import DiskAnalyzerWorkspace from "./DiskAnalyzerWorkspace";
import SettingsWorkspace from "./SettingsWorkspace";
import StartupWorkspace from "./StartupWorkspace";
import TitleBar from "./TitleBar";
import ToastHost, { showToast } from "./Toast";
import { useKeyboardShortcut } from "./useKeyboardShortcut";
import type { CleanMode } from "./modes";
import type { AppConfig, ScheduleReminderPayload } from "./types";

function applyTheme(theme: AppConfig["theme"]) {
  const root = document.documentElement;
  const resolved =
    theme === "dark"
      ? "dark"
      : theme === "light"
        ? "light"
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
  root.setAttribute("data-theme", resolved);
}

export default function App() {
  const [view, setView] = useState<AppView>(null);

  const goHome = useCallback(() => setView(null), []);
  const openTool = useCallback(
    (tool: AppTool) => setView({ kind: "tool", tool }),
    [],
  );
  const enterMode = useCallback(
    (mode: CleanMode, back: CleanBack = "hub", initialRoots?: string[]) =>
      setView({ kind: "clean", mode, back, initialRoots }),
    [],
  );

  const backFromClean = useCallback(() => {
    setView((current) => {
      if (current?.kind !== "clean") return null;
      if (current.back === "hub") return { kind: "tool", tool: "cleanHub" };
      if (current.back === "disk") return { kind: "tool", tool: "diskAnalyzer" };
      if (current.back === "devCache") return { kind: "tool", tool: "devCache" };
      return null;
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await invoke<AppConfig>("load_config");
        applyTheme(cfg.theme ?? "system");
      } catch {
        applyTheme("system");
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const pending = await invoke<string | null>("take_pending_analyze_path");
        if (pending) {
          showToast(`已从资源管理器打开：${pending}`);
          setView({ kind: "tool", tool: "diskAnalyzer" });
        }
      } catch {
        /* optional */
      }
    })();
  }, []);

  // Esc 返回上一层（有弹层时由弹层自行拦截）
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      if (view.kind === "clean") backFromClean();
      else goHome();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, backFromClean, goHome]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen<ScheduleReminderPayload>("schedule_reminder", (e) => {
        showToast(e.payload.message);
      });
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await invoke<AppConfig>("load_config");
        if (!cfg.checkUpdatesOnStart) return;
        const msg = await invoke<string>("check_for_updates");
        if (msg.includes("发现新版本")) {
          showToast(`${msg} · 可在设置中下载安装`);
        }
      } catch {
        /* updater not configured or network unavailable */
      }
    })();
  }, []);

  useKeyboardShortcut("mod+,", () => openTool("settings"));
  useKeyboardShortcut("mod+h", () => openTool("history"));
  useKeyboardShortcut("mod+shift+c", () => openTool("cleanHub"));

  return (
    <div className="h-full flex flex-col">
      <TitleBar />
      <div className="flex-1 min-h-0">
        {view?.kind === "clean" ? (
          <CleanWorkspace
            mode={view.mode}
            onBack={backFromClean}
            initialRoots={view.initialRoots}
          />
        ) : view?.kind === "tool" && view.tool === "cleanHub" ? (
          <CleanToolsHub
            onBack={goHome}
            onEnterMode={(mode) => enterMode(mode, "hub")}
          />
        ) : view?.kind === "tool" && view.tool === "startup" ? (
          <StartupWorkspace onBack={goHome} />
        ) : view?.kind === "tool" && view.tool === "contextMenu" ? (
          <ContextMenuWorkspace onBack={goHome} />
        ) : view?.kind === "tool" && view.tool === "hardware" ? (
          <HardwareWorkspace onBack={goHome} />
        ) : view?.kind === "tool" && view.tool === "memory" ? (
          <MemoryWorkspace onBack={goHome} />
        ) : view?.kind === "tool" && view.tool === "diskAnalyzer" ? (
          <DiskAnalyzerWorkspace
            onBack={goHome}
            onJumpClean={(mode, roots) => enterMode(mode, "disk", roots)}
          />
        ) : view?.kind === "tool" && view.tool === "settings" ? (
          <SettingsWorkspace onBack={goHome} />
        ) : view?.kind === "tool" && view.tool === "history" ? (
          <HistoryWorkspace onBack={goHome} />
        ) : view?.kind === "tool" && view.tool === "devCache" ? (
          <DevCacheWorkspace
            onBack={goHome}
            onJumpClean={(mode, roots) => enterMode(mode, "devCache", roots)}
          />
        ) : (
          <Home onOpenTool={openTool} />
        )}
      </div>
      <ToastHost />
    </div>
  );
}
