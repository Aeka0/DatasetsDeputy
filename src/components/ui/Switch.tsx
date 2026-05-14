import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "checked" | "className" | "onChange" | "type"> {
  checked: boolean;
  label?: ReactNode;
  description?: ReactNode;
  className?: string;
  labelClassName?: string;
  onCheckedChange: (checked: boolean) => void;
}

export function Switch({
  checked,
  label,
  description,
  className,
  labelClassName,
  disabled,
  onCheckedChange,
  ...props
}: SwitchProps) {
  return (
    <label
      className={cn(
        "app-switch-field no-drag",
        disabled && "app-switch-field-disabled",
        className
      )}
    >
      <span className="app-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onCheckedChange(event.target.checked)}
          {...props}
        />
        <span className="app-switch-track" aria-hidden="true">
          <span className="app-switch-thumb" />
        </span>
      </span>
      {label || description ? (
        <span className={cn("app-switch-copy", labelClassName)}>
          {label ? <span className="app-switch-label">{label}</span> : null}
          {description ? <span className="app-switch-description">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
