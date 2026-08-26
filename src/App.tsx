import { useState } from "react";
import type { AppTool, AppView, CleanBack } from "./appView";
import CleanToolsHub from "./CleanToolsHub";
import CleanWorkspace from "./CleanWorkspace";
import HardwareWorkspace from "./HardwareWorkspace";
import Home from "./Home";
import MemoryWorkspace from "./MemoryWorkspace";
import DiskAnalyzerWorkspace from "./DiskAnalyzerWorkspace";
import StartupWorkspace from "./StartupWorkspace";
import TitleBar from "./TitleBar";
import type { CleanMode } from "./modes";

export default function App() {
  const [view, setView] = useState<AppView>(null);

  const goHome = () => setView(null);
  const openTool = (tool: AppTool) => setView({ kind: "tool", tool });
  const enterMode = (mode: CleanMode, back: CleanBack = "hub") =>
    setView({ kind: "clean", mode, back });

  const backFromClean = () => {
    if (view?.kind === "clean" && view.back === "hub") {
      openTool("cleanHub");
      return;
    }
    goHome();
  };

  return (
    <div className="h-full flex flex-col">
      <TitleBar />
      <div className="flex-1 min-h-0">
        {view?.kind === "clean" ? (
          <CleanWorkspace mode={view.mode} onBack={backFromClean} />
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
          <DiskAnalyzerWorkspace onBack={goHome} />
        ) : (
          <Home onOpenTool={openTool} />
        )}
      </div>
    </div>
  );
}
