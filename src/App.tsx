import { useState } from "react";
import CleanWorkspace from "./CleanWorkspace";
import Home from "./Home";
import TitleBar from "./TitleBar";
import type { CleanMode } from "./modes";

export default function App() {
  const [mode, setMode] = useState<CleanMode | null>(null);

  return (
    <div className="h-full flex flex-col">
      <TitleBar />
      <div className="flex-1 min-h-0">
        {mode ? (
          <CleanWorkspace mode={mode} onBack={() => setMode(null)} />
        ) : (
          <Home onEnter={setMode} />
        )}
      </div>
    </div>
  );
}
