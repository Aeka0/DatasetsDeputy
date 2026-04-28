import { FolderOpen, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useDatasetStore } from "../../stores/datasetStore";

export function WelcomeView() {
  const { t } = useTranslation();
  const importFolder = useDatasetStore((state) => state.importFolder);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/62 text-slate-800 ring-1 ring-slate-200/80">
        <Sparkles size={23} strokeWidth={1.8} />
      </div>
      <h2 className="m-0 text-xl font-normal tracking-[-0.02em] text-slate-900">
        {t("welcome.title")}
      </h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
        {t("welcome.description")}
      </p>
      <button
        className="no-drag mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white transition hover:bg-slate-800"
        onClick={() => void importFolder()}
      >
        <FolderOpen size={15} />
        {t("actions.importFolder")}
      </button>
    </div>
  );
}
