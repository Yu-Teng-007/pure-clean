import { useState } from "react";
import CleanWorkspace from "./CleanWorkspace";
import Home from "./Home";
import type { CleanMode } from "./modes";

export default function App() {
  const [mode, setMode] = useState<CleanMode | null>(null);

  if (mode) {
    return <CleanWorkspace mode={mode} onBack={() => setMode(null)} />;
  }

  return <Home onEnter={setMode} />;
}
