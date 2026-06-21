import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { AnimatedLayer, AnimatedLayerPortal, useUiAnimationEnabled } from "./layerMotion";
import { useFloatingDropdown } from "./useFloatingDropdown";

export interface AppSelectOption<T extends string = string> {
  value: T;
  label: string;
  icon?: string;
  iconAlt?: string;
}

interface AppSelectProps<T extends string = string> {
  value: T;
  options: AppSelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function AppSelect<T extends string = string>({
  value,
  options,
  onChange,
  className,
  disabled = false,
  placeholder
}: AppSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shouldAnimateUi = useUiAnimationEnabled();
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
  const isDisabled = disabled || options.length === 0;
  const { refs, floatingStyles } = useFloatingDropdown({
    matchReferenceWidth: true
  });

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node) {
        if (containerRef.current?.contains(target)) return;
        if (menuRef.current?.contains(target)) return;
      }
      setOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn("no-drag relative", className)}>
      <button
        ref={refs.setReference}
        type="button"
        className={cn(
          "glass-input flex h-8 w-full items-center justify-between gap-2 px-2.5 text-left text-[13px]",
          isDisabled && "cursor-not-allowed opacity-60"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={isDisabled}
        onClick={() => {
          if (isDisabled) return;
          setOpen((current) => !current);
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedOption?.icon ? (
            <span
              className="h-4 w-4 shrink-0 bg-current"
              aria-label={selectedOption.iconAlt}
              role={selectedOption.iconAlt ? "img" : undefined}
              style={{
                WebkitMask: `url("${selectedOption.icon}") center / contain no-repeat`,
                mask: `url("${selectedOption.icon}") center / contain no-repeat`
              }}
            />
          ) : null}
          <span className={cn("truncate", !selectedOption && "text-neutral-400")}>
            {selectedOption?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={cn(
            "shrink-0 text-neutral-400 transition",
            open && "rotate-180",
            isDisabled && "opacity-50"
          )}
        />
      </button>

      <AnimatedLayerPortal>
        {open && !isDisabled ? (
          <AnimatedLayer
            ref={(node) => {
              menuRef.current = node;
              refs.setFloating(node);
            }}
            className="app-dropdown-menu pointer-events-auto no-drag fixed z-[1010] rounded-lg py-2"
            style={floatingStyles}
            animateUi={shouldAnimateUi}
            preset="fade"
          >
            <div className="app-dropdown-backdrop" />
            {options.map((option) => {
              const selected = option.value === value;

              return (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium transition",
                    selected
                      ? "app-dropdown-item-selected text-neutral-950"
                      : "text-neutral-600"
                  )}
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="flex w-4 shrink-0 justify-center">
                    {selected ? <Check size={14} /> : null}
                  </span>
                  {option.icon ? (
                    <span
                      className="h-4 w-4 shrink-0 bg-current"
                      aria-label={option.iconAlt}
                      role={option.iconAlt ? "img" : undefined}
                      style={{
                        WebkitMask: `url("${option.icon}") center / contain no-repeat`,
                        mask: `url("${option.icon}") center / contain no-repeat`
                      }}
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </button>
              );
            })}
          </AnimatedLayer>
        ) : null}
      </AnimatedLayerPortal>
    </div>
  );
}
