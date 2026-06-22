import {
  autoUpdate,
  flip,
  offset as floatingOffset,
  type Placement,
  shift,
  size,
  useFloating
} from "@floating-ui/react-dom";

export function useFloatingDropdown({
  matchReferenceWidth = false,
  offset = 4,
  padding = 8,
  minHeight = 96,
  maxHeight,
  placement = "bottom-start"
}: {
  matchReferenceWidth?: boolean;
  offset?: number;
  padding?: number;
  minHeight?: number;
  maxHeight?: number;
  placement?: Placement;
}) {
  return useFloating({
    placement,
    strategy: "fixed",
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [
      floatingOffset(offset),
      flip({ padding }),
      shift({ padding }),
      size({
        padding,
        apply({ availableHeight, elements, rects }) {
          const availableMaxHeight = Math.max(minHeight, availableHeight);
          const resolvedMaxHeight =
            maxHeight === undefined
              ? availableMaxHeight
              : Math.max(minHeight, Math.min(maxHeight, availableMaxHeight));

          elements.floating.style.maxHeight = `${resolvedMaxHeight}px`;
          elements.floating.style.overflowY = "auto";

          if (matchReferenceWidth) {
            elements.floating.style.minWidth = `${rects.reference.width}px`;
          }
        }
      })
    ]
  });
}
