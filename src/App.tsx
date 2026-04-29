import { useEffect } from "react";

import { ImportPreviewView } from "./components/content/ImportPreviewView";
import { ImportProgressView } from "./components/content/ImportProgressView";
import { WelcomeView } from "./components/content/WelcomeView";
import { DatasetGrid } from "./components/grid/DatasetGrid";
import { ProjectTree } from "./components/sidebar/ProjectTree";
import { TitleMenuBar } from "./components/window/TitleMenuBar";
import { WindowControls } from "./components/window/WindowControls";
import { useDatasetStore } from "./stores/datasetStore";

export default function App() {
  const load = useDatasetStore((state) => state.load);
  const initImportEvents = useDatasetStore((state) => state.initImportEvents);
  const selectedProjectId = useDatasetStore((state) => state.selectedProjectId);
  const importPreview = useDatasetStore((state) => state.importPreview);
  const importProgress = useDatasetStore((state) => state.importProgress);

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
      <div className="app-drag-region relative z-10 flex h-10 w-full shrink-0 items-center justify-between pl-4">
        <div className="flex items-center gap-4">
          <div className="text-sm font-medium text-slate-700">Dataset Deputy</div>
          <TitleMenuBar />
        </div>
        <div className="z-20">
          <WindowControls />
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        <ProjectTree />

        <section className="min-w-0 flex-1 px-2 pb-2 pt-2">
          <div className="h-full min-h-0 rounded-md border border-slate-200/70 bg-white/[0.86] p-3">
            {importProgress && !importProgress.done ? (
              <ImportProgressView />
            ) : importPreview ? (
              <ImportPreviewView />
            ) : selectedProjectId ? (
              <DatasetGrid />
            ) : (
              <WelcomeView />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
