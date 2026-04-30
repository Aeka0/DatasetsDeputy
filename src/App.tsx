import { ChevronsLeft, ChevronsRight } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { AnnotationLogView } from "./components/content/AnnotationLogView";
import { ImagePreviewView } from "./components/content/ImagePreviewView";
import { DatasetWorkspace } from "./components/content/DatasetWorkspace";
import { ImportPreviewView } from "./components/content/ImportPreviewView";
import { ImportProgressView } from "./components/content/ImportProgressView";
import { ImportReportView } from "./components/content/ImportReportView";
import { ImportWizardView } from "./components/content/ImportWizardView";
import { WelcomeView } from "./components/content/WelcomeView";
import { ProjectTree } from "./components/sidebar/ProjectTree";
import { TitleMenuBar } from "./components/window/TitleMenuBar";
import { WindowControls } from "./components/window/WindowControls";
import { useDatasetStore } from "./stores/datasetStore";
import { hasTauriRuntime } from "./lib/tauri";

export default function App() {
  const [isProjectTreeCollapsed, setIsProjectTreeCollapsed] = useState(false);
  const load = useDatasetStore((state) => state.load);
  const initImportEvents = useDatasetStore((state) => state.initImportEvents);
  const appView = useDatasetStore((state) => state.appView);
  const selectedProjectId = useDatasetStore((state) => state.selectedProjectId);
  const previewImageId = useDatasetStore((state) => state.previewImageId);
  const importPreview = useDatasetStore((state) => state.importPreview);
  const importProgress = useDatasetStore((state) => state.importProgress);
  const importReport = useDatasetStore((state) => state.importReport);
  const showImportWizard = useDatasetStore((state) => state.showImportWizard);

  useEffect(() => {
    void initImportEvents();
    void load();
  }, [initImportEvents, load]);

  useEffect(() => {
    const blockNativeContextMenu = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-native-context-menu='true']")
      ) {
        return;
      }

      event.preventDefault();
    };

    window.addEventListener("contextmenu", blockNativeContextMenu);
    return () => window.removeEventListener("contextmenu", blockNativeContextMenu);
  }, []);

  const startTitlebarDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if (!hasTauriRuntime() || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".no-drag")) {
      return;
    }

    void getCurrentWindow().startDragging();
  };

  return (
    <main className="fluent-shell relative flex h-screen w-screen flex-col overflow-hidden text-slate-950">
      <div
        className="app-drag-region fluent-titlebar relative z-10 flex h-10 w-full shrink-0 items-center justify-between pl-3"
        data-tauri-drag-region
        onMouseDown={startTitlebarDrag}
      >
        <div className="flex items-center gap-3">
          <div className="text-[13px] font-semibold text-black">Datasets Deputy</div>
          <TitleMenuBar
            isProjectTreeCollapsed={isProjectTreeCollapsed}
            onToggleProjectTree={() => setIsProjectTreeCollapsed((collapsed) => !collapsed)}
          />
        </div>
        <div className="z-20">
          <WindowControls />
        </div>
      </div>

      <div className="fluent-chrome relative flex min-h-0 flex-1">
        {isProjectTreeCollapsed ? null : <ProjectTree />}

        <section className="min-w-0 flex-1 p-3">
          <div className="app-surface relative h-full min-h-0 rounded-lg border border-slate-200 bg-white p-4">
            <button
              type="button"
              className="no-drag absolute left-0 top-1/2 z-20 flex h-36 w-3 -translate-y-1/2 items-center justify-center rounded-r-sm text-black/38 transition hover:bg-black/[0.055] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20"
              aria-label={isProjectTreeCollapsed ? "展开树状图" : "收缩树状图"}
              title={isProjectTreeCollapsed ? "展开树状图" : "收缩树状图"}
              onClick={() => setIsProjectTreeCollapsed((collapsed) => !collapsed)}
            >
              {isProjectTreeCollapsed ? (
                <ChevronsRight size={11} />
              ) : (
                <ChevronsLeft size={11} />
              )}
            </button>
            {importProgress && !importProgress.done ? (
              <ImportProgressView />
            ) : importReport ? (
              <ImportReportView />
            ) : importPreview ? (
              <ImportPreviewView />
            ) : showImportWizard ? (
              <ImportWizardView />
            ) : appView === "logs" ? (
              <AnnotationLogView />
            ) : appView === "initial" ? (
              <WelcomeView />
            ) : previewImageId ? (
              <ImagePreviewView />
            ) : selectedProjectId ? (
              <DatasetWorkspace />
            ) : (
              <WelcomeView />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
