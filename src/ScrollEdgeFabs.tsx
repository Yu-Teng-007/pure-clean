import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

interface ScrollEdgeFabsProps {
  scrollRef: RefObject<HTMLElement | null>;
  /** Recompute when list length / content changes */
  contentKey?: string | number;
}

const EDGE = 48;

/** ease-out cubic：先快后慢 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function scrollToEaseOut(
  el: HTMLElement,
  target: number,
  rafRef: { current: number },
) {
  if (rafRef.current) cancelAnimationFrame(rafRef.current);

  if (prefersReducedMotion()) {
    el.scrollTop = target;
    return;
  }

  const start = el.scrollTop;
  const delta = target - start;
  if (Math.abs(delta) < 1) return;

  // 距离越远略延长，但封顶，保持「出手快、落地慢」
  const duration = Math.min(900, Math.max(380, Math.abs(delta) * 0.45));
  const t0 = performance.now();

  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / duration);
    el.scrollTop = start + delta * easeOutCubic(p);
    if (p < 1) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = 0;
    }
  };
  rafRef.current = requestAnimationFrame(tick);
}

export default function ScrollEdgeFabs({
  scrollRef,
  contentKey,
}: ScrollEdgeFabsProps) {
  const [canUp, setCanUp] = useState(false);
  const [canDown, setCanDown] = useState(false);
  const rafRef = useRef(0);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setCanUp(false);
      setCanDown(false);
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = el;
    const overflow = scrollHeight - clientHeight > EDGE;
    if (!overflow) {
      setCanUp(false);
      setCanDown(false);
      return;
    }
    setCanUp(scrollTop > EDGE);
    setCanDown(scrollTop + clientHeight < scrollHeight - EDGE);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scrollRef, update, contentKey]);

  const scrollTo = (where: "top" | "bottom") => {
    const el = scrollRef.current;
    if (!el) return;
    const target = where === "top" ? 0 : el.scrollHeight - el.clientHeight;
    scrollToEaseOut(el, Math.max(0, target), rafRef);
  };

  if (!canUp && !canDown) return null;

  return (
    <div
      className="scroll-fabs pointer-events-none absolute right-4 bottom-4 z-20 flex flex-col gap-2"
      role="group"
      aria-label="滚动定位"
    >
      {canUp && (
        <button
          type="button"
          onClick={() => scrollTo("top")}
          className="btn-press scroll-fab pointer-events-auto inline-flex size-9 items-center justify-center rounded-xl"
          aria-label="滚动到顶部"
          title="回到顶部"
        >
          <CaretUp size={16} weight="bold" />
        </button>
      )}
      {canDown && (
        <button
          type="button"
          onClick={() => scrollTo("bottom")}
          className="btn-press scroll-fab pointer-events-auto inline-flex size-9 items-center justify-center rounded-xl"
          aria-label="滚动到底部"
          title="滚到底部"
        >
          <CaretDown size={16} weight="bold" />
        </button>
      )}
    </div>
  );
}
