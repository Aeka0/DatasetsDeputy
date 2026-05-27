import type { CSSProperties, InputHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "max" | "min" | "type" | "value"> {
  className?: string;
  min: number;
  max: number;
  value: number;
}

export function Slider({ className, min, max, style, value, ...props }: SliderProps) {
  const position = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const clampedPosition = Math.max(0, Math.min(100, position));
  const sliderStyle = {
    ...style,
    "--app-slider-position": `${clampedPosition}%`
  } as CSSProperties;

  return (
    <input
      {...props}
      type="range"
      min={min}
      max={max}
      value={value}
      className={cn("app-slider", className)}
      style={sliderStyle}
    />
  );
}
