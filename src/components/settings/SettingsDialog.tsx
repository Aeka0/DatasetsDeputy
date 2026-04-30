import { Folder, Globe2, Languages, MonitorCog, Settings2, Wifi, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import i18next from "../../i18n";
import { Button } from "../ui/Button";

type SettingsSectionKey = "general" | "language" | "network" | "localFiles" | "appearance";

interface SettingsSection {
  key: SettingsSectionKey;
  labelKey: string;
  icon: typeof Settings2;
}

const sections: SettingsSection[] = [
  { key: "general", labelKey: "settings.general", icon: Settings2 },
  { key: "language", labelKey: "settings.language", icon: Languages },
  { key: "network", labelKey: "settings.network", icon: Wifi },
  { key: "localFiles", labelKey: "settings.localFiles", icon: Folder },
  { key: "appearance", labelKey: "settings.appearance", icon: MonitorCog }
];

const languageOptions = [
  { value: "zh-CN", labelKey: "settings.simplifiedChinese" },
  { value: "en-US", labelKey: "settings.english" }
];

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { i18n, t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("general");
  const active = sections.find((section) => section.key === activeSection) ?? sections[0];
  const currentLanguage = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";

  return createPortal(
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-slate-950/18 px-5"
      onClick={onClose}
    >
      <section
        className="flex h-[560px] w-full max-w-[820px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_24px_72px_rgba(15,23,42,0.22)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-slate-200 bg-slate-50/90">
          <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
            <Globe2 size={17} className="text-slate-700" />
            <h2 id="settings-title" className="m-0 text-[15px] font-semibold text-slate-950">
              {t("settings.title")}
            </h2>
          </div>

          <nav className="flex-1 space-y-1 px-2 py-3" aria-label={t("settings.categoryLabel")}>
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = section.key === activeSection;

              return (
                <button
                  key={section.key}
                  type="button"
                  className={`flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[13px] font-medium transition ${
                    isActive
                      ? "bg-white text-slate-950 shadow-sm ring-1 ring-slate-200"
                      : "text-slate-600 hover:bg-white/72 hover:text-slate-950"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setActiveSection(section.key)}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="truncate">{t(section.labelKey)}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-white">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-slate-950">
                {t(active.labelKey)}
              </div>
            </div>
            <Button
              type="button"
              variant="icon"
              className="shrink-0"
              aria-label={t("settings.close")}
              title={t("menu.close")}
              onClick={onClose}
            >
              <X className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            </Button>
          </header>

          <div className="min-h-0 flex-1 bg-slate-50/42 p-5">
            {activeSection === "language" ? (
              <div className="rounded-lg border border-slate-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-900">
                      {t("settings.languageNative")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">Language</div>
                  </div>
                  <select
                    className="glass-input h-8 min-w-[150px] px-2.5 text-[13px]"
                    value={currentLanguage}
                    onChange={(event) => void i18next.changeLanguage(event.target.value)}
                  >
                    {languageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="h-full rounded-lg border border-dashed border-slate-200 bg-white/72" />
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
