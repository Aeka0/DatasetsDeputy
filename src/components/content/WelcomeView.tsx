import { FolderOpen, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useDatasetStore } from "../../stores/datasetStore";

export function WelcomeView() {
  const { t } = useTranslation();
  const openImportWizard = useDatasetStore((state) => state.openImportWizard);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
        <Sparkles size={23} strokeWidth={1.8} />
      </div>
      <h2 className="m-0 text-[15px] font-semibold text-slate-900">
        {t("welcome.title")}
      </h2>
      <p className="mt-2 max-w-lg text-[13px] leading-5 text-slate-500">
        {t("welcome.description")}
      </p>
      <button
        className="no-drag mt-5 inline-flex h-8 items-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800"
        onClick={openImportWizard}
      >
        <FolderOpen size={15} />
        导入数据集
      </button>
    </div>
  );
}
