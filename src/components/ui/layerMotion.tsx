import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { isUiAnimationEnabled, watchUiAnimation } from "../../lib/theme";

export const appLayerMotionDurationSeconds = 0.16;
export const appLayerMotionDurationMs = appLayerMotionDurationSeconds * 1000;
export const appLayerMotionEase = [0.2, 0.8, 0.2, 1] as const;

type LayerMotionPreset = "menu" | "flyout" | "dialog" | "fade";

const layerMotionStates = {
  menu: {
    initial: { opacity: 0, y: -4, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -4, scale: 0.985 }
  },
  flyout: {
    initial: { opacity: 0, y: 8, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 6, scale: 0.985 }
  },
  dialog: {
    initial: { opacity: 0, y: 10, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 8, scale: 0.99 }
  },
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 }
  }
} satisfies Record<LayerMotionPreset, Pick<HTMLMotionProps<"div">, "initial" | "animate" | "exit">>;

export function useUiAnimationEnabled() {
  const [enabled, setEnabled] = useState(isUiAnimationEnabled);

  useEffect(() => {
    setEnabled(isUiAnimationEnabled());
    return watchUiAnimation(() => setEnabled(isUiAnimationEnabled()));
  }, []);

  return enabled;
}

export function getLayerMotionProps(
  enabled: boolean,
  preset: LayerMotionPreset = "menu"
): Pick<HTMLMotionProps<"div">, "initial" | "animate" | "exit" | "transition"> {
  if (!enabled) {
    return {
      initial: false,
      animate: { opacity: 1 },
      exit: { opacity: 1 },
      transition: { duration: 0 }
    };
  }

  return {
    ...layerMotionStates[preset],
    transition: { duration: appLayerMotionDurationSeconds, ease: appLayerMotionEase }
  };
}

type AnimatedLayerProps = Omit<
  HTMLMotionProps<"div">,
  "initial" | "animate" | "exit" | "transition"
> & {
  animateUi?: boolean;
  preset?: LayerMotionPreset;
};

export const AnimatedLayer = forwardRef<HTMLDivElement, AnimatedLayerProps>(
  ({ animateUi = true, preset = "menu", ...props }, ref) => (
    <motion.div ref={ref} {...getLayerMotionProps(animateUi, preset)} {...props} />
  )
);

AnimatedLayer.displayName = "AnimatedLayer";

export function AnimatedLayerPortal({
  children,
  root
}: {
  children: ReactNode;
  root?: Element;
}) {
  const portalRoot = root ?? document.body;
  return createPortal(<AnimatePresence>{children}</AnimatePresence>, portalRoot);
}
