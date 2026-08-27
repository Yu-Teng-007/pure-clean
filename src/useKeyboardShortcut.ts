import { useEffect } from "react";

interface ShortcutOptions {
  enabled?: boolean;
  allowInInput?: boolean;
}

export function useKeyboardShortcut(
  key: string,
  handler: () => void,
  options: ShortcutOptions = {},
): void {
  const { enabled = true, allowInInput = false } = options;

  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (!allowInInput) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const parts = key.toLowerCase().split("+");
      const needsMod = parts.includes("ctrl") || parts.includes("mod");
      const keyPart = parts[parts.length - 1];
      if (needsMod && !mod) return;
      if (!needsMod && mod) return;
      if (e.key.toLowerCase() !== keyPart) return;
      e.preventDefault();
      handler();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, allowInInput, handler, key]);
}
