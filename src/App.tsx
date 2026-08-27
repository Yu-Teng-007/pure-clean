import { useCallback, useEffect, useState } from "react";
import type { AppTool, AppView, CleanBack } from "./appView";
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
import ToastHost from "./Toast";
import type { CleanMode } from "./modes";

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
