import { Database, Download, Languages, Layers3, Settings2, Tags } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18next from "../../i18n";
import { useDatasetStore } from "../../stores/datasetStore";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { GlassPanel } from "../ui/GlassPanel";

const navItems = [
  { key: "nav.datasets", icon: Database },
  { key: "nav.profiles", icon: Tags },
  { key: "nav.exports", icon: Download },
  { key: "nav.settings", icon: Settings2 }
];

export function AppSidebar() {
  const { t } = useTranslation();
  const { profiles, presets } = useDatasetStore();
  const language = i18next.language;

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col gap-4 p-4">
      <div className="app-drag-region px-2 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-400/20 text-blue-100 ring-1 ring-blue-200/20">
            <Layers3 size={22} />
          </div>
          <div>
            <h1 className="m-0 text-lg font-semibold tracking-tight">{t("app.title")}</h1>
            <p className="m-0 text-xs text-white/48">{t("app.subtitle")}</p>
          </div>
        </div>
      </div>

      <GlassPanel subtle className="p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              className="sidebar-nav-button no-drag flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition"
            >
              <Icon size={18} />
              {t(item.key)}
            </button>
          );
        })}
      </GlassPanel>

      <GlassPanel subtle className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white/86">{t("nav.profiles")}</span>
          <Badge>{profiles.length}</Badge>
        </div>
        <div className="space-y-2">
          {profiles.map((profile) => (
            <div key={profile.id} className="rounded-2xl bg-white/[0.055] px-3 py-2">
              <div className="text-sm text-white/86">{profile.name}</div>
            </div>
          ))}
        </div>
      </GlassPanel>

      <GlassPanel subtle className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white/86">{t("nav.exports")}</span>
          <Badge>{presets.length}</Badge>
        </div>
        {presets.map((preset) => (
          <div key={preset.id} className="text-sm text-white/64">
            {t(preset.name)}
          </div>
        ))}
      </GlassPanel>

      <div className="mt-auto">
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => void i18next.changeLanguage(language === "zh-CN" ? "en-US" : "zh-CN")}
        >
          <Languages size={16} />
          {t("app.language")}: {language}
        </Button>
      </div>
    </aside>
  );
}
