import { ChevronsLeft, ChevronsRight } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";

import { AnnotationLogView } from "./components/content/AnnotationLogView";
import { ImagePreviewView } from "./components/content/ImagePreviewView";
import { DatasetWorkspace } from "./components/content/DatasetWorkspace";
import { ImportPreviewView } from "./components/content/ImportPreviewView";
import { ImportProgressView } from "./components/content/ImportProgressView";
import { ImportReportView } from "./components/content/ImportReportView";
import { ImportWizardView } from "./components/content/ImportWizardView";
import { WelcomeView } from "./components/content/WelcomeView";
import { ExportDialog } from "./components/export/ExportDialog";
import { ProjectTree } from "./components/sidebar/ProjectTree";
import { TitleMenuBar } from "./components/window/TitleMenuBar";
import { WindowControls } from "./components/window/WindowControls";
import { useDatasetStore } from "./stores/datasetStore";
import { hasTauriRuntime, invokeCommand } from "./lib/tauri";
import { setWindowRenderMode, type WindowRenderingSettings } from "./lib/theme";
import { formatAppError } from "./lib/errors";
import { installOverlayScrollbars } from "./lib/overlayScrollbars";
import {
  getUnsavedTableDraftState,
  type UnsavedTableDraftItem
} from "./lib/tableDrafts";

const STARTUP_PRELOAD_TIMEOUT_MS = 8000;

interface UnsavedExitItem extends UnsavedTableDraftItem {
  profileName: string;
}

function getUnsavedAnnotationState(): {
  changes: ReturnType<typeof getUnsavedTableDraftState>["changes"];
  items: UnsavedExitItem[];
} {
  const {
    images,
    profiles,
    tableDraftProfileId,
    tableAnnotationDrafts,
    tableInstructionDrafts,
    tableProfileAnnotationDrafts,
    tableProfileInstructionDrafts
  } = useDatasetStore.getState();
  const profileNames = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const unsavedState = getUnsavedTableDraftState({
    images,
    tableDraftProfileId,
    tableAnnotationDrafts,
    tableInstructionDrafts,
    tableProfileAnnotationDrafts,
    tableProfileInstructionDrafts
  });

  return {
    changes: unsavedState.changes,
    items: unsavedState.items.map((item) => ({
      ...item,
      profileName: profileNames.get(item.profileId) ?? `#${item.profileId}`
    }))
  };
}

export default function App() {
  const { t } = useTranslation();
  const [isProjectTreeCollapsed, setIsProjectTreeCollapsed] = useState(false);
  const [showUnsavedExitDialog, setShowUnsavedExitDialog] = useState(false);
  const [isExitSaving, setIsExitSaving] = useState(false);
  const [exitError, setExitError] = useState("");
  const allowWindowCloseRef = useRef(false);
  const appView = useDatasetStore((state) => state.appView);
  const selectedProjectId = useDatasetStore((state) => state.selectedProjectId);
  const previewImageId = useDatasetStore((state) => state.previewImageId);
  const importPreview = useDatasetStore((state) => state.importPreview);
  const importProgress = useDatasetStore((state) => state.importProgress);
  const importReport = useDatasetStore((state) => state.importReport);
  const showImportWizard = useDatasetStore((state) => state.showImportWizard);
  const images = useDatasetStore((state) => state.images);

  useEffect(() => installOverlayScrollbars(), []);
  const profiles = useDatasetStore((state) => state.profiles);
  const tableDraftProfileId = useDatasetStore((state) => state.tableDraftProfileId);
  const tableAnnotationDrafts = useDatasetStore((state) => state.tableAnnotationDrafts);
  const tableInstructionDrafts = useDatasetStore((state) => state.tableInstructionDrafts);
  const tableProfileAnnotationDrafts = useDatasetStore(
    (state) => state.tableProfileAnnotationDrafts
  );
  const tableProfileInstructionDrafts = useDatasetStore(
    (state) => state.tableProfileInstructionDrafts
  );
  const saveAnnotationChanges = useDatasetStore((state) => state.saveAnnotationChanges);

  const unsavedExitItems = useMemo(
    () => getUnsavedAnnotationState().items,
    [
      images,
      profiles,
      tableAnnotationDrafts,
      tableDraftProfileId,
      tableInstructionDrafts,
      tableProfileAnnotationDrafts,
      tableProfileInstructionDrafts
    ]
  );

  const closeWindowNow = useCallback(() => {
    allowWindowCloseRef.current = true;
    if (hasTauriRuntime()) {
      const currentWindow = getCurrentWindow();
      void currentWindow.destroy().catch(() => currentWindow.close());
      return;
    }
    window.close();
  }, []);

  const requestExit = useCallback(() => {
    const { items } = getUnsavedAnnotationState();
    if (items.length === 0) {
      closeWindowNow();
      return;
    }

    setExitError("");
    setShowUnsavedExitDialog(true);
  }, [closeWindowNow]);

  const saveAndExit = useCallback(async () => {
    const { changes } = getUnsavedAnnotationState();
    setIsExitSaving(true);
    setExitError("");
    try {
      if (changes.length > 0) {
        await saveAnnotationChanges(changes);
      }
      closeWindowNow();
    } catch (error) {
      setExitError(formatAppError(error));
      setIsExitSaving(false);
    }
  }, [closeWindowNow, saveAnnotationChanges]);

  const discardAndExit = useCallback(() => {
    closeWindowNow();
  }, [closeWindowNow]);

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    const store = useDatasetStore.getState();
    const loadWindowRendering = invokeCommand<WindowRenderingSettings>(
      "get_window_rendering_settings"
    )
      .then((settings) => setWindowRenderMode(settings.mode))
      .catch((error) => {
        console.error(t("appConsole.windowRenderingFallback"), error);
      });
    const preload = Promise.all([
      loadWindowRendering,
      store.initImportEvents(),
      store.initExportEvents(),
      store.load()
    ])
      .catch((error) => {
        console.error(t("appConsole.startupPreloadFailed"), error);
      });
    const timeout = new Promise<void>((resolve) =>
      window.setTimeout(resolve, STARTUP_PRELOAD_TIMEOUT_MS)
    );

    void Promise.race([preload, timeout])
      .then(() => invokeCommand<void>("finish_startup"))
      .catch((error) => {
        console.error(t("appConsole.finishStartupFailed"), error);
      });
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    if (unsavedExitItems.length === 0) return;

    const currentWindow = getCurrentWindow();
    const unlistenPromise = currentWindow.onCloseRequested((event) => {
      if (allowWindowCloseRef.current) return;
      event.preventDefault();
      setExitError("");
      setShowUnsavedExitDialog(true);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error);
    };
  }, [unsavedExitItems.length]);

  useEffect(() => {
    if (hasTauriRuntime()) return;

    const blockBrowserClose = (event: BeforeUnloadEvent) => {
      if (getUnsavedAnnotationState().items.length === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", blockBrowserClose);
    return () => window.removeEventListener("beforeunload", blockBrowserClose);
  }, []);

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
    <main className="fluent-shell relative flex h-screen w-screen flex-col overflow-hidden text-neutral-950">
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
            onExit={requestExit}
          />
        </div>
        <div className="z-20">
          <WindowControls onClose={requestExit} />
        </div>
      </div>

      <div className="fluent-chrome relative flex min-h-0 flex-1">
        {isProjectTreeCollapsed ? null : <ProjectTree />}

        <section className="min-w-0 flex-1 p-3">
          <div className="app-surface relative h-full min-h-0 rounded-lg border border-neutral-200 bg-white p-4">
            <button
              type="button"
              className="sidebar-collapse-toggle no-drag absolute left-0 top-1/2 z-20 flex w-3.5 -translate-y-1/2 items-center justify-center focus-visible:outline-none"
              aria-label={isProjectTreeCollapsed ? t("aria.expandTree") : t("aria.collapseTree")}
              title={isProjectTreeCollapsed ? t("aria.expandTree") : t("aria.collapseTree")}
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
            ) : selectedProjectId ? (
              <>
                <DatasetWorkspace />
                {previewImageId ? (
                  <div className="absolute inset-0 z-10 rounded-lg bg-white p-4">
                    <ImagePreviewView />
                  </div>
                ) : null}
              </>
            ) : (
              <WelcomeView />
            )}
          </div>
        </section>
      </div>
      <ExportDialog />
      {showUnsavedExitDialog ? (
        <div className="no-drag fixed inset-0 z-[90] flex items-center justify-center bg-neutral-950/24 px-5">
          <section
            className="flex max-h-[78vh] w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.24)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-exit-title"
          >
            <header className="border-b border-neutral-200 px-5 py-4">
              <h2 id="unsaved-exit-title" className="m-0 text-[15px] font-semibold text-neutral-950">
                {t("exitGuard.title")}
              </h2>
              <p className="mt-1 text-[13px] text-neutral-600">
                {t("exitGuard.description")}
              </p>
            </header>

            <div className="hover-scrollbar min-h-0 flex-1 overflow-auto px-5 py-3">
              <div className="mb-2 text-[12px] font-medium text-neutral-500">
                {t("exitGuard.unsavedItems", { count: unsavedExitItems.length })}
              </div>
              <div className="hover-scrollbar max-h-72 overflow-auto rounded-md border border-neutral-200">
                {unsavedExitItems.map((item) => (
                  <div
                    key={`${item.profileId}:${item.imageId}`}
                    className="border-b border-neutral-100 px-3 py-2 last:border-b-0"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-900">
                        {item.fileName}
                      </div>
                      <div className="max-w-[180px] shrink-0 truncate rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                        {item.profileName}
                      </div>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-neutral-500">
                      {item.path}
                    </div>
                    <div className="mt-1 text-[12px] text-neutral-500">
                      {item.fields
                        .map((field) => t(`exitGuard.field.${field}`))
                        .join(" / ")}
                    </div>
                  </div>
                ))}
              </div>
              {exitError ? (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                  {t("exitGuard.saveFailed", { message: exitError })}
                </div>
              ) : null}
            </div>

            <footer className="flex justify-end gap-2 border-t border-neutral-200 px-5 py-4">
              <button
                type="button"
                className="no-drag h-8 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isExitSaving}
                onClick={() => setShowUnsavedExitDialog(false)}
              >
                {t("exitGuard.cancel")}
              </button>
              <button
                type="button"
                className="no-drag h-8 rounded-md border border-red-600 bg-red-600 px-3 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isExitSaving}
                onClick={discardAndExit}
              >
                {t("exitGuard.discardAndExit")}
              </button>
              <button
                type="button"
                className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isExitSaving}
                onClick={() => void saveAndExit()}
              >
                {isExitSaving ? t("exitGuard.saving") : t("exitGuard.saveAndExit")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
