import { Download, FolderOpen, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useDatasetStore } from "../../stores/datasetStore";
import { Button } from "../ui/Button";
import { GlassPanel } from "../ui/GlassPanel";

export function TopToolbar() {
  const { t } = useTranslation();
  const {
    images,
    profiles,
    search,
    activeProfileId,
    isLoading,
    openImportWizard,
    exportDataset,
    setSearch,
    setActiveProfile
  } = useDatasetStore();

  return (
    <GlassPanel className="flex items-center gap-3 p-3">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/38"
          size={17}
        />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("toolbar.searchPlaceholder")}
          className="glass-input h-11 w-full rounded-2xl pl-10 pr-4 text-sm"
        />
      </div>

      <select
        value={activeProfileId ?? ""}
        onChange={(event) =>
          setActiveProfile(event.target.value ? Number(event.target.value) : undefined)
        }
        className="glass-input h-11 rounded-2xl px-3 text-sm"
      >
        <option value="">{t("toolbar.allProfiles")}</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>

      <Button variant="ghost" onClick={openImportWizard} disabled={isLoading}>
        <FolderOpen size={16} />
        导入数据集...
      </Button>
      <Button variant="ghost">
        <Plus size={16} />
        {t("actions.newProfile")}
      </Button>
      <Button onClick={() => void exportDataset("txt_per_image")}>
        <Download size={16} />
        {t("actions.export")}
      </Button>

      <div className="min-w-24 text-right text-xs text-white/46">
        {t("toolbar.datasetCount", { count: images.length })}
      </div>
    </GlassPanel>
  );
}
