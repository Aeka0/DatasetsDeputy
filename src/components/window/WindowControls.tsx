import {
  currentMonitor,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize
} from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { hasTauriRuntime } from "../../lib/tauri";

function setDocumentMaximizedState(isMaximized: boolean) {
  document.documentElement.dataset.windowMaximized = isMaximized ? "true" : "false";
}

interface WindowControlsProps {
  onClose: () => void;
}

interface WindowBounds {
  position: PhysicalPosition;
  size: PhysicalSize;
}

function updateMaximizedState(setIsMaximized: (isMaximized: boolean) => void, value: boolean) {
  setIsMaximized(value);
  setDocumentMaximizedState(value);
}

export function WindowControls({ onClose }: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const fakeMaximizedRef = useRef(false);
  const applyingWindowLayoutRef = useRef(false);
  const restoreBoundsRef = useRef<WindowBounds | null>(null);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    const currentWindow = getCurrentWindow();

    const refreshMaximizedState = async () => {
      if (applyingWindowLayoutRef.current) return;

      try {
        if (fakeMaximizedRef.current) {
          const [monitor, position, size] = await Promise.all([
            currentMonitor(),
            currentWindow.outerPosition(),
            currentWindow.outerSize()
          ]);
          const workArea = monitor?.workArea;
          const stillMatchesWorkArea = Boolean(
            workArea &&
              Math.abs(position.x - workArea.position.x) <= 1 &&
              Math.abs(position.y - workArea.position.y) <= 1 &&
              Math.abs(size.width - workArea.size.width) <= 1 &&
              Math.abs(size.height - workArea.size.height) <= 1
          );

          if (!stillMatchesWorkArea) {
            fakeMaximizedRef.current = false;
            updateMaximizedState(setIsMaximized, false);
          }
          return;
        }

        updateMaximizedState(setIsMaximized, await currentWindow.isMaximized());
      } catch (error) {
        console.error(error);
      }
    };

    void refreshMaximizedState();

    const unlistenResizePromise = currentWindow.onResized(() => void refreshMaximizedState());
    const unlistenMovePromise = currentWindow.onMoved(() => void refreshMaximizedState());

    return () => {
      unlistenResizePromise.then((unlisten) => unlisten()).catch(console.error);
      unlistenMovePromise.then((unlisten) => unlisten()).catch(console.error);
    };
  }, []);

  const toggleFakeMaximize = async () => {
    const currentWindow = getCurrentWindow();
    applyingWindowLayoutRef.current = true;

    try {
      if (fakeMaximizedRef.current || (await currentWindow.isMaximized())) {
        if (await currentWindow.isMaximized()) {
          await currentWindow.unmaximize();
        }

        const restoreBounds = restoreBoundsRef.current;
        if (restoreBounds) {
          await currentWindow.setPosition(restoreBounds.position);
          await currentWindow.setSize(restoreBounds.size);
        }

        fakeMaximizedRef.current = false;
        updateMaximizedState(setIsMaximized, false);
        return;
      }

      const [monitor, position, size] = await Promise.all([
        currentMonitor(),
        currentWindow.outerPosition(),
        currentWindow.outerSize()
      ]);
      if (!monitor) return;

      restoreBoundsRef.current = { position, size };
      await currentWindow.setPosition(monitor.workArea.position);
      await currentWindow.setSize(monitor.workArea.size);
      fakeMaximizedRef.current = true;
      updateMaximizedState(setIsMaximized, true);
    } catch (error) {
      console.error(error);
    } finally {
      applyingWindowLayoutRef.current = false;
    }
  };

  const withWindow = (action: "minimize" | "toggleMaximize") => {
    if (!hasTauriRuntime()) {
      return;
    }

    const currentWindow = getCurrentWindow();
    if (action === "minimize") {
      void currentWindow.minimize();
    } else {
      void toggleFakeMaximize();
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
