import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { Slider } from "../ui/Slider";

export function SettingsPanel({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-neutral-200 bg-white">{children}</div>;
}

export function SettingsRow({
  title,
  description,
  children,
  align = "center"
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={`flex min-h-12 justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0 ${
        align === "start" ? "items-start" : "items-center"
      }`}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-neutral-900">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[12px] text-neutral-500">{description}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function SettingsCard({
  title,
  description,
  children
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      {title ? (
        <header className="border-b border-neutral-100 px-4 py-3">
          <div className="text-[13px] font-semibold text-neutral-900">{title}</div>
          {description ? (
            <div className="mt-0.5 text-[12px] leading-5 text-neutral-500">{description}</div>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function SettingRow({
  title,
  description,
  children
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingsRow title={title} description={description}>
      {children}
    </SettingsRow>
  );
}

export function SettingGridRow({
  label,
  children
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-11 grid-cols-[132px_minmax(0,1fr)] items-center gap-3 border-b border-neutral-100 px-4 py-2.5 last:border-b-0">
      <div className="text-[12px] text-neutral-500">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ProbeLabel({ children }: { children: ReactNode }) {
  return <div className="text-neutral-500">{children}</div>;
}

export function ProbeValue({
  tone = "neutral",
  children
}: {
  tone?: "neutral" | "ok" | "warn";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "min-w-0 truncate text-neutral-700",
        tone === "ok" && "font-medium text-emerald-700",
        tone === "warn" && "font-medium text-rose-700"
      )}
      title={typeof children === "string" ? children : undefined}
    >
      {children}
    </div>
  );
}

export function PackageStatus({ name, ok }: { name: string; ok?: boolean }) {
  const { t } = useTranslation();
  return (
    <div>
      {name} {ok ? t("settings.ok") : t("settings.missing")}
    </div>
  );
}

export function OpacityControl({
  value,
  min,
  onChange
}: {
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex min-w-[210px] items-center gap-3">
      <Slider
        min={min}
        max={100}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="no-drag w-full"
      />
      <span className="w-10 text-right text-[12px] text-neutral-500">{value}%</span>
    </div>
  );
}
