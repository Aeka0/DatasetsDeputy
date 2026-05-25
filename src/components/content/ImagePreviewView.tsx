import { ArrowLeft, Check, CircleAlert, Copy, FileText, LoaderCircle, Plus, Save } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { formatAppError } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import { resolveAssetSrc } from "../../lib/tauri";
import { getTableDraftProfileMaps } from "../../lib/tableDrafts";
import { useDatasetStore } from "../../stores/datasetStore";
import type { AnnotationProfile } from "../../types";

type DraftTab = "annotation" | "instruction";
type ImageDimensions = { imageId: number; width: number; height: number };

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy failed");
    }
  } finally {
    textArea.remove();
  }
}

export function ImagePreviewView() {
  const { t } = useTranslation();
  const {
    images,
    profiles,
    previewImageId,
    activeProfileId,
    tableDraftProfileId,
    tableAnnotationDrafts,
    tableInstructionDrafts,
    tableProfileAnnotationDrafts,
    tableProfileInstructionDrafts,
    annotatingImageIds,
    thumbnailCacheKey,
    closeImagePreview,
    setActiveProfile,
    saveAnnotation,
    saveInstruction,
    createAnnotationProfile,
    applyTableDraft,
    addAppLog
  } = useDatasetStore(
    useShallow((state) => ({
      images: state.images,
      profiles: state.profiles,
      previewImageId: state.previewImageId,
      activeProfileId: state.activeProfileId,
      tableDraftProfileId: state.tableDraftProfileId,
      tableAnnotationDrafts: state.tableAnnotationDrafts,
      tableInstructionDrafts: state.tableInstructionDrafts,
      tableProfileAnnotationDrafts: state.tableProfileAnnotationDrafts,
      tableProfileInstructionDrafts: state.tableProfileInstructionDrafts,
      annotatingImageIds: state.annotatingImageIds,
      thumbnailCacheKey: state.thumbnailCacheKey,
      closeImagePreview: state.closeImagePreview,
      setActiveProfile: state.setActiveProfile,
      saveAnnotation: state.saveAnnotation,
      saveInstruction: state.saveInstruction,
      createAnnotationProfile: state.createAnnotationProfile,
      applyTableDraft: state.applyTableDraft,
      addAppLog: state.addAppLog
    }))
  );
  const selectedImage = useMemo(
    () => images.find((image) => image.id === previewImageId),
    [images, previewImageId]
  );
  const [selectedProfileId, setSelectedProfileId] = useState<number>();
  const [content, setContent] = useState("");
  const [instruction, setInstruction] = useState("");
  const [activeDraftTab, setActiveDraftTab] = useState<DraftTab>("annotation");
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [createProfileError, setCreateProfileError] = useState("");
  const [pendingProfileId, setPendingProfileId] = useState<number>();
  const [loadedDimensions, setLoadedDimensions] = useState<ImageDimensions>();
  const [copiedDraftTab, setCopiedDraftTab] = useState<DraftTab>();
  const clearCopyFeedbackTimerRef = useRef<number | undefined>(undefined);

  const availableProfiles = useMemo(() => {
    if (!selectedImage?.datasetId) return [];

    const matchedProfiles = profiles.filter(
      (profile) => profile.datasetId === selectedImage.datasetId
    );
    const matchedProfileIds = new Set(matchedProfiles.map((profile) => profile.id));
    const inferredProfiles: AnnotationProfile[] = selectedImage.annotations
      .filter((annotation) => !matchedProfileIds.has(annotation.profileId))
      .map((annotation) => ({
        id: annotation.profileId,
        name: `#${annotation.profileId}`,
        datasetId: selectedImage.datasetId,
        sourceKind: selectedImage.sourceKind
      }));

    return [...matchedProfiles, ...inferredProfiles];
  }, [profiles, selectedImage]);
  const selectedAnnotation = useMemo(
    () =>
      selectedProfileId === undefined
        ? undefined
        : selectedImage?.annotations.find((annotation) => annotation.profileId === selectedProfileId),
    [selectedProfileId, selectedImage]
  );
  const { annotationDraftsByProfile, instructionDraftsByProfile } = useMemo(
    () =>
      getTableDraftProfileMaps({
        tableDraftProfileId,
        tableAnnotationDrafts,
        tableInstructionDrafts,
        tableProfileAnnotationDrafts,
        tableProfileInstructionDrafts
      }),
    [
      tableAnnotationDrafts,
      tableDraftProfileId,
      tableInstructionDrafts,
      tableProfileAnnotationDrafts,
      tableProfileInstructionDrafts
    ]
  );

  useEffect(() => {
    if (!selectedImage) return;

    const availableProfileIds = new Set(availableProfiles.map((profile) => profile.id));
    const nextProfileId =
      pendingProfileId && availableProfileIds.has(pendingProfileId)
        ? pendingProfileId
        : selectedProfileId && availableProfileIds.has(selectedProfileId)
          ? selectedProfileId
          : activeProfileId && availableProfileIds.has(activeProfileId)
            ? activeProfileId
            : selectedImage.annotations[0]?.profileId ?? availableProfiles[0]?.id;

    if (nextProfileId !== selectedProfileId) {
      setSelectedProfileId(nextProfileId);
      if (nextProfileId !== undefined) {
        setActiveProfile(nextProfileId);
      }
    }
    if (pendingProfileId && nextProfileId === pendingProfileId) {
      setPendingProfileId(undefined);
    }
  }, [
    activeProfileId,
    availableProfiles,
    pendingProfileId,
    selectedImage,
    selectedProfileId,
    setActiveProfile
  ]);

  useEffect(() => {
    if (!selectedImage || selectedProfileId === undefined) {
      setContent("");
      setInstruction("");
      return;
    }

    const annotationDrafts = annotationDraftsByProfile[selectedProfileId] ?? {};
    const instructionDrafts = instructionDraftsByProfile[selectedProfileId] ?? {};
    const nextContent = Object.prototype.hasOwnProperty.call(annotationDrafts, selectedImage.id)
      ? annotationDrafts[selectedImage.id] ?? ""
      : selectedAnnotation?.content ?? "";
    const nextInstruction = Object.prototype.hasOwnProperty.call(instructionDrafts, selectedImage.id)
      ? instructionDrafts[selectedImage.id] ?? ""
      : selectedAnnotation?.instruction ?? "";
    setContent(nextContent);
    setInstruction(nextInstruction);
  }, [
    annotationDraftsByProfile,
    instructionDraftsByProfile,
    selectedAnnotation,
    selectedImage,
    selectedProfileId
  ]);

  useEffect(() => {
    setCopiedDraftTab(undefined);
  }, [activeDraftTab, content, instruction]);

  useEffect(
    () => () => {
      if (clearCopyFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(clearCopyFeedbackTimerRef.current);
      }
    },
    []
  );

  if (!selectedImage) {
    return null;
  }

  const isFolderImage = selectedImage.sourceKind === "folder";
  const isAnnotating = annotatingImageIds.includes(selectedImage.id);
  const previewSrc = selectedImage.sourceMissing
    ? undefined
    : resolveAssetSrc(selectedImage.storagePath ?? selectedImage.path) ??
      resolveAssetSrc(
        selectedImage.thumbnailPath,
        `${selectedImage.updatedAt}:${thumbnailCacheKey}`
      );
  const filledAnnotationCount = selectedImage.annotations.filter((annotation) =>
    annotation.content.trim()
  ).length;
  const annotationCountLabel = isFolderImage
    ? `${filledAnnotationCount} ${t("image.annotations")}`
    : `${availableProfiles.length} ${t("image.annotationTypes")}`;
  const displayedDimensions =
    selectedImage.width && selectedImage.height
      ? { width: selectedImage.width, height: selectedImage.height }
      : loadedDimensions?.imageId === selectedImage.id
        ? loadedDimensions
        : undefined;

  const rememberLoadedDimensions = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (!naturalWidth || !naturalHeight) return;

    setLoadedDimensions({
      imageId: selectedImage.id,
      width: naturalWidth,
      height: naturalHeight
    });
  };

  const selectProfile = (profileId: number) => {
    setSelectedProfileId(profileId);
    setActiveProfile(profileId);
  };

  const startNewAnnotationType = () => {
    if (isFolderImage) return;
    setIsCreatingProfile(true);
    setNewProfileName("");
    setCreateProfileError("");
  };

  const trimmedNewProfileName = newProfileName.trim();
  const normalizedNewProfileName = trimmedNewProfileName.toLocaleLowerCase();
  const newProfileNameExists = profiles.some(
    (profile) =>
      profile.datasetId === selectedImage.datasetId &&
      profile.name.trim().toLocaleLowerCase() === normalizedNewProfileName
  );
  const newProfileError = newProfileNameExists
    ? t("image.profileNameExists")
    : createProfileError;

  const createProfile = async () => {
    if (newProfileNameExists) return;

    try {
      const profileId = await createAnnotationProfile(newProfileName);
      if (!profileId) return;

      setPendingProfileId(profileId);
      setIsCreatingProfile(false);
      setNewProfileName("");
      setCreateProfileError("");
    } catch (error) {
      setCreateProfileError(error instanceof Error ? error.message : t("image.createTypeFailed"));
    }
  };

  const saveCurrentAnnotation = () => {
    if (isAnnotating || selectedProfileId === undefined) return;
    saveAnnotation(selectedImage.id, selectedProfileId, content).catch((error) => {
      addAppLog(t("appLog.saveAnnotationFailed", { message: formatAppError(error) }), "error");
    });
    saveInstruction(selectedImage.id, selectedProfileId, instruction).catch((error) => {
      addAppLog(t("appLog.saveInstructionFailed", { message: formatAppError(error) }), "error");
    });
  };

  const saveWithKeyboard = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    event.stopPropagation();
    saveCurrentAnnotation();
  };

  const updateContent = (value: string) => {
    setContent(value);
    if (selectedProfileId === undefined) return;
    applyTableDraft(selectedProfileId, selectedImage.id, { content: value });
  };

  const updateInstruction = (value: string) => {
    setInstruction(value);
    if (selectedProfileId === undefined) return;
    applyTableDraft(selectedProfileId, selectedImage.id, { instruction: value });
  };

  const copyCurrentDraft = () => {
    const copiedTab = activeDraftTab;
    const copiedText = activeDraftTab === "annotation" ? content : instruction;
    const copiedField =
      activeDraftTab === "annotation" ? t("image.annotationTab") : t("image.instructionTab");

    copyTextToClipboard(copiedText).then(
      () => {
        setCopiedDraftTab(copiedTab);
        if (clearCopyFeedbackTimerRef.current !== undefined) {
          window.clearTimeout(clearCopyFeedbackTimerRef.current);
        }
        clearCopyFeedbackTimerRef.current = window.setTimeout(() => {
          setCopiedDraftTab((current) => (current === copiedTab ? undefined : current));
          clearCopyFeedbackTimerRef.current = undefined;
        }, 1200);
        addAppLog(t("appLog.copiedDraft", { field: copiedField }));
      },
      (error) => {
        addAppLog(t("appLog.copyDraftFailed", { message: formatAppError(error) }), "error");
      }
    );
  };

  const isCopyDisabled = activeDraftTab === "annotation" ? !content : !instruction;
  const isCopied = copiedDraftTab === activeDraftTab && !isCopyDisabled;
  const copyButtonLabel = isCopied
    ? t("image.copied")
    : activeDraftTab === "annotation"
      ? t("image.copyAnnotation")
      : t("image.copyInstruction");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex h-10 items-center gap-3 border-b border-neutral-100 pb-3">
        <button
          className="no-drag inline-flex h-8 w-[76px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-neutral-200 bg-white text-[13px] text-neutral-700 transition hover:bg-neutral-50"
          onClick={closeImagePreview}
        >
          <ArrowLeft size={16} className="shrink-0" />
          {t("actions.back")}
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex min-w-0 items-center gap-2 text-[14px] font-semibold text-neutral-900">
            <span className="min-w-0 truncate">{selectedImage.fileName}</span>
            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-normal text-neutral-500">
              {annotationCountLabel}
            </span>
          </h2>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_352px] gap-3">
        <section className="flex min-h-0 flex-col rounded-lg border border-neutral-200 bg-neutral-50">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
            {selectedImage.sourceMissing ? (
              <CircleAlert size={72} className="text-red-600" />
            ) : previewSrc ? (
              <img
                src={previewSrc}
                alt=""
                className="max-h-full max-w-full object-contain"
                onLoad={rememberLoadedDimensions}
              />
            ) : (
              <div className="text-sm text-neutral-400">{selectedImage.fileName}</div>
            )}
          </div>
          <div className="border-t border-neutral-200 bg-white p-3">
            <div className="mb-2 text-[12px] font-medium text-neutral-700">{t("image.metadata")}</div>
            <dl className="grid gap-2 text-[12px] text-neutral-500 sm:grid-cols-3">
              <div>
                <dt className="text-neutral-400">{t("image.dimensions")}</dt>
                <dd className="m-0">
                  {displayedDimensions
                    ? `${displayedDimensions.width} x ${displayedDimensions.height}`
                    : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-400">{t("image.fileSize")}</dt>
                <dd className="m-0">{formatBytes(selectedImage.fileSize)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-neutral-400">{t("image.path")}</dt>
                <dd className="m-0 truncate" title={selectedImage.path}>
                  {selectedImage.path}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col rounded-lg border border-neutral-200 bg-white">
          {isFolderImage ? null : (
            <div className="flex max-h-[176px] min-h-[112px] shrink-0 flex-col border-b border-neutral-200">
              <div className="flex h-9 shrink-0 items-center justify-between px-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-neutral-800">
                  <FileText size={16} />
                  {t("image.annotationTypes")}
                </div>
              <button
                className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-600 transition hover:bg-neutral-100"
                onClick={startNewAnnotationType}
                title={t("image.newAnnotation")}
              >
                <Plus size={16} />
              </button>
              </div>

              <div className="hover-scrollbar min-h-0 flex-1 overflow-auto p-2 pt-0">
                {isCreatingProfile ? (
                  <div className="mb-2 rounded-md border border-neutral-200 bg-neutral-50 p-2">
                    <label className="mb-1 block text-[12px] font-medium text-neutral-600">
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
                    />
                    {newProfileError ? (
                      <div className="mt-1 text-[12px] text-red-600">{newProfileError}</div>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <button
                        className="no-drag inline-flex h-8 flex-1 items-center justify-center rounded-md border border-neutral-900 bg-neutral-900 px-2 text-[12px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void createProfile()}
                        disabled={!trimmedNewProfileName || newProfileNameExists}
                      >
                        {t("image.createType")}
                      </button>
                      <button
                        className="no-drag inline-flex h-8 items-center justify-center rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-600 transition hover:bg-neutral-50"
                        onClick={() => setIsCreatingProfile(false)}
                      >
                        {t("actions.cancel")}
                      </button>
                    </div>
                  </div>
                ) : null}

                {availableProfiles.length > 0 ? (
                  <div className="space-y-1">
                    {availableProfiles.map((profile) => {
                      const annotation = selectedImage.annotations.find(
                        (item) => item.profileId === profile.id
                      );
                      const annotationDrafts = annotationDraftsByProfile[profile.id] ?? {};
                      const displayContent = Object.prototype.hasOwnProperty.call(
                        annotationDrafts,
                        selectedImage.id
                      )
                        ? annotationDrafts[selectedImage.id] ?? ""
                        : annotation?.content ?? "";
                      const isSelected = selectedProfileId === profile.id;

                      return (
                        <button
                          key={profile.id}
                          className={`no-drag w-full rounded-md px-2 py-1.5 text-left transition ${
                            isSelected
                              ? "bg-neutral-900/[0.07] text-neutral-950"
                              : "text-neutral-700 hover:bg-neutral-100"
                          }`}
                          onClick={() => selectProfile(profile.id)}
                        >
                          <div className="truncate text-[12px] font-medium">
                            {profile.name}
                          </div>
                          <div className="mt-0.5 line-clamp-1 text-[12px] text-neutral-500">
                            {displayContent || "-"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-md bg-neutral-50 px-3 py-2 text-[13px] text-neutral-500">
                    {t("image.noAnnotations")}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col p-3">
            {selectedProfileId !== undefined ? (
              <>
            <div className="mb-3 flex shrink-0 items-center gap-1 border-b border-neutral-100">
              {[
                { id: "annotation" as const, label: t("image.annotationTab") },
                { id: "instruction" as const, label: t("image.instructionTab") }
              ].map((tab) => {
                const isActive = activeDraftTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`no-drag flex h-9 items-center border-b-2 px-3 text-[13px] transition ${
                      isActive
                        ? "border-neutral-900 text-neutral-950"
                        : "border-transparent text-neutral-500 hover:text-neutral-900"
                    }`}
                    onClick={() => setActiveDraftTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div className="relative min-h-0 flex-1">
              {activeDraftTab === "annotation" ? (
                <textarea
                  value={content}
                  onChange={(event) => updateContent(event.target.value)}
                  onKeyDown={saveWithKeyboard}
                  className="glass-input h-full w-full resize-none p-2 text-[13px] disabled:cursor-wait disabled:opacity-80"
                  disabled={isAnnotating}
                />
              ) : (
                <textarea
                  value={instruction}
                  onChange={(event) => updateInstruction(event.target.value)}
                  onKeyDown={saveWithKeyboard}
                  className="glass-input h-full w-full resize-none p-2 text-[13px]"
                />
              )}
              {activeDraftTab === "annotation" && isAnnotating ? (
                <div className="pointer-events-none absolute right-3 top-3">
                  <LoaderCircle className="h-5 w-5 animate-spin text-neutral-500" />
                </div>
              ) : null}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="no-drag inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800"
                onClick={saveCurrentAnnotation}
                disabled={isAnnotating}
              >
                <Save size={15} />
                {t("image.save")}
              </button>
              <button
                className={`no-drag inline-flex h-8 w-8 items-center justify-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  isCopied
                    ? "border-neutral-300 bg-neutral-100 text-neutral-900 hover:bg-neutral-100"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                }`}
                onClick={copyCurrentDraft}
                disabled={isCopyDisabled}
                title={copyButtonLabel}
                aria-label={copyButtonLabel}
              >
                {isCopied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
              </>
            ) : (
              <div className="rounded-md bg-neutral-50 px-3 py-2 text-[13px] text-neutral-500">
                {t("image.selectAnnotationHint")}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
