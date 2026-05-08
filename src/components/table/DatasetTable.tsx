import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, CircleAlert, ImageIcon, LoaderCircle, Plus, Save } from "lucide-react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { getAnnotationForProfile, getAnnotationText, getInstructionText } from "../../lib/annotations";
import { cn } from "../../lib/cn";
import { getUnsavedTableDraftState } from "../../lib/tableDrafts";
import { resolveAssetSrc } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import type { AnnotationChange, AnnotationProfile, DatasetImage } from "../../types";

const rowHeight = 120;
type CellKind = "annotation" | "instruction";
type TableColumnKey = "filename" | "preview" | "annotation" | "instruction";

const defaultColumnWidths: Record<TableColumnKey, number> = {
  filename: 200,
  preview: 140,
  annotation: 520,
  instruction: 300
};

const minColumnWidths: Record<TableColumnKey, number> = {
  filename: 120,
  preview: 120,
  annotation: 240,
  instruction: 220
};

function createCellKey(imageId: number, kind: CellKind) {
  return `${imageId}:${kind}`;
}

function loadColumnWidths() {
  try {
    const raw = window.localStorage.getItem("datasets-deputy:table-column-widths");
    if (!raw) return defaultColumnWidths;
    const parsed = JSON.parse(raw) as Partial<Record<TableColumnKey, number>>;
    return {
      filename: Math.max(parsed.filename ?? defaultColumnWidths.filename, minColumnWidths.filename),
      preview: Math.max(parsed.preview ?? defaultColumnWidths.preview, minColumnWidths.preview),
      annotation: Math.max(
        parsed.annotation ?? defaultColumnWidths.annotation,
        minColumnWidths.annotation
      ),
      instruction: Math.max(
        parsed.instruction ?? defaultColumnWidths.instruction,
        minColumnWidths.instruction
      )
    };
  } catch {
    return defaultColumnWidths;
  }
}

function createAnnotationDraftMap(images: DatasetImage[], profileId: number) {
  return Object.fromEntries(images.map((image) => [image.id, getAnnotationText(image, profileId)]));
}

function createInstructionDraftMap(images: DatasetImage[], profileId: number) {
  return Object.fromEntries(
    images.map((image) => [
      image.id,
      getInstructionText(getAnnotationForProfile(image, profileId))
    ])
  );
}

export function DatasetTable({
  images,
  profiles,
  onImageContextMenu
}: {
  images: DatasetImage[];
  profiles: AnnotationProfile[];
  onImageContextMenu?: (image: DatasetImage, event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const {
    activeProfileId,
    selectedImageId,
    selectedImageIds,
    selectionAnchorImageId,
    tableDraftProfileId,
    tableAnnotationDrafts: annotationDrafts,
    tableInstructionDrafts: instructionDrafts,
    tableProfileAnnotationDrafts,
    tableProfileInstructionDrafts,
    tableSavedCellKeys,
    tableFailedCellKeys,
    annotatingImageIds,
    highlightCellState,
    selectImage,
    setImageSelection,
    toggleImageSelection,
    openImagePreview,
    setActiveProfile,
    resetTableDrafts,
    mergeTableDrafts,
    updateTableAnnotationDraft,
    updateTableInstructionDraft,
    markTableCellSaved,
    createAnnotationProfile,
    saveAnnotationChanges
  } = useDatasetStore();
  const parentRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const cellTextareaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileMenuPosition, setProfileMenuPosition] = useState({ left: 0, top: 0 });
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [createProfileError, setCreateProfileError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [columnWidths, setColumnWidths] = useState(loadColumnWidths);
  const isFolderMode = images.length > 0 && images.every((image) => image.sourceKind === "folder");
  const selectedImageIdSet = useMemo(() => new Set(selectedImageIds), [selectedImageIds]);
  const selectedProfileId = profiles.some((profile) => profile.id === activeProfileId)
    ? activeProfileId
    : profiles[0]?.id;
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  useEffect(() => {
    if (!selectedProfileId) return;

    const nextAnnotationDrafts = createAnnotationDraftMap(images, selectedProfileId);
    const nextInstructionDrafts = createInstructionDraftMap(images, selectedProfileId);

    if (tableDraftProfileId !== selectedProfileId) {
      resetTableDrafts(selectedProfileId, nextAnnotationDrafts, nextInstructionDrafts);
      return;
    }

    mergeTableDrafts(nextAnnotationDrafts, nextInstructionDrafts);
  }, [
    images,
    mergeTableDrafts,
    resetTableDrafts,
    selectedProfileId,
    tableDraftProfileId
  ]);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const close = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        (profileMenuRef.current?.contains(event.target) ||
          profileButtonRef.current?.contains(event.target))
      ) {
        return;
      }
      setProfileMenuOpen(false);
      setIsCreatingProfile(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
        setIsCreatingProfile(false);
      }
    };

    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    window.localStorage.setItem(
      "datasets-deputy:table-column-widths",
      JSON.stringify(columnWidths)
    );
  }, [columnWidths]);

  const resizeColumn = (column: TableColumnKey, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[column];

    const move = (moveEvent: PointerEvent) => {
      const nextWidth = Math.max(
        minColumnWidths[column],
        Math.round(startWidth + moveEvent.clientX - startX)
      );
      setColumnWidths((current) => ({ ...current, [column]: nextWidth }));
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("table-column-resizing");
    };

    document.body.classList.add("table-column-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  const syncHeaderScroll = () => {
    if (headerScrollRef.current && parentRef.current) {
      headerScrollRef.current.scrollLeft = parentRef.current.scrollLeft;
    }
  };

  const selectTableImage = (imageId: number, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();

    if (event.shiftKey) {
      const anchorId = selectionAnchorImageId ?? selectedImageId ?? imageId;
      const anchorIndex = images.findIndex((image) => image.id === anchorId);
      const targetIndex = images.findIndex((image) => image.id === imageId);

      if (anchorIndex === -1 || targetIndex === -1) {
        selectImage(imageId);
        return;
      }

      const [startIndex, endIndex] =
        anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      const rangeIds = images.slice(startIndex, endIndex + 1).map((image) => image.id);
      const nextIds =
        event.ctrlKey || event.metaKey
          ? Array.from(new Set([...selectedImageIds, ...rangeIds]))
          : rangeIds;

      setImageSelection(nextIds, imageId, anchorId);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      toggleImageSelection(imageId);
      return;
    }

    selectImage(imageId);
  };

  const gridTemplateColumns = `${columnWidths.filename}px ${columnWidths.preview}px ${columnWidths.annotation}px ${columnWidths.instruction}px`;
  const tableWidth =
    columnWidths.filename + columnWidths.preview + columnWidths.annotation + columnWidths.instruction;

  const virtualizer = useVirtualizer({
    count: images.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8
  });

  const dirtyCells = useMemo(
    () => {
      if (!selectedProfileId) return new Set<string>();

      const next = new Set<string>();
      for (const image of images) {
        const annotation = getAnnotationForProfile(image, selectedProfileId);
        const contentDirty =
          (annotationDrafts[image.id] ?? "") !== getAnnotationText(image, selectedProfileId);
        const instructionDirty =
          (instructionDrafts[image.id] ?? "") !== getInstructionText(annotation);

        if (contentDirty) {
          next.add(createCellKey(image.id, "annotation"));
        }
        if (instructionDirty) {
          next.add(createCellKey(image.id, "instruction"));
        }
      }
      return next;
    },
    [annotationDrafts, images, instructionDrafts, selectedProfileId]
  );
  const unsavedDraftState = useMemo(
    () =>
      getUnsavedTableDraftState({
        images,
        tableDraftProfileId,
        tableAnnotationDrafts: annotationDrafts,
        tableInstructionDrafts: instructionDrafts,
        tableProfileAnnotationDrafts,
        tableProfileInstructionDrafts
      }),
    [
      annotationDrafts,
      images,
      instructionDrafts,
      tableDraftProfileId,
      tableProfileAnnotationDrafts,
      tableProfileInstructionDrafts
    ]
  );
  const otherUnsavedCellCount = Object.entries(unsavedDraftState.cellsByProfileId).reduce(
    (count, [profileId, cellCount]) =>
      Number(profileId) === selectedProfileId ? count : count + cellCount,
    0
  );
  const otherUnsavedProfileCount = Object.keys(unsavedDraftState.cellsByProfileId).filter(
    (profileId) => Number(profileId) !== selectedProfileId
  ).length;
  const unsavedStatus =
    dirtyCells.size > 0 && otherUnsavedCellCount > 0
      ? t("table.unsavedCellsWithOther", {
          count: dirtyCells.size,
          otherCount: otherUnsavedCellCount,
          profileCount: otherUnsavedProfileCount
        })
      : dirtyCells.size > 0
      ? t("table.unsavedCells", { count: dirtyCells.size })
      : otherUnsavedCellCount > 0
      ? t("table.otherUnsavedCells", {
          count: otherUnsavedCellCount,
          profileCount: otherUnsavedProfileCount
        })
      : t("table.ready");

  const saveDraftsForImages = async (targetImages: DatasetImage[]) => {
    if (!selectedProfileId) return;

    const changes: AnnotationChange[] = [];
    const savedCellKeys: string[] = [];
    for (const image of targetImages) {
      const annotationKey = createCellKey(image.id, "annotation");
      const instructionKey = createCellKey(image.id, "instruction");
      const change: AnnotationChange = {
        imageId: image.id,
        profileId: selectedProfileId
      };

      if (dirtyCells.has(annotationKey)) {
        change.content = annotationDrafts[image.id] ?? "";
        savedCellKeys.push(annotationKey);
      }
      if (dirtyCells.has(instructionKey)) {
        change.instruction = instructionDrafts[image.id] ?? "";
        savedCellKeys.push(instructionKey);
      }
      if (change.content !== undefined || change.instruction !== undefined) {
        changes.push(change);
      }
    }

    if (changes.length === 0) return;

    await saveAnnotationChanges(changes);
    for (const key of savedCellKeys) {
      markTableCellSaved(key);
    }
  };

  const saveDirtyCells = async () => {
    if (!selectedProfileId || dirtyCells.size === 0 || isSaving) return;

    setIsSaving(true);
    try {
      await saveDraftsForImages(images);
    } finally {
      setIsSaving(false);
    }
  };

  const saveCurrentImageDirtyCells = async () => {
    if (!selectedProfileId || selectedImageId === undefined || isSaving) return;
    const image = images.find((item) => item.id === selectedImageId);
    if (!image) return;
    const annotationKey = createCellKey(image.id, "annotation");
    const instructionKey = createCellKey(image.id, "instruction");
    if (!dirtyCells.has(annotationKey) && !dirtyCells.has(instructionKey)) return;

    setIsSaving(true);
    try {
      await saveDraftsForImages([image]);
    } finally {
      setIsSaving(false);
    }
  };

  const saveImageDirtyCells = async (image: DatasetImage) => {
    if (!selectedProfileId || isSaving) return;
    const annotationKey = createCellKey(image.id, "annotation");
    const instructionKey = createCellKey(image.id, "instruction");
    if (!dirtyCells.has(annotationKey) && !dirtyCells.has(instructionKey)) return;

    setIsSaving(true);
    try {
      await saveDraftsForImages([image]);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const saveWithKeyboard = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      event.stopPropagation();

      if (event.shiftKey) {
        void saveDirtyCells();
      } else {
        void saveCurrentImageDirtyCells();
      }
    };

    window.addEventListener("keydown", saveWithKeyboard);
    return () => window.removeEventListener("keydown", saveWithKeyboard);
  });

  const trimmedNewProfileName = newProfileName.trim();
  const normalizedNewProfileName = trimmedNewProfileName.toLocaleLowerCase();
  const targetDatasetId = images[0]?.datasetId;
  const newProfileNameExists = profiles.some(
    (profile) =>
      profile.datasetId === targetDatasetId &&
      profile.name.trim().toLocaleLowerCase() === normalizedNewProfileName
  );
  const newProfileError = newProfileNameExists
    ? t("image.profileNameExists")
    : createProfileError;

  const startCreatingProfile = () => {
    setIsCreatingProfile(true);
    setNewProfileName("");
    setCreateProfileError("");
  };

  const createProfile = async () => {
    if (!trimmedNewProfileName || newProfileNameExists) return;

    try {
      const profileId = await createAnnotationProfile(trimmedNewProfileName);
      if (!profileId) return;

      setActiveProfile(profileId);
      setProfileMenuOpen(false);
      setIsCreatingProfile(false);
      setNewProfileName("");
      setCreateProfileError("");
    } catch (error) {
      setCreateProfileError(error instanceof Error ? error.message : t("image.createTypeFailed"));
    }
  };

  const focusCellTextarea = (imageId: number, kind: CellKind) => {
    const key = createCellKey(imageId, kind);
    const focus = () => {
      const textarea = cellTextareaRefs.current.get(key);
      if (!textarea) return false;

      textarea.focus();
      textarea.select();
      return true;
    };

    if (focus()) return;

    window.requestAnimationFrame(() => {
      if (focus()) return;
      window.requestAnimationFrame(focus);
    });
  };

  const moveFocusToAdjacentRow = (
    imageId: number,
    kind: CellKind,
    event: ReactKeyboardEvent<HTMLTextAreaElement>
  ) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      event.stopPropagation();

      if (event.shiftKey) {
        void saveDirtyCells();
        return;
      }

      const image = images.find((item) => item.id === imageId);
      if (image) {
        void saveImageDirtyCells(image);
      }
      return;
    }

    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;

    const currentIndex = images.findIndex((image) => image.id === imageId);
    if (currentIndex === -1) return;

    const nextIndex = event.shiftKey ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= images.length) return;

    event.preventDefault();
    event.stopPropagation();

    const nextImage = images[nextIndex];
    virtualizer.scrollToIndex(nextIndex, { align: "auto" });
    focusCellTextarea(nextImage.id, kind);
  };

  const getCellStateClass = (imageId: number, kind: CellKind) => {
    if (!highlightCellState) {
      return "";
    }

    const key = createCellKey(imageId, kind);
    if (dirtyCells.has(key)) {
      return "dataset-cell-dirty";
    }
    if (tableSavedCellKeys.includes(key)) {
      return "dataset-cell-saved";
    }
    if (tableFailedCellKeys.includes(key)) {
      return "dataset-cell-failed";
    }
    return "";
  };

  const renderResizeHandle = (column: TableColumnKey) => (
    <div
      className="table-column-resizer no-drag absolute right-0 top-0 h-full w-2 cursor-col-resize"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(event) => resizeColumn(column, event)}
    />
  );

  if (images.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-12 text-center">
        <ImageIcon size={44} className="mb-4 text-slate-300" />
        <h2 className="m-0 text-xl font-semibold text-slate-900">{t("table.emptyTitle")}</h2>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          {t("table.emptyDescription")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-visible rounded-lg border border-slate-200 bg-white">
      <div className="flex h-10 items-center justify-between border-b border-slate-100 bg-slate-50 px-4">
        <div className="text-[13px] text-slate-500">
          {unsavedStatus}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="no-drag flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={dirtyCells.size === 0 || isSaving}
            onClick={() => void saveDirtyCells()}
          >
            <Save size={14} />
            <span>{isSaving ? t("table.saving") : t("table.saveChanges")}</span>
          </button>
        </div>
      </div>

      <div ref={headerScrollRef} className="overflow-hidden border-b border-slate-200 bg-slate-50">
        <div
          className="grid min-w-full px-3 py-2 text-[13px] font-normal text-slate-600"
          style={{ gridTemplateColumns, width: `${tableWidth}px` }}
        >
          <div className="relative px-2">
            {t("table.filename")}
            {renderResizeHandle("filename")}
          </div>
          <div className="relative px-2">
            {t("table.preview")}
            {renderResizeHandle("preview")}
          </div>
          <div className="relative px-2">
            {isFolderMode ? (
              <div className="px-1">{t("table.annotationData")}</div>
            ) : (
              <button
                ref={profileButtonRef}
                className="no-drag flex max-w-full items-center gap-1.5 rounded px-1 text-left transition hover:bg-slate-200/70 hover:text-slate-900"
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setProfileMenuPosition({
                    left: Math.min(rect.left, window.innerWidth - 232),
                    top: rect.bottom + 6
                  });
                  setProfileMenuOpen((open) => !open);
                  setIsCreatingProfile(false);
                }}
              >
                <span>{t("table.annotationData")}</span>
                <span className="truncate text-slate-400">
                  {selectedProfile ? `(${selectedProfile.name})` : ""}
                </span>
                <ChevronDown size={14} className="shrink-0 text-slate-400" />
              </button>
            )}

            {renderResizeHandle("annotation")}
          </div>
          <div className="relative px-2">
            {t("table.instruction")}
            {renderResizeHandle("instruction")}
          </div>
        </div>
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" onScroll={syncHeaderScroll}>
        <div
          className="relative min-w-full"
          style={{ height: `${virtualizer.getTotalSize()}px`, width: `${tableWidth}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const image = images[virtualRow.index];
            const isSelected = selectedImageIdSet.has(image.id);
            const isAnnotating = annotatingImageIds.includes(image.id);

            return (
              <div
                key={image.id}
                className={cn(
                  "absolute left-0 grid w-full border-b border-slate-100 px-3 py-2 text-[13px] transition",
                  isSelected ? "dataset-table-row-selected" : "hover:bg-slate-50"
                )}
                aria-selected={isSelected}
                style={{
                  gridTemplateColumns,
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`
                }}
                onContextMenu={(event) => onImageContextMenu?.(image, event)}
              >
                <button
                  className="no-drag min-w-0 px-2 text-left text-[13px] font-medium leading-5 text-slate-900"
                  onClick={(event) => selectTableImage(image.id, event)}
                  title={image.path}
                >
                  <span className="block truncate">{image.fileName}</span>
                </button>

                <button
                  className="no-drag flex items-center justify-center px-2"
                  onClick={() => openImagePreview(image.id)}
                >
                  <div className="flex h-[100px] w-[116px] items-center justify-center overflow-hidden bg-slate-100">
                    {image.sourceMissing ? (
                      <CircleAlert size={34} className="text-red-600" />
                    ) : image.thumbnailPath ? (
                      <img
                        src={resolveAssetSrc(image.thumbnailPath)}
                        alt=""
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-[13px] text-slate-400">
                        <ImageIcon size={22} />
                        <span>{t("table.noPreview")}</span>
                      </div>
                    )}
                  </div>
                </button>

                <div className="relative px-2">
                  <textarea
                    ref={(node) => {
                      const key = createCellKey(image.id, "annotation");
                      if (node) {
                        cellTextareaRefs.current.set(key, node);
                      } else {
                        cellTextareaRefs.current.delete(key);
                      }
                    }}
                    value={selectedProfileId ? (annotationDrafts[image.id] ?? "") : ""}
                    onChange={(event) => updateTableAnnotationDraft(image.id, event.target.value)}
                    onKeyDown={(event) => moveFocusToAdjacentRow(image.id, "annotation", event)}
                    className={cn(
                      "glass-input h-[100px] w-full resize-none rounded-md p-2 text-[13px] leading-5 disabled:cursor-wait disabled:opacity-80",
                      getCellStateClass(image.id, "annotation")
                    )}
                    disabled={!selectedProfileId || isAnnotating}
                    spellCheck={false}
                  />
                  {isAnnotating ? (
                    <div className="pointer-events-none absolute right-4 top-3">
                      <LoaderCircle className="h-5 w-5 animate-spin text-slate-500" />
                    </div>
                  ) : null}
                </div>

                <div className="px-2">
                  <textarea
                    ref={(node) => {
                      const key = createCellKey(image.id, "instruction");
                      if (node) {
                        cellTextareaRefs.current.set(key, node);
                      } else {
                        cellTextareaRefs.current.delete(key);
                      }
                    }}
                    value={selectedProfileId ? (instructionDrafts[image.id] ?? "") : ""}
                    onChange={(event) => updateTableInstructionDraft(image.id, event.target.value)}
                    onKeyDown={(event) => moveFocusToAdjacentRow(image.id, "instruction", event)}
                    className={cn(
                      "glass-input h-[100px] w-full resize-none rounded-md p-2 text-[13px] leading-5",
                      getCellStateClass(image.id, "instruction")
                    )}
                    disabled={!selectedProfileId}
                    spellCheck={false}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {profileMenuOpen && !isFolderMode
        ? createPortal(
        <div
          ref={profileMenuRef}
          className="app-dropdown-menu no-drag fixed z-50 min-w-56 rounded-lg py-2"
          style={{ left: profileMenuPosition.left, top: profileMenuPosition.top }}
        >
          <div className="app-dropdown-backdrop" />
          {profiles.map((profile) => {
            const isSelectedProfile = profile.id === selectedProfileId;

            return (
              <button
                key={profile.id}
                className={cn(
                  "app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium transition hover:bg-slate-100",
                  isSelectedProfile ? "text-slate-950" : "text-slate-600"
                )}
                onClick={() => {
                  setActiveProfile(profile.id);
                  setProfileMenuOpen(false);
                  setIsCreatingProfile(false);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {isSelectedProfile ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{profile.name}</span>
              </button>
            );
          })}
          <div className="my-1 border-t border-slate-100" />
          {isCreatingProfile ? (
            <div className="px-3 py-2">
              <label className="mb-1 block text-[12px] font-medium text-slate-600">
                {t("image.newTypeName")}
              </label>
              <input
                value={newProfileName}
                onChange={(event) => {
                  setNewProfileName(event.target.value);
                  setCreateProfileError("");
                }}
                className="glass-input h-8 w-full px-2 text-[13px]"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createProfile();
                  }
                }}
              />
              {newProfileError ? (
                <div className="mt-1 text-[12px] text-red-600">{newProfileError}</div>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  className="no-drag inline-flex h-8 flex-1 items-center justify-center rounded-md border border-slate-900 bg-slate-900 px-2 text-[12px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void createProfile()}
                  disabled={!trimmedNewProfileName || newProfileNameExists}
                >
                  {t("image.createType")}
                </button>
                <button
                  className="no-drag inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-600 transition hover:bg-slate-50"
                  onClick={() => setIsCreatingProfile(false)}
                >
                  {t("actions.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium text-slate-600 transition hover:bg-slate-100"
              onClick={startCreatingProfile}
            >
              <span className="flex w-4 shrink-0 justify-center">
                <Plus size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate">{t("image.newAnnotation")}</span>
            </button>
          )}
        </div>,
          document.body
        )
        : null}
    </div>
  );
}
