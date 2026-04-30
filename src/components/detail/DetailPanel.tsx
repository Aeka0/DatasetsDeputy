import { Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { resolveAssetSrc } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import { Button } from "../ui/Button";
import { GlassPanel } from "../ui/GlassPanel";

export function DetailPanel() {
  const { t } = useTranslation();
  const {
    images,
    profiles,
    activeProfileId,
    selectedImageId,
    selectImage,
    setActiveProfile,
    saveAnnotation,
    saveInstruction
  } = useDatasetStore();
  const selectedImage = useMemo(
    () => images.find((image) => image.id === selectedImageId),
    [images, selectedImageId]
  );
  const availableProfileIds = useMemo(
    () => new Set(selectedImage?.annotations.map((annotation) => annotation.profileId) ?? []),
    [selectedImage]
  );
  const availableProfiles = useMemo(
    () => profiles.filter((profile) => availableProfileIds.has(profile.id)),
    [availableProfileIds, profiles]
  );
  const selectedProfileId = availableProfiles.some((profile) => profile.id === activeProfileId)
    ? activeProfileId
    : availableProfiles[0]?.id;
  const selectedAnnotation = selectedImage?.annotations.find(
    (annotation) => annotation.profileId === selectedProfileId
  );
  const [content, setContent] = useState("");
  const [instruction, setInstruction] = useState("");

  useEffect(() => {
    setContent(selectedAnnotation?.content ?? "");
    setInstruction(selectedAnnotation?.instruction ?? "");
  }, [selectedAnnotation]);

  if (!selectedImage) {
    return (
      <GlassPanel className="flex h-full w-96 shrink-0 items-center justify-center p-8 text-center text-sm text-white/50">
        {t("detail.noSelection")}
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="flex h-full w-[420px] shrink-0 flex-col overflow-hidden">
      <div className="flex items-start justify-between border-b border-white/10 p-5">
        <div>
          <h2 className="m-0 text-lg font-semibold">{t("detail.title")}</h2>
          <p className="mt-1 text-sm text-white/46">{selectedImage.fileName}</p>
        </div>
        <Button variant="ghost" className="h-9 w-9 p-0" onClick={() => selectImage(undefined)}>
          <X size={16} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-3xl bg-white/[0.055]">
          {selectedImage.thumbnailPath ? (
            <img
              src={resolveAssetSrc(selectedImage.thumbnailPath)}
              alt=""
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="text-sm text-white/32">{selectedImage.fileName}</div>
          )}
        </div>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-[0.16em] text-white/42">
            {t("detail.profileLabel")}
          </label>
          <select
            value={selectedProfileId ?? ""}
            onChange={(event) => setActiveProfile(Number(event.target.value))}
            className="glass-input h-9 w-full px-3 text-sm"
          >
            {availableProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </section>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-[0.16em] text-white/42">
            {t("detail.annotationData")}
          </label>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="glass-input min-h-32 w-full resize-none rounded-2xl p-3 text-sm"
          />
        </section>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-[0.16em] text-white/42">
            {t("detail.instruction")}
          </label>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            className="glass-input min-h-28 w-full resize-none rounded-2xl p-3 text-sm"
          />
        </section>

        <section className="space-y-3 rounded-3xl bg-white/[0.045] p-4">
          <h3 className="m-0 text-sm font-medium text-white/78">{t("detail.metadata")}</h3>
          <dl className="space-y-2 text-xs text-white/50">
            <div>
              <dt className="text-white/34">{t("detail.path")}</dt>
              <dd className="m-0 break-all">{selectedImage.path}</dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-white/34">{t("table.dimensions")}</dt>
                <dd className="m-0">
                  {selectedImage.width && selectedImage.height
                    ? `${selectedImage.width} x ${selectedImage.height}`
                    : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-white/34">{t("detail.hash")}</dt>
                <dd className="m-0">{selectedImage.fileHash ?? "-"}</dd>
              </div>
            </div>
          </dl>
        </section>
      </div>

      <div className="border-t border-white/10 p-5">
        <Button
          className="w-full"
          disabled={!selectedProfileId}
          onClick={() => {
            if (!selectedProfileId) return;
            void saveAnnotation(selectedImage.id, selectedProfileId, content);
            void saveInstruction(selectedImage.id, selectedProfileId, instruction);
          }}
        >
          <Save size={16} />
          {t("actions.save")}
        </Button>
      </div>
    </GlassPanel>
  );
}
