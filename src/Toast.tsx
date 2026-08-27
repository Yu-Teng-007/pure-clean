import { useEffect, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react";

interface ToastItem {
  id: number;
  message: string;
}

let nextId = 0;
let emit: ((item: ToastItem) => void) | null = null;

export function showToast(message: string): void {
  emit?.({ id: ++nextId, message });
}

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    emit = (item) => {
      setItems((prev) => [...prev, item]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== item.id));
      }, 2600);
    };
    return () => {
      emit = null;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="toast-host pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="toast-item pointer-events-auto inline-flex max-w-[min(92vw,24rem)] items-center gap-2 rounded-xl border border-[var(--color-sea)]/20 bg-white/95 px-3.5 py-2.5 text-[12.5px] font-medium text-[var(--color-ink)] shadow-lg backdrop-blur-md"
        >
          <CheckCircle
            size={16}
            weight="duotone"
            className="shrink-0 text-[var(--color-sea)]"
          />
          <span className="min-w-0 truncate">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
