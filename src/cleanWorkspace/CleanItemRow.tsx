import { Copy, FolderOpen } from "@phosphor-icons/react";
import { copyText } from "../clipboard";
import type { ScanItem } from "../types";
import { formatBytes } from "../types";
import {
  isAdvisoryOnly,
  isFilesystemPath,
  riskClass,
  riskLabel,
  scanHintClass,
} from "./helpers";

interface CleanItemRowProps {
  item: ScanItem;
  listEpoch: number;
  phase: string;
  isExiting: boolean;
  isCleaning: boolean;
  isSelected: boolean;
  animationIndex: number;
  onToggle: (id: string) => void;
  onOpenDiskCleanup: () => void;
  onReveal: (path: string) => void;
}

export default function CleanItemRow({
  item,
  listEpoch,
  phase,
  isExiting,
  isCleaning,
  isSelected,
  animationIndex,
  onToggle,
  onOpenDiskCleanup,
  onReveal,
}: CleanItemRowProps) {
  const advisory = isAdvisoryOnly(item);
  const opensTool = item.special === "open_disk_cleanup";
  const canReveal = isFilesystemPath(item.path);

  return (
    <li
      key={`${listEpoch}-${item.id}`}
      className={[
        "ws-row flex items-start gap-3 px-3.5 py-2.5 transition-[background-color] duration-150",
        isExiting ? "animate-row-exit" : "animate-row-enter hover:bg-white/70",
        isCleaning ? "animate-row-cleaning" : "",
        phase === "cleaning" && isSelected && !isCleaning ? "opacity-70" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        isExiting
          ? undefined
          : { animationDelay: `${Math.min(animationIndex, 24) * 28}ms` }
      }
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggle(item.id)}
        disabled={phase === "cleaning" || isExiting || advisory}
        className="mt-1 accent-[var(--color-sea)] transition-transform duration-100 active:scale-90 disabled:opacity-40"
      />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={[
              "text-[13px] font-mono truncate transition-colors duration-200",
              isCleaning
                ? "text-[var(--color-sea)]"
                : isExiting
                  ? "line-through text-[var(--color-ink)]/35"
                  : "text-[var(--color-ink)]/85",
            ]
              .filter(Boolean)
              .join(" ")}
            title={item.path}
          >
            {item.path}
          </span>
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${riskClass(item.risk)}`}
          >
            {riskLabel(item.risk)}
          </span>
          {item.isKeeper === true && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--color-sea)]/10 text-[var(--color-sea)]">
              保留
            </span>
          )}
          {item.isKeeper === false && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-[var(--color-warn)]">
              副本
            </span>
          )}
          {advisory && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--color-ink)]/8 text-[var(--color-ink)]/55">
              仅检测
            </span>
          )}
          {opensTool && (
            <button
              type="button"
              onClick={onOpenDiskCleanup}
              disabled={phase === "cleaning"}
              className="btn-press text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--color-sea)]/10 text-[var(--color-sea)] hover:underline disabled:opacity-40"
            >
              打开磁盘清理
            </button>
          )}
          {isCleaning && (
            <span className="text-[10px] font-medium text-[var(--color-sea-bright)] animate-pulse-soft">
              清理中
            </span>
          )}
        </div>
        {item.hint && (
          <p
            className={`mt-0.5 text-[11px] leading-snug ${scanHintClass(item.hint)}`}
          >
            {item.hint}
          </p>
        )}
      </div>
      <div className="ws-row-actions flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => void copyText(item.path, "路径已复制")}
          disabled={phase === "cleaning" || isExiting}
          className="btn-press rounded-lg p-1.5 text-[var(--color-ink)]/40 hover:bg-white hover:text-[var(--color-sea)] disabled:opacity-30"
          title="复制路径"
          aria-label="复制路径"
        >
          <Copy size={13} weight="bold" />
        </button>
        {canReveal && (
          <button
            type="button"
            onClick={() => onReveal(item.path)}
            disabled={phase === "cleaning" || isExiting}
            className="btn-press rounded-lg p-1.5 text-[var(--color-ink)]/40 hover:bg-white hover:text-[var(--color-sea)] disabled:opacity-30"
            title="在资源管理器中显示"
            aria-label="在资源管理器中显示"
          >
            <FolderOpen size={13} weight="bold" />
          </button>
        )}
      </div>
      <span className="text-[13px] font-mono tabular-nums whitespace-nowrap text-[var(--color-ink)]/55">
        {formatBytes(item.bytes)}
      </span>
    </li>
  );
}
