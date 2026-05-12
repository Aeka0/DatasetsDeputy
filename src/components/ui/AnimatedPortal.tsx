import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "../../lib/cn";

const exitDurationMs = 180;

function shouldAnimateDialogs() {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.uiAnimation !== "off";
}

export function AnimatedPortal({
  open,
  children,
  className
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [isRendered, setIsRendered] = useState(open);
  const [state, setState] = useState<"open" | "closed">("closed");
  const renderedChildrenRef = useRef<ReactNode>(children);

  if (open) {
    renderedChildrenRef.current = children;
  }

  useEffect(() => {
    let frame = 0;
    let nestedFrame = 0;
    let timer = 0;

    if (open) {
      setIsRendered(true);
      setState("closed");
      frame = window.requestAnimationFrame(() => {
        nestedFrame = window.requestAnimationFrame(() => setState("open"));
      });
      return () => {
        window.cancelAnimationFrame(frame);
        window.cancelAnimationFrame(nestedFrame);
      };
    }

    setState("closed");
    timer = window.setTimeout(
      () => setIsRendered(false),
      shouldAnimateDialogs() ? exitDurationMs : 0
    );

    return () => window.clearTimeout(timer);
  }, [open]);

  if (!isRendered) return null;

  return createPortal(
    <div className={cn("dialog-transition-root", className)} data-state={state}>
      {open ? children : renderedChildrenRef.current}
    </div>,
    document.body
  );
}

export function useAnimatedPortalClose(onClose: () => void) {
  const [open, setOpen] = useState(true);
  const isClosingRef = useRef(false);

  const close = useCallback(() => {
    if (isClosingRef.current) return;

    isClosingRef.current = true;
    setOpen(false);
    window.setTimeout(onClose, shouldAnimateDialogs() ? exitDurationMs : 0);
  }, [onClose]);

  return { open, close };
}
