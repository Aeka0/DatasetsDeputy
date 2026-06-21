import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { hasTauriRuntime, invokeCommand } from "../lib/tauri";
import { setWindowRenderMode, type WindowRenderingSettings } from "../lib/theme";
import { installOverlayScrollbars } from "../lib/overlayScrollbars";
import { useDatasetStore } from "../stores/datasetStore";

const STARTUP_PRELOAD_TIMEOUT_MS = 8000;

export function useAppBootstrap() {
  const { t } = useTranslation();

  useEffect(() => installOverlayScrollbars(), []);

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
    const preload = (async () => {
      await Promise.all([
        loadWindowRendering,
        store.initThumbnailEvents(),
        store.initImportEvents(),
        store.initExportEvents(),
        store.initDatabaseExportEvents(),
        store.initHistory()
      ]);
      await store.load();
    })().catch((error) => {
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
}
