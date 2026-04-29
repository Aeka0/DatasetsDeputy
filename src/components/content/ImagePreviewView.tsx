import { ArrowLeft, FileText, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { resolveAssetSrc } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import type { Annotation } from "../../types";

const copy = {
  back: "\u8fd4\u56de",
  annotations: "\u6807\u6ce8",
  noAnnotations: "\u8fd9\u5f20\u56fe\u7247\u8fd8\u6ca1\u6709\u6807\u6ce8",
  profile: "\u6807\u6ce8\u7c7b\u578b",
  content: "\u6807\u6ce8\u5185\u5bb9",
  newAnnotation: "\u65b0\u589e\u6807\u6ce8\u7c7b\u578b",
  newTypeName: "\u65b0\u6807\u6ce8\u7c7b\u578b\u540d\u79f0",
  createType: "\u521b\u5efa\u7c7b\u578b",
  cancel: "\u53d6\u6d88",
  selectAnnotationHint: "\u9009\u62e9\u4e00\u4efd\u6807\u6ce8\u540e\u7f16\u8f91\uff0c\u6216\u521b\u5efa\u65b0\u6807\u6ce8\u7c7b\u578b",
  save: "\u4fdd\u5b58\u6807\u6ce8",
  delete: "\u6e05\u7a7a\u6807\u6ce8",
  metadata: "\u5143\u6570\u636e",
  path: "\u8def\u5f84",
  size: "\u5c3a\u5bf8",
  fileSize: "\u6587\u4ef6\u5927\u5c0f"
};

function formatBytes(bytes?: number) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ImagePreviewView() {
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

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const previewSrc = resolveAssetSrc(selectedImage.path) ?? resolveAssetSrc(selectedImage.thumbnailPath);

  const selectAnnotation = (annotation: Annotation) => {
    setSelectedAnnotationId(annotation.id);
    setProfileId(annotation.profileId);
    setContent(annotation.content);
  };

  const startNewAnnotationType = () => {
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
      <div className="mb-3 flex items-center gap-3">
        <button
          className="no-drag inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white/70 px-3 text-sm text-slate-700 transition hover:bg-white"
          onClick={() => selectImage(undefined)}
        >
          <ArrowLeft size={16} />
          {copy.back}
        </button>
        <div className="min-w-0">
          <h2 className="m-0 truncate text-sm font-medium text-slate-900">
            {selectedImage.fileName}
          </h2>
          <div className="mt-0.5 text-xs text-slate-500">
            {selectedImage.annotations.length}
            {copy.annotations}
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] gap-3">
        <section className="flex min-h-0 flex-col rounded-md border border-slate-200 bg-slate-50/80">
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
          <div className="border-t border-slate-200 bg-white/70 p-3">
            <div className="mb-2 text-xs font-medium text-slate-700">{copy.metadata}</div>
            <dl className="grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
              <div>
                <dt className="text-slate-400">{copy.size}</dt>
                <dd className="m-0">
                  {selectedImage.width && selectedImage.height
                    ? `${selectedImage.width} x ${selectedImage.height}`
                    : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">{copy.fileSize}</dt>
                <dd className="m-0">{formatBytes(selectedImage.fileSize)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-slate-400">{copy.path}</dt>
                <dd className="m-0 truncate" title={selectedImage.path}>
                  {selectedImage.path}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col rounded-md border border-slate-200 bg-white/72">
          <div className="flex items-center justify-between border-b border-slate-200 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <FileText size={16} />
              {copy.annotations}
            </div>
            <button
              className="no-drag inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100"
              onClick={startNewAnnotationType}
              title={copy.newAnnotation}
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {isCreatingProfile ? (
              <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  {copy.newTypeName}
                </label>
                <input
                  value={newProfileName}
                  onChange={(event) => setNewProfileName(event.target.value)}
                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-3 focus:ring-slate-100"
                  autoFocus
                />
                <div className="mt-2 flex gap-2">
                  <button
                    className="no-drag inline-flex h-8 flex-1 items-center justify-center rounded-md bg-slate-900 px-2 text-xs font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void createProfile()}
                    disabled={!newProfileName.trim()}
                  >
                    {copy.createType}
                  </button>
                  <button
                    className="no-drag inline-flex h-8 items-center justify-center rounded-md border border-slate-200 px-2 text-xs text-slate-600 transition hover:bg-white"
                    onClick={() => setIsCreatingProfile(false)}
                  >
                    {copy.cancel}
                  </button>
                </div>
              </div>
            ) : null}

            {selectedImage.annotations.length > 0 ? (
              <div className="space-y-1">
                {selectedImage.annotations.map((annotation) => (
                  <button
                    key={annotation.id}
                    className={`no-drag w-full rounded-md px-2 py-2 text-left transition ${
                      selectedAnnotationId === annotation.id
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                    onClick={() => selectAnnotation(annotation)}
                  >
                    <div className="truncate text-xs font-medium">
                      {profileById.get(annotation.profileId)?.name ?? `#${annotation.profileId}`}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs opacity-70">
                      {annotation.content || "-"}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
                {copy.noAnnotations}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 p-3">
            {selectedAnnotation ? (
              <>
            <label className="mb-1 block text-xs font-medium text-slate-600">{copy.profile}</label>
            <select
              value={profileId}
              onChange={(event) => setProfileId(Number(event.target.value))}
              disabled={Boolean(selectedAnnotation)}
              className="mb-3 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-3 focus:ring-slate-100"
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium text-slate-600">{copy.content}</label>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="h-40 w-full resize-none rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-3 focus:ring-slate-100"
            />

            <div className="mt-3 flex gap-2">
              <button
                className="no-drag inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition hover:bg-slate-800"
                onClick={() => void saveAnnotation(selectedImage.id, profileId, content)}
              >
                <Save size={15} />
                {copy.save}
              </button>
              {selectedAnnotation ? (
                <button
                  className="no-drag inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 text-rose-700 transition hover:bg-rose-50"
                  onClick={() => void clearAnnotation(selectedAnnotation.id)}
                  title={copy.delete}
                >
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
              </>
            ) : (
              <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
                {copy.selectAnnotationHint}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
