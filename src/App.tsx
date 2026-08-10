import { useState } from "react";
import type { AppTool, AppView } from "./appView";
import CleanWorkspace from "./CleanWorkspace";
import Home from "./Home";
import OptimizeWorkspace from "./OptimizeWorkspace";
import StartupWorkspace from "./StartupWorkspace";
import TitleBar from "./TitleBar";
import type { CleanMode } from "./modes";

export default function App() {
  const [view, setView] = useState<AppView>(null);

  const goHome = () => setView(null);
  const enterMode = (mode: CleanMode) => setView({ kind: "clean", mode });
  const openTool = (tool: AppTool) => setView({ kind: "tool", tool });

  return (
    <div className="h-full flex flex-col">
      <TitleBar />
      <div className="flex-1 min-h-0">
        {view?.kind === "clean" ? (
          <CleanWorkspace mode={view.mode} onBack={goHome} />
        ) : view?.kind === "tool" && view.tool === "startup" ? (
          <StartupWorkspace onBack={goHome} />
        ) : view?.kind === "tool" && view.tool === "optimize" ? (
          <OptimizeWorkspace
            onBack={goHome}
            onOpenStartup={() => openTool("startup")}
          />
        ) : (
          <Home onEnterMode={enterMode} onOpenTool={openTool} />
        )}
      </div>
    </div>
  );
}
