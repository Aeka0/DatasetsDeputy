import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, ImageIcon, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { resolveAssetSrc } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import type { Annotation, DatasetImage } from "../../types";

const rowHeight = 120;
type CellKind = "annotation" | "instruction";

function createCellKey(imageId: number, kind: CellKind) {
  return `${imageId}:${kind}`;
}

function getAnnotationForProfile(image: DatasetImage, profileId: number) {
  return image.annotations.find((annotation) => annotation.profileId === profileId);
}

function getAnnotationText(image: DatasetImage, profileId: number) {
  const annotation = getAnnotationForProfile(image, profileId);
  if (annotation) {
    return annotation.content;
  }

  return "";
}

function getInstructionText(annotation: Annotation | undefined) {
  return annotation?.instruction ?? "";
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

export function DatasetTable({ images }: { images: DatasetImage[] }) {
  const { t } = useTranslation();
  const {
    profiles,
    activeProfileId,
    selectedImageId,
    tableDraftProfileId,
    tableAnnotationDrafts: annotationDrafts,
    tableInstructionDrafts: instructionDrafts,
    tableSavedCellKeys,
    selectImage,
    setActiveProfile,
    resetTableDrafts,
    mergeTableDrafts,
    updateTableAnnotationDraft,
    updateTableInstructionDraft,
    markTableCellSaved,
    saveAnnotation: persistAnnotation,
    saveInstruction
  } = useDatasetStore();
  const parentRef = useRef<HTMLDivElement>(null);
  const [instructionMode, setInstructionMode] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const availableProfileIds = useMemo(
    () => new Set(images.flatMap((image) => image.annotations.map((annotation) => annotation.profileId))),
    [images]
  );
  const availableProfiles = useMemo(
    () => profiles.filter((profile) => availableProfileIds.has(profile.id)),
    [availableProfileIds, profiles]
  );
  const selectedProfileId = availableProfiles.some((profile) => profile.id === activeProfileId)
    ? activeProfileId
    : availableProfiles[0]?.id;
  const selectedProfile = availableProfiles.find((profile) => profile.id === selectedProfileId);
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

    const close = () => setProfileMenuOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("click", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  const gridTemplateColumns = instructionMode
    ? "200px 140px minmax(360px, 1fr) 300px"
    : "200px 140px minmax(360px, 1fr)";

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

  const saveAnnotationDraft = async (image: DatasetImage) => {
    if (!selectedProfileId) return;
    const draft = annotationDrafts[image.id] ?? "";
    if (draft === getAnnotationText(image, selectedProfileId)) return;
    await persistAnnotation(image.id, selectedProfileId, draft);
    markTableCellSaved(createCellKey(image.id, "annotation"));
  };

  const saveInstructionDraft = async (image: DatasetImage) => {
    if (!selectedProfileId) return;
    const draft = instructionDrafts[image.id] ?? "";
    const annotation = getAnnotationForProfile(image, selectedProfileId);
    if (draft === getInstructionText(annotation)) return;
    await saveInstruction(image.id, selectedProfileId, draft);
    markTableCellSaved(createCellKey(image.id, "instruction"));
  };

  const saveDirtyCells = async () => {
    if (!selectedProfileId || dirtyCells.size === 0 || isSaving) return;

    setIsSaving(true);
    try {
      for (const image of images) {
        if (dirtyCells.has(createCellKey(image.id, "annotation"))) {
          await saveAnnotationDraft(image);
        }
        if (dirtyCells.has(createCellKey(image.id, "instruction"))) {
          await saveInstructionDraft(image);
        }
      }
    } finally {
      setIsSaving(false);
    }
  };

  const updateAnnotationDraft = (imageId: number, value: string) => {
    updateTableAnnotationDraft(imageId, value);
  };

  const updateInstructionDraft = (imageId: number, value: string) => {
    updateTableInstructionDraft(imageId, value);
  };

  const getCellStateClass = (imageId: number, kind: CellKind) => {
    const key = createCellKey(imageId, kind);
    if (dirtyCells.has(key)) {
      return "dataset-cell-dirty";
    }
    if (tableSavedCellKeys.includes(key)) {
      return "dataset-cell-saved";
    }
    return "";
  };

  if (images.length === 0 || availableProfiles.length === 0 || !selectedProfileId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-12 text-center">
        <ImageIcon size={44} className="mb-4 text-slate-300" />
        <h2 className="m-0 text-xl font-semibold text-slate-900">
          {images.length === 0 ? t("table.emptyTitle") : "No annotation type"}
        </h2>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          {images.length === 0
            ? t("table.emptyDescription")
            : "No annotation type exists yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-visible rounded-lg border border-slate-200 bg-white">
      <div className="flex h-10 items-center justify-between border-b border-slate-100 bg-slate-50 px-4">
        <div className="text-[13px] text-slate-500">
          {dirtyCells.size > 0
            ? t("table.unsavedCells", { count: dirtyCells.size })
            : t("table.ready")}
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
          <label className="no-drag flex items-center gap-2 text-[13px] text-slate-600">
            <input
              type="checkbox"
              checked={instructionMode}
              onChange={(event) => setInstructionMode(event.target.checked)}
            />
            <span>{t("table.instructionMode")}</span>
          </label>
        </div>
      </div>

      <div
        className="grid border-b border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-normal text-slate-600"
        style={{ gridTemplateColumns }}
      >
        <div className="px-2">{t("table.filename")}</div>
        <div className="px-2">{t("table.preview")}</div>
        <div className="relative px-2">
          <button
            className="no-drag flex max-w-full items-center gap-1.5 rounded px-1 text-left transition hover:bg-slate-200/70 hover:text-slate-900"
            onClick={(event) => {
              event.stopPropagation();
              setProfileMenuOpen((open) => !open);
            }}
          >
            <span>{t("table.annotationData")}</span>
            <span className="truncate text-slate-400">
              {selectedProfile ? `(${selectedProfile.name})` : ""}
            </span>
            <ChevronDown size={14} className="shrink-0 text-slate-400" />
          </button>

          {profileMenuOpen ? (
            <div
              className="no-drag absolute left-2 top-7 z-30 min-w-56 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
              onClick={(event) => event.stopPropagation()}
            >
              {availableProfiles.map((profile) => {
                const isSelectedProfile = profile.id === selectedProfileId;

                return (
                  <button
                    key={profile.id}
                    className={cn(
                      "flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px] transition hover:bg-slate-100",
                      isSelectedProfile ? "text-slate-950" : "text-slate-600"
                    )}
                    onClick={() => {
                      setActiveProfile(profile.id);
                      setProfileMenuOpen(false);
                    }}
                  >
                    <span className="flex w-4 shrink-0 justify-center">
                      {isSelectedProfile ? <Check size={14} /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {instructionMode ? <div className="px-2">{t("table.instruction")}</div> : null}
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const image = images[virtualRow.index];
            const isSelected = image.id === selectedImageId;

            return (
              <div
                key={image.id}
                className={cn(
                  "absolute left-0 grid w-full border-b border-slate-100 px-3 py-2 text-[13px] transition",
                  "hover:bg-slate-50",
                  isSelected && "bg-slate-100"
                )}
                style={{
                  gridTemplateColumns,
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                <button
                  className="no-drag min-w-0 px-2 text-left text-[13px] font-medium leading-5 text-slate-900"
                  onClick={() => selectImage(image.id)}
                  title={image.path}
                >
                  <span className="block truncate">{image.fileName}</span>
                </button>

                <button
                  className="no-drag flex items-center justify-center px-2"
                  onClick={() => selectImage(image.id)}
                >
                  <div className="flex h-[100px] w-[116px] items-center justify-center overflow-hidden bg-slate-100">
                    {image.thumbnailPath ? (
                      <img
                        src={resolveAssetSrc(image.thumbnailPath)}
                        alt=""
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-[13px] text-slate-400">
                        <ImageIcon size={22} />
                        <span>No Preview</span>
                      </div>
                    )}
                  </div>
                </button>

                <div className="px-2">
                  <textarea
                    value={annotationDrafts[image.id] ?? ""}
                    onChange={(event) => updateAnnotationDraft(image.id, event.target.value)}
                    className={cn(
                      "glass-input h-[100px] w-full resize-none rounded-md p-2 text-[13px] leading-5",
                      getCellStateClass(image.id, "annotation")
                    )}
                    spellCheck={false}
                  />
                </div>

                {instructionMode ? (
                  <div className="px-2">
                    <textarea
                      value={instructionDrafts[image.id] ?? ""}
                      onChange={(event) => updateInstructionDraft(image.id, event.target.value)}
                      className={cn(
                        "glass-input h-[100px] w-full resize-none rounded-md p-2 text-[13px] leading-5",
                        getCellStateClass(image.id, "instruction")
                      )}
                      spellCheck={false}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
