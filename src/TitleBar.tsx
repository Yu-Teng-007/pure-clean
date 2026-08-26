import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CopySimple, Minus, Square, X } from "@phosphor-icons/react";
import AppIcon from "./AppIcon";

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const next = await appWindow.isMaximized();
        if (!cancelled) setMaximized(next);
        unlisten = await appWindow.onResized(async () => {
          const m = await appWindow.isMaximized();
          if (!cancelled) setMaximized(m);
        });
      } catch {
        /* browser preview */
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const win = () => getCurrentWindow();

  return (
    <header className="app-titlebar shrink-0 flex items-stretch select-none">
      <div
        data-tauri-drag-region
        className="flex-1 min-w-0 flex items-center gap-2 pl-3.5"
      >
        <AppIcon size={15} className="rounded-[4px] shadow-sm" />
        <span
          data-tauri-drag-region
          className="text-[12.5px] font-semibold tracking-tight text-[var(--color-ink)]/70"
        >
          净界
        </span>
      </div>
      <div className="flex items-stretch">
        <button
          type="button"
          className="app-titlebar__btn"
          aria-label="最小化"
          onClick={() => void win().minimize()}
        >
          <Minus size={14} weight="bold" />
        </button>
        <button
          type="button"
          className="app-titlebar__btn"
          aria-label={maximized ? "还原" : "最大化"}
          onClick={() => void win().toggleMaximize()}
        >
          {maximized ? (
            <CopySimple size={13} weight="bold" />
          ) : (
            <Square size={12} weight="bold" />
          )}
        </button>
        <button
          type="button"
          className="app-titlebar__btn app-titlebar__btn--close"
          aria-label="关闭"
          onClick={() => void win().close()}
        >
          <X size={14} weight="bold" />
        </button>
      </div>
    </header>
  );
}
