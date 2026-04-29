import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, ImageIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { resolveAssetSrc } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import type { Annotation, DatasetImage } from "../../types";

const rowHeight = 120;

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

function profileHasContent(images: DatasetImage[], profileId: number) {
  return images.some((image) => getAnnotationText(image, profileId).trim());
}

export function DatasetTable({ images }: { images: DatasetImage[] }) {
  const { t } = useTranslation();
  const {
    profiles,
    activeProfileId,
    selectedImageId,
    selectImage,
    setActiveProfile,
    saveAnnotation: persistAnnotation,
    saveInstruction
  } = useDatasetStore();
  const parentRef = useRef<HTMLDivElement>(null);
  const [instructionMode, setInstructionMode] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const selectedProfileId = profiles.some((profile) => profile.id === activeProfileId)
    ? activeProfileId
    : profiles[0]?.id;
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const [annotationDrafts, setAnnotationDrafts] = useState<Record<number, string>>(() =>
    selectedProfileId ? createAnnotationDraftMap(images, selectedProfileId) : {}
  );
  const [instructionDrafts, setInstructionDrafts] = useState<Record<number, string>>(() =>
    selectedProfileId ? createInstructionDraftMap(images, selectedProfileId) : {}
  );

  useEffect(() => {
    if (!selectedProfileId) return;
    setAnnotationDrafts(createAnnotationDraftMap(images, selectedProfileId));
    setInstructionDrafts(createInstructionDraftMap(images, selectedProfileId));
  }, [images, selectedProfileId]);

  useEffect(() => {
    if (profiles.length === 0 || images.length === 0) return;
    if (selectedProfileId && profileHasContent(images, selectedProfileId)) return;

    const firstProfileWithContent = profiles.find((profile) =>
      profileHasContent(images, profile.id)
    );
    if (firstProfileWithContent && firstProfileWithContent.id !== selectedProfileId) {
      setActiveProfile(firstProfileWithContent.id);
    }
  }, [profiles, images, selectedProfileId, setActiveProfile]);

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

  const dirtyIds = useMemo(
    () => {
      if (!selectedProfileId) return new Set<number>();

      return new Set(
        images
          .filter((image) => {
            const annotation = getAnnotationForProfile(image, selectedProfileId);
            const contentDirty =
              (annotationDrafts[image.id] ?? "") !== getAnnotationText(image, selectedProfileId);
            const instructionDirty =
              (instructionDrafts[image.id] ?? "") !== getInstructionText(annotation);

            return contentDirty || instructionDirty;
          })
          .map((image) => image.id)
      );
    },
    [annotationDrafts, images, instructionDrafts, selectedProfileId]
  );

  const saveAnnotationDraft = (image: DatasetImage) => {
    if (!selectedProfileId) return;
    const draft = annotationDrafts[image.id] ?? "";
    if (draft === getAnnotationText(image, selectedProfileId)) return;
    void persistAnnotation(image.id, selectedProfileId, draft);
  };

  const saveInstructionDraft = (image: DatasetImage) => {
    if (!selectedProfileId) return;
    const draft = instructionDrafts[image.id] ?? "";
    const annotation = getAnnotationForProfile(image, selectedProfileId);
    if (draft === getInstructionText(annotation)) return;
    void saveInstruction(image.id, selectedProfileId, draft);
  };

  if (images.length === 0 || profiles.length === 0 || !selectedProfileId) {
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
          {dirtyIds.size > 0 ? `${dirtyIds.size} \u884c\u5c1a\u672a\u5931\u7126\u4fdd\u5b58` : "\u5c31\u7eea"}
        </div>
        <label className="no-drag flex items-center gap-2 text-[13px] text-slate-600">
          <input
            type="checkbox"
            checked={instructionMode}
            onChange={(event) => setInstructionMode(event.target.checked)}
          />
          <span>Instruction Mode</span>
        </label>
      </div>

      <div
        className="grid border-b border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-semibold text-slate-600"
        style={{ gridTemplateColumns }}
      >
        <div className="px-2">Filename</div>
        <div className="px-2">Preview</div>
        <div className="relative px-2">
          <button
            className="no-drag flex max-w-full items-center gap-1.5 rounded px-1 text-left transition hover:bg-slate-200/70 hover:text-slate-900"
            onClick={(event) => {
              event.stopPropagation();
              setProfileMenuOpen((open) => !open);
            }}
          >
            <span>Annotation Data</span>
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
              {profiles.map((profile) => {
                const isSelectedProfile = profile.id === selectedProfileId;
                const hasContent = profileHasContent(images, profile.id);

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
                    {hasContent ? (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[12px] font-normal text-slate-500">
                        data
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {instructionMode ? <div className="px-2">Instruction</div> : null}
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const image = images[virtualRow.index];
            const isSelected = image.id === selectedImageId;
            const isDirty = dirtyIds.has(image.id);

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
                  className={cn(
                    "no-drag min-w-0 px-2 text-left text-[13px] font-medium leading-5",
                    isDirty ? "text-amber-700" : "text-slate-900"
                  )}
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
                    onChange={(event) =>
                      setAnnotationDrafts((current) => ({
                        ...current,
                        [image.id]: event.target.value
                      }))
                    }
                    onBlur={() => saveAnnotationDraft(image)}
                    className={cn(
                      "glass-input h-[100px] w-full resize-none rounded-md p-2 text-[13px] leading-5",
                      isDirty && "border-amber-300 bg-amber-50"
                    )}
                    spellCheck={false}
                  />
                </div>

                {instructionMode ? (
                  <div className="px-2">
                    <textarea
                      value={instructionDrafts[image.id] ?? ""}
                      onChange={(event) =>
                        setInstructionDrafts((current) => ({
                          ...current,
                          [image.id]: event.target.value
                        }))
                      }
                      className="glass-input h-[100px] w-full resize-none rounded-md p-2 text-[13px] leading-5"
                      placeholder=".inst.txt"
                      onBlur={() => saveInstructionDraft(image)}
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
