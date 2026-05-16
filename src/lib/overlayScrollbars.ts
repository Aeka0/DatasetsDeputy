const HOST_SELECTOR = ".hover-scrollbar";
const INITIALIZED_ATTR = "data-overlay-scrollbar";

type OverlayScrollbarState = {
  cleanup: () => void;
};

const states = new WeakMap<HTMLElement, OverlayScrollbarState>();

function updateThumbs(host: HTMLElement, verticalThumb: HTMLElement, horizontalThumb: HTMLElement) {
  const {
    clientHeight,
    clientWidth,
    scrollHeight,
    scrollLeft,
    scrollTop,
    scrollWidth
  } = host;
  const hasVerticalScroll = scrollHeight > clientHeight + 1;
  const hasHorizontalScroll = scrollWidth > clientWidth + 1;

  verticalThumb.hidden = !hasVerticalScroll;
  horizontalThumb.hidden = !hasHorizontalScroll;

  if (hasVerticalScroll) {
    const thumbHeight = Math.max(28, Math.round((clientHeight / scrollHeight) * clientHeight));
    const maxThumbY = clientHeight - thumbHeight - 4;
    const maxScrollY = scrollHeight - clientHeight;
    const thumbY = maxScrollY > 0 ? 2 + (scrollTop / maxScrollY) * maxThumbY : 2;
    const thumbX = scrollLeft + clientWidth - 8;

    verticalThumb.style.height = `${thumbHeight}px`;
    verticalThumb.style.transform = `translate3d(${thumbX}px, ${scrollTop + thumbY}px, 0)`;
  }

  if (hasHorizontalScroll) {
    const thumbWidth = Math.max(28, Math.round((clientWidth / scrollWidth) * clientWidth));
    const maxThumbX = clientWidth - thumbWidth - 4;
    const maxScrollX = scrollWidth - clientWidth;
    const thumbX = maxScrollX > 0 ? 2 + (scrollLeft / maxScrollX) * maxThumbX : 2;
    const thumbY = scrollTop + clientHeight - 8;

    horizontalThumb.style.width = `${thumbWidth}px`;
    horizontalThumb.style.transform = `translate3d(${scrollLeft + thumbX}px, ${thumbY}px, 0)`;
  }
}

function setupHost(host: HTMLElement) {
  if (states.has(host)) return;

  host.setAttribute(INITIALIZED_ATTR, "true");

  const verticalThumb = document.createElement("div");
  verticalThumb.className = "overlay-scrollbar-thumb overlay-scrollbar-thumb-y";
  verticalThumb.setAttribute("aria-hidden", "true");

  const horizontalThumb = document.createElement("div");
  horizontalThumb.className = "overlay-scrollbar-thumb overlay-scrollbar-thumb-x";
  horizontalThumb.setAttribute("aria-hidden", "true");

  host.append(verticalThumb, horizontalThumb);

  let animationFrame = 0;
  const requestUpdate = () => {
    if (animationFrame) return;
    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = 0;
      updateThumbs(host, verticalThumb, horizontalThumb);
    });
  };

  const onScroll = () => {
    updateThumbs(host, verticalThumb, horizontalThumb);
  };

  const makeDraggable = (thumb: HTMLElement, isVertical: boolean) => {
    let startPos = 0;
    let startScroll = 0;

    const onPointerMove = (e: PointerEvent) => {
      const { clientHeight, clientWidth, scrollHeight, scrollWidth } = host;
      if (isVertical) {
        const thumbHeight = Math.max(28, Math.round((clientHeight / scrollHeight) * clientHeight));
        const maxThumbY = clientHeight - thumbHeight - 4;
        const maxScrollY = scrollHeight - clientHeight;
        if (maxThumbY > 0) {
          const deltaY = e.clientY - startPos;
          host.scrollTop = startScroll + deltaY * (maxScrollY / maxThumbY);
        }
      } else {
        const thumbWidth = Math.max(28, Math.round((clientWidth / scrollWidth) * clientWidth));
        const maxThumbX = clientWidth - thumbWidth - 4;
        const maxScrollX = scrollWidth - clientWidth;
        if (maxThumbX > 0) {
          const deltaX = e.clientX - startPos;
          host.scrollLeft = startScroll + deltaX * (maxScrollX / maxThumbX);
        }
      }
    };

    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      thumb.classList.remove("overlay-scrollbar-thumb-dragging");
    };

    thumb.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startPos = isVertical ? e.clientY : e.clientX;
      startScroll = isVertical ? host.scrollTop : host.scrollLeft;
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
      thumb.classList.add("overlay-scrollbar-thumb-dragging");
    });
  };

  makeDraggable(verticalThumb, true);
  makeDraggable(horizontalThumb, false);

  const resizeObserver = new ResizeObserver(requestUpdate);
  resizeObserver.observe(host);

  const contentResizeObserver = new ResizeObserver(requestUpdate);
  const syncContentResizeObservers = () => {
    contentResizeObserver.disconnect();

    Array.from(host.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      if (child.classList.contains("overlay-scrollbar-thumb")) return;

      contentResizeObserver.observe(child);
    });
  };

  const contentObserver = new MutationObserver((mutations) => {
    if (
      mutations.every((mutation) => {
        const target = mutation.target;
        return target instanceof HTMLElement && target.closest(".overlay-scrollbar-thumb");
      })
    ) {
      return;
    }

    syncContentResizeObservers();
    requestUpdate();
  });

  syncContentResizeObservers();
  contentObserver.observe(host, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true
  });

  host.addEventListener("scroll", onScroll, { passive: true });
  host.addEventListener("pointerenter", requestUpdate);
  host.addEventListener("focusin", requestUpdate);
  requestUpdate();

  states.set(host, {
    cleanup: () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      contentResizeObserver.disconnect();
      contentObserver.disconnect();
      host.removeEventListener("scroll", onScroll);
      host.removeEventListener("pointerenter", requestUpdate);
      host.removeEventListener("focusin", requestUpdate);
      verticalThumb.remove();
      horizontalThumb.remove();
      host.removeAttribute(INITIALIZED_ATTR);
    }
  });
}

function setupExistingHosts(root: ParentNode) {
  if (root instanceof HTMLElement && root.matches(HOST_SELECTOR)) {
    setupHost(root);
  }

  root.querySelectorAll<HTMLElement>(HOST_SELECTOR).forEach(setupHost);
}

export function installOverlayScrollbars(root: ParentNode = document) {
  setupExistingHosts(root);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) setupExistingHosts(node);
        });
      }

      if (mutation.type === "attributes" && mutation.target instanceof HTMLElement) {
        setupExistingHosts(mutation.target);
      }
    }
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true
  });

  return () => {
    observer.disconnect();
    document.querySelectorAll<HTMLElement>(`[${INITIALIZED_ATTR}]`).forEach((host) => {
      states.get(host)?.cleanup();
      states.delete(host);
    });
  };
}
