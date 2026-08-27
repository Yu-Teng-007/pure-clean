export const MODAL_OUT_MS = 180;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function closeWithAnimation(
  setLeaving: (v: boolean) => void,
  onClosed: () => void,
  outMs = MODAL_OUT_MS,
): void {
  if (prefersReducedMotion()) {
    onClosed();
    return;
  }
  setLeaving(true);
  window.setTimeout(onClosed, outMs);
}
