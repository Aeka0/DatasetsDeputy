import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

import { hasTauriRuntime } from "../../lib/tauri";

function setDocumentMaximizedState(isMaximized: boolean) {
  document.documentElement.dataset.windowMaximized = isMaximized ? "true" : "false";
}

interface WindowControlsProps {
  onClose: () => void;
}

export function WindowControls({ onClose }: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    const currentWindow = getCurrentWindow();

    const refreshMaximizedState = () => {
      currentWindow
        .isMaximized()
        .then((maximized) => {
          setIsMaximized(maximized);
          setDocumentMaximizedState(maximized);
        })
        .catch(console.error);
    };
    
    refreshMaximizedState();

    const unlistenPromise = currentWindow.onResized(refreshMaximizedState);

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error);
    };
  }, []);

  const withWindow = (action: "minimize" | "toggleMaximize") => {
    if (!hasTauriRuntime()) {
      return;
    }

    const currentWindow = getCurrentWindow();
    if (action === "minimize") {
      void currentWindow.minimize();
    } else {
      void currentWindow.toggleMaximize();
    }
  };

  return (
    <div className="no-drag flex h-10 overflow-hidden rounded-bl-xl text-neutral-700">
      <button
        aria-label="Minimize"
        type="button"
        className="fluent-control-button flex h-10 w-12 items-center justify-center"
        onClick={() => withWindow("minimize")}
      >
        <Minus size={15} />
      </button>
      <button
        aria-label={isMaximized ? "Restore" : "Maximize"}
        type="button"
        className="fluent-control-button flex h-10 w-12 items-center justify-center"
        onClick={() => withWindow("toggleMaximize")}
      >
        {isMaximized ? (
          <Copy size={12} className="rotate-180 scale-x-[-1]" />
        ) : (
          <Square size={12} />
        )}
      </button>
      <button
        aria-label="Close"
        type="button"
        className="fluent-control-button close flex h-10 w-12 items-center justify-center"
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>
  );
}
