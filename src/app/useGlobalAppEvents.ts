import { useEffect } from "react";

import { useDatasetStore } from "../stores/datasetStore";

export function useGlobalAppEvents() {
  useEffect(() => {
    const blockNativeContextMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-native-context-menu='true']")) {
        return;
      }
      event.preventDefault();
    };

    window.addEventListener("contextmenu", blockNativeContextMenu);
    return () => window.removeEventListener("contextmenu", blockNativeContextMenu);
  }, []);

  useEffect(() => {
    const applyHistoryShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, [contenteditable='true']"))
      ) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      const key = event.key.toLowerCase();
      const store = useDatasetStore.getState();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        void store.undo();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        void store.redo();
      }
    };

    window.addEventListener("keydown", applyHistoryShortcut);
    return () => window.removeEventListener("keydown", applyHistoryShortcut);
  }, []);
}
