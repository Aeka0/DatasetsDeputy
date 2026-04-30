import { ArrowLeft, FileText, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { resolveAssetSrc } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import type { Annotation } from "../../types";

function formatBytes(bytes?: number) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ImagePreviewView() {
  const { t } = useTranslation();
  const {
    images,
    profiles,
    selectedImageId,
    selectImage,
    saveAnnotation,
    createAnnotationProfile,
    clearAnnotation
  } = useDatasetStore();
  const selectedImage = useMemo(
    () => images.find((image) => image.id === selectedImageId),
    [images, selectedImageId]
  );
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | "new">("new");
  const [profileId, setProfileId] = useState<number>(profiles[0]?.id ?? 1);
  const [content, setContent] = useState("");
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [pendingProfileId, setPendingProfileId] = useState<number>();

  const selectedAnnotation = useMemo(
    () =>
      selectedAnnotationId === "new"
        ? undefined
        : selectedImage?.annotations.find((annotation) => annotation.id === selectedAnnotationId),
    [selectedAnnotationId, selectedImage]
  );

  useEffect(() => {
    if (!selectedImage) return;

    if (pendingProfileId) {
      const pendingAnnotation = selectedImage.annotations.find(
        (annotation) => annotation.profileId === pendingProfileId
      );
      if (pendingAnnotation) {
        setSelectedAnnotationId(pendingAnnotation.id);
        setProfileId(pendingAnnotation.profileId);
        setContent(pendingAnnotation.content);
        setPendingProfileId(undefined);
        return;
      }
    }

    if (
      selectedAnnotationId !== "new" &&
      selectedImage.annotations.some((annotation) => annotation.id === selectedAnnotationId)
    ) {
      return;
    }

    const firstAnnotation = selectedImage.annotations[0];
    if (firstAnnotation) {
      setSelectedAnnotationId(firstAnnotation.id);
      setProfileId(firstAnnotation.profileId);
      setContent(firstAnnotation.content);
    } else {
      setSelectedAnnotationId("new");
      setProfileId(profiles[0]?.id ?? 1);
      setContent("");
    }
  }, [pendingProfileId, profiles, selectedAnnotationId, selectedImage]);

  useEffect(() => {
    if (!selectedAnnotation) return;
    setProfileId(selectedAnnotation.profileId);
    setContent(selectedAnnotation.content);
  }, [selectedAnnotation]);

  if (!selectedImage) {
    return null;
  }

  const isFolderImage = selectedImage.sourceKind === "folder";
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const previewSrc = resolveAssetSrc(selectedImage.path) ?? resolveAssetSrc(selectedImage.thumbnailPath);
  const selectedImageProfileIds = new Set(
    selectedImage.annotations.map((annotation) => annotation.profileId)
  );
  const filledAnnotationCount = selectedImage.annotations.filter((annotation) =>
    annotation.content.trim()
  ).length;
  const annotationCountLabel = isFolderImage
    ? `${filledAnnotationCount} ${t("image.annotations")}`
    : `${selectedImageProfileIds.size} ${t("image.annotationTypes")}`;

  const selectAnnotation = (annotation: Annotation) => {
    setSelectedAnnotationId(annotation.id);
    setProfileId(annotation.profileId);
    setContent(annotation.content);
  };

  const startNewAnnotationType = () => {
    if (isFolderImage) return;
    setIsCreatingProfile(true);
    setNewProfileName("");
  };

  const createProfile = async () => {
    const profileId = await createAnnotationProfile(newProfileName);
    if (!profileId) return;

    setPendingProfileId(profileId);
    setIsCreatingProfile(false);
    setNewProfileName("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex h-10 items-center gap-3 border-b border-slate-100 pb-3">
        <button
          className="no-drag inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition hover:bg-slate-50"
          onClick={() => selectImage(undefined)}
        >
          <ArrowLeft size={16} />
          {t("actions.back")}
        </button>
        <div className="min-w-0">
          <h2 className="m-0 flex min-w-0 items-center gap-2 text-[14px] font-semibold text-slate-900">
            <span className="min-w-0 truncate">{selectedImage.fileName}</span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500">
              {annotationCountLabel}
            </span>
          </h2>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_352px] gap-3">
        <section className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-slate-50">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
            {previewSrc ? (
              <img
                src={previewSrc}
                alt=""
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="text-sm text-slate-400">{selectedImage.fileName}</div>
            )}
          </div>
          <div className="border-t border-slate-200 bg-white p-3">
            <div className="mb-2 text-[12px] font-medium text-slate-700">{t("image.metadata")}</div>
            <dl className="grid gap-2 text-[12px] text-slate-500 sm:grid-cols-3">
              <div>
                <dt className="text-slate-400">{t("image.dimensions")}</dt>
                <dd className="m-0">
                  {selectedImage.width && selectedImage.height
                    ? `${selectedImage.width} x ${selectedImage.height}`
                    : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">{t("image.fileSize")}</dt>
                <dd className="m-0">{formatBytes(selectedImage.fileSize)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-slate-400">{t("image.path")}</dt>
                <dd className="m-0 truncate" title={selectedImage.path}>
                  {selectedImage.path}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col rounded-lg border border-slate-200 bg-white">
          {isFolderImage ? null : (
            <div className="flex max-h-[176px] min-h-[112px] shrink-0 flex-col border-b border-slate-200">
              <div className="flex h-9 shrink-0 items-center justify-between px-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                  <FileText size={16} />
                  {t("image.annotationTypes")}
                </div>
              <button
                className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100"
                onClick={startNewAnnotationType}
                title={t("image.newAnnotation")}
              >
                <Plus size={16} />
              </button>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-2 pt-0">
                {isCreatingProfile ? (
                  <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <label className="mb-1 block text-[12px] font-medium text-slate-600">
                      {t("image.newTypeName")}
                    </label>
                    <input
                      value={newProfileName}
                      onChange={(event) => setNewProfileName(event.target.value)}
                      className="glass-input h-8 w-full px-2 text-[13px]"
                      autoFocus
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        className="no-drag inline-flex h-8 flex-1 items-center justify-center rounded-md border border-slate-900 bg-slate-900 px-2 text-[12px] font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => void createProfile()}
                        disabled={!newProfileName.trim()}
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
                ) : null}

                {selectedImage.annotations.length > 0 ? (
                  <div className="space-y-1">
                    {selectedImage.annotations.map((annotation) => (
                      <button
                        key={annotation.id}
                        className={`no-drag w-full rounded-md px-2 py-1.5 text-left transition ${
                          selectedAnnotationId === annotation.id
                            ? "bg-slate-900/[0.07] text-slate-950"
                            : "text-slate-700 hover:bg-slate-100"
                        }`}
                        onClick={() => selectAnnotation(annotation)}
                      >
                        <div className="truncate text-[12px] font-medium">
                          {profileById.get(annotation.profileId)?.name ?? `#${annotation.profileId}`}
                        </div>
                        <div className="mt-0.5 line-clamp-1 text-[12px] text-slate-500">
                          {annotation.content || "-"}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-500">
                    {t("image.noAnnotations")}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col p-3">
            {selectedAnnotation ? (
              <>
            {isFolderImage ? null : (
              <>
                <label className="mb-1 block text-[12px] font-medium text-slate-600">
                  {t("image.profile")}
                </label>
                <select
                  value={profileId}
                  onChange={(event) => setProfileId(Number(event.target.value))}
                  disabled={Boolean(selectedAnnotation)}
                  className="glass-input mb-3 h-8 w-full px-2 text-[13px]"
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label className="mb-1 block text-[12px] font-medium text-slate-600">{t("image.content")}</label>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="glass-input min-h-0 flex-1 resize-none p-2 text-[13px]"
            />

            <div className="mt-3 flex gap-2">
              <button
                className="no-drag inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md border border-slate-900 bg-slate-900 px-3 text-[13px] font-medium text-white transition hover:bg-slate-800"
                onClick={() => void saveAnnotation(selectedImage.id, profileId, content)}
              >
                <Save size={15} />
                {t("image.save")}
              </button>
              {selectedAnnotation ? (
                <button
                  className="no-drag inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50"
                  onClick={() => void clearAnnotation(selectedAnnotation.id)}
                  title={t("image.delete")}
                >
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
              </>
            ) : (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-500">
                {t("image.selectAnnotationHint")}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
