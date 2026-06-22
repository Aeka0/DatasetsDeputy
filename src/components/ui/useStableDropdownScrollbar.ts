import { useCallback, useEffect, useState, type RefObject } from "react";

export const DROPDOWN_VISIBLE_ITEM_LIMIT = 10;
export const DROPDOWN_ITEM_HEIGHT = 32;
const DROPDOWN_ITEM_GAP = 1;
const DROPDOWN_VERTICAL_PADDING = 12;
const DROPDOWN_BORDER_HEIGHT = 2;
const DROPDOWN_MIN_HEIGHT = 96;
const SCROLLBAR_TRACK_INSET = 6;
const SCROLLBAR_THUMB_MIN_HEIGHT = 24;
const SCROLLBAR_THUMB_WIDTH = 4;
const SCROLLBAR_THUMB_RIGHT_INSET = 4;

export interface StableDropdownScrollbarThumb {
  visible: boolean;
  left: number;
  top: number;
  height: number;
}

const HIDDEN_THUMB: StableDropdownScrollbarThumb = {
  visible: false,
  left: 0,
  top: SCROLLBAR_TRACK_INSET,
  height: SCROLLBAR_THUMB_MIN_HEIGHT
};

export function estimateDropdownHeight(optionCount: number) {
  const visibleItemCount = Math.min(optionCount, DROPDOWN_VISIBLE_ITEM_LIMIT);
  const gapCount = Math.max(0, visibleItemCount - 1);

  return Math.max(
    DROPDOWN_MIN_HEIGHT,
    visibleItemCount * DROPDOWN_ITEM_HEIGHT +
      gapCount * DROPDOWN_ITEM_GAP +
      DROPDOWN_VERTICAL_PADDING +
      DROPDOWN_BORDER_HEIGHT
  );
}

export function useStableDropdownScrollbar(
  menuRef: RefObject<HTMLElement | null>,
  active: boolean
) {
  const [scrollThumb, setScrollThumb] = useState<StableDropdownScrollbarThumb>(HIDDEN_THUMB);

  const updateScrollThumb = useCallback(() => {
    const dropdown = menuRef.current;
    if (!dropdown) {
      setScrollThumb((current) => (current.visible ? HIDDEN_THUMB : current));
      return;
    }

    const { clientHeight, scrollHeight, scrollTop } = dropdown;
    if (scrollHeight <= clientHeight + 1) {
      setScrollThumb((current) => (current.visible ? HIDDEN_THUMB : current));
      return;
    }

    const rect = dropdown.getBoundingClientRect();
    const trackHeight = Math.max(0, clientHeight - SCROLLBAR_TRACK_INSET * 2);
    const thumbHeight = Math.max(
      SCROLLBAR_THUMB_MIN_HEIGHT,
      Math.round((clientHeight / scrollHeight) * trackHeight)
    );
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const scrollableDistance = Math.max(1, scrollHeight - clientHeight);
    const top =
      rect.top + SCROLLBAR_TRACK_INSET + (scrollTop / scrollableDistance) * maxThumbTop;

    setScrollThumb({
      visible: true,
      left: rect.right - SCROLLBAR_THUMB_RIGHT_INSET - SCROLLBAR_THUMB_WIDTH,
      top,
      height: thumbHeight
    });
  }, [menuRef]);

  useEffect(() => {
    if (!active) {
      setScrollThumb((current) => (current.visible ? HIDDEN_THUMB : current));
      return;
    }

    let frameId = window.requestAnimationFrame(updateScrollThumb);
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateScrollThumb);
    };

    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [active, updateScrollThumb]);

  return { scrollThumb, updateScrollThumb };
}
