import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** Use monospace for path / technical values */
  mono?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}

export default function Select({
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  mono = false,
  placeholder = "请选择",
  "aria-label": ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const leaveTimer = useRef<number | null>(null);

  const selected = options.find((o) => o.value === value);
  const enabledIndexes = useMemo(
    () =>
      options
        .map((o, i) => (o.disabled ? -1 : i))
        .filter((i) => i >= 0),
    [options],
  );

  const close = useCallback((immediate = false) => {
    if (leaveTimer.current != null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (immediate) {
      setOpen(false);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => {
      setOpen(false);
      setLeaving(false);
      leaveTimer.current = null;
    }, 140);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    if (leaveTimer.current != null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    setLeaving(false);
    setOpen(true);
    const idx = options.findIndex((o) => o.value === value && !o.disabled);
    setHighlight(idx >= 0 ? idx : (enabledIndexes[0] ?? -1));
  }, [disabled, options, value, enabledIndexes]);

  useEffect(() => {
    return () => {
      if (leaveTimer.current != null) window.clearTimeout(leaveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open || highlight < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  const pick = (next: string) => {
    if (next !== value) onChange(next);
    close();
  };

  const moveHighlight = (dir: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const pos = enabledIndexes.indexOf(highlight);
    let nextPos: number;
    if (pos < 0) {
      nextPos = dir === 1 ? 0 : enabledIndexes.length - 1;
    } else {
      nextPos = (pos + dir + enabledIndexes.length) % enabledIndexes.length;
    }
    setHighlight(enabledIndexes[nextPos]);
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) openMenu();
      else if (e.key === "ArrowDown") moveHighlight(1);
      else if (e.key === "Enter" || e.key === " ") {
        const opt = options[highlight];
        if (opt && !opt.disabled) pick(opt.value);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openMenu();
      else moveHighlight(-1);
    }
  };

  const showMenu = open || leaving;

  return (
    <div
      ref={rootRef}
      className={["ui-select", className].filter(Boolean).join(" ")}
    >
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={showMenu ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className={[
          "ui-select__trigger btn-press",
          open ? "ui-select__trigger--open" : "",
          mono ? "font-mono" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="ui-select__value truncate">
          {selected?.label ?? placeholder}
        </span>
        <CaretDown
          size={12}
          weight="bold"
          className={[
            "ui-select__caret shrink-0",
            open ? "ui-select__caret--open" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden
        />
      </button>

      {showMenu && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-activedescendant={
            highlight >= 0 ? `${listId}-opt-${highlight}` : undefined
          }
          className={[
            "ui-select__menu",
            leaving ? "ui-select__menu--out" : "ui-select__menu--in",
          ].join(" ")}
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isActive = i === highlight;
            return (
              <li
                key={opt.value}
                id={`${listId}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled || undefined}
                className={[
                  "ui-select__option",
                  mono ? "font-mono" : "",
                  isSelected ? "ui-select__option--selected" : "",
                  isActive ? "ui-select__option--active" : "",
                  opt.disabled ? "ui-select__option--disabled" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => {
                  if (!opt.disabled) setHighlight(i);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!opt.disabled) pick(opt.value);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                {isSelected && (
                  <Check
                    size={13}
                    weight="bold"
                    className="ui-select__check shrink-0"
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
