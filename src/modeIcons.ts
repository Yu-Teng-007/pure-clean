import {
  ClockCountdown,
  Code,
  CopySimple,
  Cube,
  Desktop,
  Files,
  Package,
  ShieldCheck,
  type Icon,
} from "@phosphor-icons/react";
import type { CleanMode } from "./modes";

export const MODE_ICONS: Record<CleanMode, Icon> = {
  safe: ShieldCheck,
  dev: Code,
  system: Desktop,
  large: Files,
  dupes: CopySimple,
  stale: ClockCountdown,
  installers: Package,
  docker: Cube,
};
