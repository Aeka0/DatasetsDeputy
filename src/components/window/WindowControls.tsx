import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

import { hasTauriRuntime } from "../../lib/tauri";

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    const currentWindow = getCurrentWindow();
    
    // Initial check
    currentWindow.isMaximized().then(setIsMaximized).catch(console.error);

    // Listen for resize events to update the maximize icon
    const unlistenPromise = currentWindow.onResized(() => {
      currentWindow.isMaximized().then(setIsMaximized).catch(console.error);
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error);
    };
  }, []);

  const withWindow = (action: "minimize" | "toggleMaximize" | "close") => {
    if (!hasTauriRuntime()) {
      return;
    }

    const currentWindow = getCurrentWindow();
    if (action === "minimize") {
      void currentWindow.minimize();
    } else if (action === "toggleMaximize") {
      void currentWindow.toggleMaximize();
    } else {
      void currentWindow.close();
    }
  };

  return (
    <div className="no-drag flex h-10 overflow-hidden rounded-bl-xl text-slate-700">
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
        onClick={() => withWindow("close")}
      >
        <X size={16} />
      </button>
    </div>
  );
}
