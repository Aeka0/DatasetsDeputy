import { Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { resolveAssetSrc } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { GlassPanel } from "../ui/GlassPanel";

function normalizeTags(input: string) {
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function DetailPanel() {
  const { t } = useTranslation();
  const { images, selectedImageId, selectImage, updateManualAnnotations } = useDatasetStore();
  const selectedImage = useMemo(
    () => images.find((image) => image.id === selectedImageId),
    [images, selectedImageId]
  );
  const [tagText, setTagText] = useState("");
  const [caption, setCaption] = useState("");

  useEffect(() => {
    setTagText(selectedImage?.tags.join(", ") ?? "");
    setCaption(selectedImage?.caption ?? "");
  }, [selectedImage]);

  if (!selectedImage) {
    return (
      <GlassPanel className="flex h-full w-96 shrink-0 items-center justify-center p-8 text-center text-sm text-white/50">
        {t("detail.noSelection")}
      </GlassPanel>
    );
  }

  const tags = normalizeTags(tagText);

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
            {t("detail.tagsLabel")}
          </label>
          <textarea
            value={tagText}
            onChange={(event) => setTagText(event.target.value)}
            className="glass-input min-h-24 w-full resize-none rounded-2xl p-3 text-sm"
            placeholder={t("detail.tagsPlaceholder")}
          />
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-[0.16em] text-white/42">
            {t("detail.captionLabel")}
          </label>
          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            className="glass-input min-h-32 w-full resize-none rounded-2xl p-3 text-sm"
            placeholder={t("detail.captionPlaceholder")}
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
          onClick={() => void updateManualAnnotations(selectedImage.id, tags, caption)}
        >
          <Save size={16} />
          {t("actions.save")}
        </Button>
      </div>
    </GlassPanel>
  );
}
