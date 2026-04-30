import { useVirtualizer } from "@tanstack/react-virtual";
import { Files, ImageIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { resolveAssetSrc } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetImage } from "../../types";

const copy = {
  annotationCount: "\u4efd\u6807\u6ce8"
};

const minCardWidth = 150;
const gridGap = 12;
const cardTextHeight = 52;

export function DatasetGrid({ images }: { images: DatasetImage[] }) {
  const selectImage = useDatasetStore((state) => state.selectImage);
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const datasetAnnotationTypeCount = useMemo(
    () =>
      new Set(images.flatMap((image) => image.annotations.map((annotation) => annotation.profileId)))
        .size,
    [images]
  );
  const columnCount = useMemo(() => {
    if (containerWidth <= 0) return 1;
    return Math.max(1, Math.floor((containerWidth + gridGap) / (minCardWidth + gridGap)));
  }, [containerWidth]);
  const cardWidth =
    containerWidth > 0
      ? (containerWidth - gridGap * (columnCount - 1)) / columnCount
      : minCardWidth;
  const rowHeight = cardWidth + cardTextHeight + gridGap;
  const rowCount = Math.ceil(images.length / columnCount);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 4
  });

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

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-y-scroll overflow-x-hidden px-1.5"
      style={{ scrollbarGutter: "stable" }}
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const rowStart = virtualRow.index * columnCount;
          const rowImages = images.slice(rowStart, rowStart + columnCount);

          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 grid w-full"
              style={{
                gap: `${gridGap}px`,
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                height: `${cardWidth + cardTextHeight}px`,
                transform: `translateY(${virtualRow.start}px)`
              }}
            >
              {rowImages.map((image) => (
                <button
                  key={image.id}
                  className="no-drag group min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 text-left transition hover:border-slate-300 hover:bg-slate-50"
                  onClick={() => selectImage(image.id)}
                >
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-slate-100">
                    {image.thumbnailPath ? (
                      <img
                        src={resolveAssetSrc(image.thumbnailPath)}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <ImageIcon size={30} className="text-slate-300" />
                    )}
                  </div>
                  <div className="px-1.5 pb-1.5 pt-2">
                    <div className="truncate text-[13px] text-slate-800">{image.fileName}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-slate-500">
                      <Files size={12} />
                      <span className="truncate">
                        {image.annotations.filter((annotation) => annotation.content.trim()).length}/
                        {datasetAnnotationTypeCount} {copy.annotationCount}
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
