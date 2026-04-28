import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ImageIcon } from "lucide-react";
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { resolveAssetSrc } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetImage } from "../../types";
import { Badge } from "../ui/Badge";
import { GlassPanel } from "../ui/GlassPanel";

const columnHelper = createColumnHelper<DatasetImage>();

function formatBytes(value?: number) {
  if (!value) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function DatasetTable() {
  const { t } = useTranslation();
  const { images, search, selectedImageId, selectImage } = useDatasetStore();
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredImages = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return images;

    return images.filter((image) => {
      const haystack = [image.fileName, image.caption, ...image.tags].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [images, search]);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "preview",
        header: t("table.preview"),
        size: 88,
        cell: ({ row }) => (
          <div className="flex h-14 w-20 items-center justify-center overflow-hidden rounded-2xl bg-white/[0.06]">
            {row.original.thumbnailPath ? (
              <img
                src={resolveAssetSrc(row.original.thumbnailPath)}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <ImageIcon className="text-white/36" size={22} />
            )}
          </div>
        )
      }),
      columnHelper.accessor("fileName", {
        header: t("table.filename"),
        size: 220,
        cell: (info) => <span className="font-medium text-white/88">{info.getValue()}</span>
      }),
      columnHelper.display({
        id: "dimensions",
        header: t("table.dimensions"),
        size: 120,
        cell: ({ row }) =>
          row.original.width && row.original.height
            ? `${row.original.width} x ${row.original.height}`
            : "-"
      }),
      columnHelper.accessor("fileSize", {
        header: t("table.size"),
        size: 100,
        cell: (info) => formatBytes(info.getValue())
      }),
      columnHelper.accessor("tags", {
        header: t("table.tags"),
        size: 280,
        cell: (info) => (
          <div className="flex max-w-72 flex-wrap gap-1.5">
            {info
              .getValue()
              .slice(0, 4)
              .map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
          </div>
        )
      }),
      columnHelper.accessor("caption", {
        header: t("table.caption"),
        size: 380,
        cell: (info) => (
          <span className="line-clamp-2 text-white/58">{info.getValue() || "-"}</span>
        )
      })
    ],
    [t]
  );

  const table = useReactTable({
    data: filteredImages,
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 82,
    overscan: 8
  });

  if (filteredImages.length === 0) {
    return (
      <GlassPanel className="flex flex-1 flex-col items-center justify-center p-12 text-center">
        <ImageIcon size={44} className="mb-4 text-white/32" />
        <h2 className="m-0 text-xl font-semibold">{t("table.emptyTitle")}</h2>
        <p className="mt-2 max-w-md text-sm text-white/50">{t("table.emptyDescription")}</p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="min-h-0 flex-1 overflow-hidden">
      <div className="grid border-b border-white/10 bg-white/[0.035] px-4 py-3 text-xs uppercase tracking-[0.16em] text-white/38">
        {table.getHeaderGroups().map((headerGroup) => (
          <div key={headerGroup.id} className="flex">
            {headerGroup.headers.map((header) => (
              <div
                key={header.id}
                className="shrink-0 px-3"
                style={{ width: header.getSize() }}
              >
                {flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div ref={parentRef} className="h-full overflow-auto">
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const isSelected = row.original.id === selectedImageId;

            return (
              <button
                key={row.id}
                className={cn(
                  "absolute left-0 flex w-full items-center border-b border-white/[0.055] px-4 text-left text-sm text-white/68 transition",
                  "hover:bg-white/[0.06]",
                  isSelected && "bg-blue-400/[0.12] text-white"
                )}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`
                }}
                onClick={() => selectImage(row.original.id)}
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    className="shrink-0 px-3"
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </button>
            );
          })}
        </div>
      </div>
    </GlassPanel>
  );
}
