import { ArrowLeft, Database, DatabaseZap, Folders } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { useDatasetStore } from "../../stores/datasetStore";

const ATTENTION_ANIMATION_MS = 1300;

export function ImportWizardView() {
  const { t } = useTranslation();
  const importAssetDatabase = useDatasetStore((state) => state.importAssetDatabase);
  const importFolder = useDatasetStore((state) => state.importFolder);
  const mountFolder = useDatasetStore((state) => state.mountFolder);
  const closeImportWizard = useDatasetStore((state) => state.closeImportWizard);
  const importWizardAttentionKey = useDatasetStore((state) => state.importWizardAttentionKey);
  const isLoading = useDatasetStore((state) => state.isLoading);
  const [isAttentionActive, setIsAttentionActive] = useState(false);

  const assetDatabasePoints = t("importWizard.assetDatabasePoints", { returnObjects: true }) as string[];
  const databasePoints = t("importWizard.dynamicDatabasePoints", { returnObjects: true }) as string[];
  const folderPoints = t("importWizard.folderPoints", { returnObjects: true }) as string[];
  const optionButtonClassName = cn(
    "no-drag import-wizard-option group row-span-3 grid min-w-0 grid-rows-subgrid content-start rounded-md bg-transparent px-5 py-8 text-left transition-[background-color,transform] duration-500 ease-in-out hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 disabled:cursor-not-allowed disabled:opacity-50",
    isAttentionActive && "import-wizard-option-attention"
  );

  useEffect(() => {
    if (importWizardAttentionKey === 0) return;

    setIsAttentionActive(false);
    const animationFrame = window.requestAnimationFrame(() => {
      setIsAttentionActive(true);
    });
    const timeout = window.setTimeout(() => {
      setIsAttentionActive(false);
    }, ATTENTION_ANIMATION_MS);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
    };
  }, [importWizardAttentionKey]);

  return (
    <div className="relative flex h-full min-h-0 items-center px-6 py-5">
      <button
        type="button"
        className="no-drag absolute left-5 top-4 inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
        onClick={closeImportWizard}
      >
        <ArrowLeft size={15} />
        {t("actions.back")}
      </button>
      <div className="mx-auto flex min-h-0 w-full max-w-[1120px] flex-col">
        <header className="shrink-0 pb-8 text-center">
          <h1 className="m-0 text-[26px] font-normal leading-9 text-neutral-950">
            {t("importWizard.title")}
          </h1>
        </header>

        <div className="hover-scrollbar grid min-h-0 grid-cols-3 grid-rows-[auto_1fr_auto] gap-5 overflow-auto">
          <button
            type="button"
            className={optionButtonClassName}
            disabled={isLoading}
            onClick={() => void importAssetDatabase()}
          >
            <div className="flex items-center gap-3 self-start">
              <Database size={24} className="text-neutral-900 transition group-hover:scale-105" />
              <h2 className="m-0 text-[19px] font-normal leading-7 text-neutral-950">
                {t("importWizard.assetDatabase")}
              </h2>
            </div>
            <p className="self-start text-[14px] leading-7 text-neutral-600">
              {t("importWizard.assetDatabaseDescription")}
            </p>
            <ul className="list-disc space-y-2 pl-5 text-[13px] leading-6 text-neutral-500 marker:text-neutral-400 self-start">
              {assetDatabasePoints.map((item, index) => (
                <li key={`importWizard-asset-db-${index}`}>{item}</li>
              ))}
            </ul>
          </button>

          <button
            type="button"
            className={optionButtonClassName}
            disabled={isLoading}
            onClick={() => void importFolder()}
          >
            <div className="flex items-center gap-3 self-start">
              <DatabaseZap size={24} className="text-neutral-900 transition group-hover:scale-105" />
              <h2 className="m-0 text-[19px] font-normal leading-7 text-neutral-950">
                {t("importWizard.dynamicDatabase")}
              </h2>
            </div>
            <p className="self-start text-[14px] leading-7 text-neutral-600">
              {t("importWizard.dynamicDatabaseDescription")}
            </p>
            <ul className="list-disc space-y-2 pl-5 text-[13px] leading-6 text-neutral-500 marker:text-neutral-400 self-start">
              {databasePoints.map((item, index) => (
                <li key={`importWizard-db-${index}`}>{item}</li>
              ))}
            </ul>
          </button>

          <button
            type="button"
            className={optionButtonClassName}
            disabled={isLoading}
            onClick={() => void mountFolder()}
          >
            <div className="flex items-center gap-3 self-start">
              <Folders size={24} className="text-neutral-900 transition group-hover:scale-105" />
              <h2 className="m-0 text-[19px] font-normal leading-7 text-neutral-950">
                {t("importWizard.folder")}
              </h2>
            </div>
            <p className="self-start text-[14px] leading-7 text-neutral-600">
              {t("importWizard.folderDescription")}
            </p>
            <ul className="list-disc space-y-2 pl-5 text-[13px] leading-6 text-neutral-500 marker:text-neutral-400 self-start">
              {folderPoints.map((item, index) => (
                <li key={`importWizard-folder-${index}`}>{item}</li>
              ))}
            </ul>
          </button>
        </div>
      </div>
    </div>
  );
}
