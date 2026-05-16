import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleAlert, Files, ImageIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { resolveAssetSrc } from "../../lib/tauri";
import { cn } from "../../lib/cn";
import { highlightSearch } from "../../lib/SearchHighlight";
import { getLatestVisibleTableCellState } from "../../lib/tableCellState";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetImage } from "../../types";

const minCardWidth = 150;
const gridGap = 12;
const cardTextHeight = 52;

export function DatasetGrid({
  images,
  search,
  scrollResetKey,
  onImageContextMenu
}: {
  images: DatasetImage[];
  search?: string;
  scrollResetKey?: string;
  onImageContextMenu?: (image: DatasetImage, event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const {
    activeProfileId,
    tableDraftProfileId,
    tableAnnotationDrafts,
    tableSavedCellKeys,
    tableFailedCellKeys,
    tableLatestCellStates,
    highlightCellState,
    thumbnailCacheKey,
    openImagePreview,
    ensureThumbnails
  } = useDatasetStore(
    useShallow((state) => ({
      activeProfileId: state.activeProfileId,
      tableDraftProfileId: state.tableDraftProfileId,
      tableAnnotationDrafts: state.tableAnnotationDrafts,
      tableSavedCellKeys: state.tableSavedCellKeys,
      tableFailedCellKeys: state.tableFailedCellKeys,
      tableLatestCellStates: state.tableLatestCellStates,
      highlightCellState: state.highlightCellState,
      thumbnailCacheKey: state.thumbnailCacheKey,
      openImagePreview: state.openImagePreview,
      ensureThumbnails: state.ensureThumbnails
    }))
  );
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loadedPreviewKeys, setLoadedPreviewKeys] = useState<Set<string>>(new Set());
  const [failedPreviewKeys, setFailedPreviewKeys] = useState<Set<string>>(new Set());
  const profiles = useDatasetStore((state) => state.profiles);
  const datasetAnnotationTypeCount = useMemo(() => {
    const datasetIds = new Set(images.map((image) => image.datasetId).filter(Boolean));
    return profiles.filter((profile) => profile.datasetId !== undefined && datasetIds.has(profile.datasetId)).length;
  }, [images, profiles]);
  const isFolderMode = images.length > 0 && images.every((image) => image.sourceKind === "folder");
  const selectedProfileId = profiles.some((profile) => profile.id === activeProfileId)
    ? activeProfileId
    : profiles[0]?.id;
  const getAnnotationStateClass = (image: DatasetImage) => {
    if (!highlightCellState || selectedProfileId === undefined) return "";

    const key = `${image.id}:annotation`;
    const annotation = image.annotations.find(
      (item) => item.profileId === selectedProfileId
    );
    const hasDraft =
      tableDraftProfileId === selectedProfileId &&
      Object.prototype.hasOwnProperty.call(tableAnnotationDrafts, image.id);
    const draftContent = hasDraft ? tableAnnotationDrafts[image.id] ?? "" : "";
    const isDirty = hasDraft && draftContent !== (annotation?.content ?? "");

    const state = getLatestVisibleTableCellState({
      latestState: tableLatestCellStates[key],
      isDirty,
      isSaved: tableSavedCellKeys.includes(key),
      isFailed: tableFailedCellKeys.includes(key)
    });
    return state ? `dataset-grid-card-${state}` : "";
  };
  const columnCount = useMemo(() => {
    if (containerWidth <= 0) return 1;
    return Math.max(1, Math.floor((containerWidth + gridGap) / (minCardWidth + gridGap)));
  }, [containerWidth]);
  const cardWidth =
    containerWidth > 0
      ? Math.floor((containerWidth - gridGap * (columnCount - 1)) / columnCount)
      : minCardWidth;
  const rowHeight = cardWidth + cardTextHeight + gridGap;
  const issueIconSize = Math.max(28, Math.min(56, Math.round(cardWidth * 0.24)));
  const rowCount = Math.ceil(images.length / columnCount);
  const getPreviewLoadKey = (image: DatasetImage) =>
    `${image.id}:${image.thumbnailPath ?? ""}:${thumbnailCacheKey}`;
  const markPreviewLoaded = (image: DatasetImage) => {
    const key = getPreviewLoadKey(image);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setLoadedPreviewKeys((current) => {
          if (current.has(key)) return current;
          const next = new Set(current);
          next.add(key);
          return next;
        });
        setFailedPreviewKeys((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      });
    });
  };
  const markPreviewFailed = (image: DatasetImage) => {
    const key = getPreviewLoadKey(image);
    setFailedPreviewKeys((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  };
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 4
  });
  const virtualRows = virtualizer.getVirtualItems();
  const visibleImages = virtualRows.flatMap((virtualRow) => {
    const rowStart = virtualRow.index * columnCount;
    return images.slice(rowStart, rowStart + columnCount);
  });
  const missingVisibleIds = visibleImages
    .filter(
      (image) =>
        !image.sourceMissing &&
        (!image.thumbnailPath || failedPreviewKeys.has(getPreviewLoadKey(image)))
    )
    .map((image) => image.id);
  const missingVisibleIdsKey = missingVisibleIds.join(",");

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;

    const updateWidth = () => setContainerWidth(element.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    virtualizer.measure();
  }, [columnCount, rowHeight]);

  useLayoutEffect(() => {
    const element = parentRef.current;
    if (!element) return;

    element.scrollTop = 0;
    virtualizer.scrollToOffset(0);
  }, [scrollResetKey]);

  useEffect(() => {
    if (missingVisibleIds.length === 0) return;

    const timer = window.setTimeout(() => {
      void ensureThumbnails(missingVisibleIds);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [missingVisibleIdsKey, ensureThumbnails]);

  return (
    <div
      ref={parentRef}
      className="hover-scrollbar min-h-0 flex-1 overflow-y-scroll overflow-x-hidden px-1.5"
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualRows.map((virtualRow) => {
          const rowStart = virtualRow.index * columnCount;
          const rowImages = images.slice(rowStart, rowStart + columnCount);

          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 grid w-full"
              style={{
                gap: `${gridGap}px`,
                gridTemplateColumns: `repeat(${columnCount}, ${cardWidth}px)`,
                height: `${cardWidth + cardTextHeight}px`,
                transform: `translateY(${Math.round(virtualRow.start)}px)`
              }}
            >
              {rowImages.map((image) => (
                <button
                  key={image.id}
                  className={cn(
                    "no-drag group min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-1.5 text-left transition hover:border-neutral-300 hover:bg-neutral-50",
                    getAnnotationStateClass(image)
                  )}
                  onClick={() => openImagePreview(image.id)}
                  onContextMenu={(event) => onImageContextMenu?.(image, event)}
                >
                  <div className="dataset-preview-frame flex aspect-square items-center justify-center overflow-hidden rounded-md">
                    {image.sourceMissing ? (
                      <CircleAlert size={issueIconSize} className="text-red-600" />
                    ) : image.thumbnailPath && !failedPreviewKeys.has(getPreviewLoadKey(image)) ? (
                      <img
                        src={resolveAssetSrc(
                          image.thumbnailPath,
                          `${image.updatedAt}:${thumbnailCacheKey}`
                        )}
                        alt=""
                        className={cn(
                          "dataset-preview-image h-full w-full object-cover",
                          loadedPreviewKeys.has(getPreviewLoadKey(image)) &&
                            "dataset-preview-image-loaded"
                        )}
                        loading="lazy"
                        decoding="async"
                        onLoad={() => markPreviewLoaded(image)}
                        onError={() => markPreviewFailed(image)}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ImageIcon
                          size={30}
                          className="dataset-preview-placeholder-icon text-neutral-300"
                        />
                      </div>
                    )}
                  </div>
                  <div className="px-1.5 pb-1.5 pt-2">
                    <div className="truncate text-[13px] text-neutral-800">{highlightSearch(image.fileName, search ?? "")}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-neutral-500">
                      <Files size={12} />
                      <span className="truncate">
                        {isFolderMode
                          ? image.annotations.filter((annotation) => annotation.content.trim()).length
                          : `${image.annotations.filter((annotation) => annotation.content.trim()).length}/${datasetAnnotationTypeCount}`}{" "}
                        {t("grid.annotationCount")}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
