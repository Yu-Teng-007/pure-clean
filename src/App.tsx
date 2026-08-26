import { useState } from "react";
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
import type { CleanMode } from "./modes";

export default function App() {
  const [view, setView] = useState<AppView>(null);

  const goHome = () => setView(null);
  const openTool = (tool: AppTool) => setView({ kind: "tool", tool });
  const enterMode = (
    mode: CleanMode,
    back: CleanBack = "hub",
    initialRoots?: string[],
  ) => setView({ kind: "clean", mode, back, initialRoots });

  const backFromClean = () => {
    if (view?.kind !== "clean") {
      goHome();
      return;
    }
    if (view.back === "hub") {
      openTool("cleanHub");
      return;
    }
    if (view.back === "disk") {
      openTool("diskAnalyzer");
      return;
    }
    if (view.back === "devCache") {
      openTool("devCache");
      return;
    }
    goHome();
  };

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
    </div>
  );
}
