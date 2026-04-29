import { Files, ImageIcon } from "lucide-react";

import { resolveAssetSrc } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetImage } from "../../types";

const copy = {
  annotationCount: "\u4efd\u6807\u6ce8"
};

export function DatasetGrid({ images }: { images: DatasetImage[] }) {
  const selectImage = useDatasetStore((state) => state.selectImage);
  const datasetAnnotationTypeCount = new Set(
    images.flatMap((image) => image.annotations.map((annotation) => annotation.profileId))
  ).size;

  return (
    <div className="min-h-0 flex-1 overflow-auto px-1.5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 pb-4">
        {images.map((image) => (
          <button
            key={image.id}
            className="no-drag group overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 text-left transition hover:border-slate-300 hover:bg-slate-50"
            onClick={() => selectImage(image.id)}
          >
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-slate-100">
              {image.thumbnailPath ? (
                <img
                  src={resolveAssetSrc(image.thumbnailPath)}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
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
    </div>
  );
}
