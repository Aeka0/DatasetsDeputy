import { useEffect } from "react";

import { ImagePreviewView } from "./components/content/ImagePreviewView";
import { DatasetWorkspace } from "./components/content/DatasetWorkspace";
import { ImportPreviewView } from "./components/content/ImportPreviewView";
import { ImportProgressView } from "./components/content/ImportProgressView";
import { ImportReportView } from "./components/content/ImportReportView";
import { WelcomeView } from "./components/content/WelcomeView";
import { ProjectTree } from "./components/sidebar/ProjectTree";
import { TitleMenuBar } from "./components/window/TitleMenuBar";
import { WindowControls } from "./components/window/WindowControls";
import { useDatasetStore } from "./stores/datasetStore";

export default function App() {
  const load = useDatasetStore((state) => state.load);
  const initImportEvents = useDatasetStore((state) => state.initImportEvents);
  const selectedProjectId = useDatasetStore((state) => state.selectedProjectId);
  const selectedImageId = useDatasetStore((state) => state.selectedImageId);
  const importPreview = useDatasetStore((state) => state.importPreview);
  const importProgress = useDatasetStore((state) => state.importProgress);
  const importReport = useDatasetStore((state) => state.importReport);

  useEffect(() => {
    void initImportEvents();
    void load();
  }, [initImportEvents, load]);

  useEffect(() => {
    const blockNativeContextMenu = (event: MouseEvent) => {
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

  return (
    <main className="fluent-shell relative flex h-screen w-screen flex-col overflow-hidden text-slate-950">
      <div className="app-drag-region fluent-titlebar relative z-10 flex h-10 w-full shrink-0 items-center justify-between pl-3">
        <div className="flex items-center gap-3">
          <div className="text-[13px] font-semibold text-black">Dataset Deputy</div>
          <TitleMenuBar />
        </div>
        <div className="z-20">
          <WindowControls />
        </div>
      </div>

      <div className="fluent-chrome relative flex min-h-0 flex-1">
        <ProjectTree />

        <section className="min-w-0 flex-1 p-3">
          <div className="h-full min-h-0 rounded-lg border border-slate-200 bg-white p-4">
            {importProgress && !importProgress.done ? (
              <ImportProgressView />
            ) : importReport ? (
              <ImportReportView />
            ) : importPreview ? (
              <ImportPreviewView />
            ) : selectedImageId ? (
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
