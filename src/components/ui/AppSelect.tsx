import { Check, ChevronDown } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../../lib/cn";
import { AnimatedLayer, AnimatedLayerPortal, useUiAnimationEnabled } from "./layerMotion";
import { estimateDropdownHeight, useStableDropdownScrollbar } from "./useStableDropdownScrollbar";
import { useFloatingDropdown } from "./useFloatingDropdown";

export interface AppSelectOption<T extends string | number = string> {
  value: T;
  label: string;
  icon?: string;
  iconAlt?: string;
  leading?: ReactNode;
  detail?: ReactNode;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export type SelectOption<T extends string | number = string> = AppSelectOption<T>;

interface AppSelectProps<T extends string | number = string> {
  value: T;
  options: AppSelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  maxVisibleItems?: number;
}

function getOverlayRoot() {
  return document.body;
}

export function AppSelect<T extends string | number = string>({
  value,
  options,
  onChange,
  className,
  disabled = false,
  placeholder,
  maxVisibleItems
}: AppSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shouldAnimateUi = useUiAnimationEnabled();
  const selectedOption = options.find((option) => option.value === value);
  const isDisabled = disabled || options.length === 0;
  const { refs, floatingStyles } = useFloatingDropdown({
    matchReferenceWidth: true,
    maxHeight: estimateDropdownHeight(options.length, maxVisibleItems)
  });
  const { scrollThumb, updateScrollThumb } = useStableDropdownScrollbar(
    menuRef,
    open && !isDisabled
  );

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

  useEffect(() => {
    if (!open || isDisabled) return;
    const frameId = window.requestAnimationFrame(updateScrollThumb);
    return () => window.cancelAnimationFrame(frameId);
  }, [isDisabled, open, options.length, updateScrollThumb]);

  useEffect(() => {
    if (isDisabled) setOpen(false);
  }, [isDisabled]);

  return (
    <div ref={containerRef} className={cn("no-drag relative", className)}>
      <button
        ref={refs.setReference}
        type="button"
        className="glass-input flex h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-[13px]"
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
          {selectedOption?.leading}
          <span className={cn("truncate", !selectedOption && "text-neutral-400")}>
            {selectedOption?.label ?? placeholder ?? options[0]?.label}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={cn("shrink-0 text-neutral-400 transition", open && "rotate-180")}
        />
      </button>

      <AnimatedLayerPortal root={getOverlayRoot()}>
        {open ? (
          <AnimatedLayer
            ref={(node) => {
              menuRef.current = node;
              refs.setFloating(node);
            }}
            className={cn(
              "app-dropdown-menu app-scrollbar-stable pointer-events-auto no-drag fixed z-[1010] rounded-lg py-2",
              scrollThumb.visible && "app-dropdown-menu-scrollable"
            )}
            style={floatingStyles}
            animateUi={shouldAnimateUi}
            preset="fade"
            onScroll={updateScrollThumb}
          >
            <div className="app-dropdown-backdrop" />
            {options.map((option) => {
              const selected = option.value === value;

              return (
                <Fragment key={option.value}>
                  {option.separatorBefore ? (
                    <div className="app-dropdown-separator" role="separator" />
                  ) : null}
                  <button
                    type="button"
                    className={cn(
                      "app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium transition",
                      selected
                        ? "app-dropdown-item-selected text-neutral-950"
                        : "text-neutral-600"
                    )}
                    role="option"
                    aria-selected={selected}
                    disabled={option.disabled}
                    onClick={() => {
                      if (option.disabled) return;
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
                    {option.leading}
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.detail ? (
                      <span className="shrink-0 text-[11px] text-neutral-400">
                        {option.detail}
                      </span>
                    ) : null}
                  </button>
                </Fragment>
              );
            })}
          </AnimatedLayer>
        ) : null}
        {scrollThumb.visible ? (
          <div
            className="app-scrollbar-stable-thumb pointer-events-none fixed z-[1020] no-drag"
            aria-hidden="true"
            style={{
              height: scrollThumb.height,
              left: scrollThumb.left,
              top: scrollThumb.top
            }}
          />
        ) : null}
      </AnimatedLayerPortal>
    </div>
  );
}
