import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Play,
  ScanSearch,
  Square,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatAppError } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import { invokeCommand, resolveAssetSrc } from "../../lib/tauri";
import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";
import { Slider } from "../ui/Slider";

interface SimilarityWarning {
  filePath: string;
  message: string;
}

interface SimilarityImageResult {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  modifiedMillis: number;
  exactHash?: string;
}

interface SimilarityGroupResult {
  id: string;
  groupKind: "exact" | "similar";
  minScore: number;
  maxScore: number;
  pairCount: number;
  images: SimilarityImageResult[];
}

interface SimilarityScanProgress {
  scanId: string;
  phase: "scanning" | "hashing" | "embedding" | "comparing" | "done" | "failed";
  processed: number;
  total: number;
  currentPath?: string;
  warning?: SimilarityWarning;
  done: boolean;
}

interface SimilarityScanComplete {
  scanId: string;
  folderPath: string;
  threshold: number;
  scanned: number;
  cacheHits: number;
  embedded: number;
  skipped: number;
  elapsedSeconds: number;
  groups: SimilarityGroupResult[];
  warnings: SimilarityWarning[];
}

interface DuplicateSimilarityDialogProps {
  onClose: () => void;
}

function formatModifiedTime(value: number) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatScore(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function DuplicateSimilarityDialog({ onClose }: DuplicateSimilarityDialogProps) {
  const { t } = useTranslation();
  const { open: portalOpen, close } = useAnimatedPortalClose(onClose);
  const [folderPath, setFolderPath] = useState("");
  const [threshold, setThreshold] = useState(0.96);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState<SimilarityScanProgress | null>(null);
  const [result, setResult] = useState<SimilarityScanComplete | null>(null);
  const [warnings, setWarnings] = useState<SimilarityWarning[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const scanIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: result?.groups.length ?? 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => 156,
    overscan: 6
  });

  useEffect(() => {
    let progressUnlisten: UnlistenFn | undefined;
    let completeUnlisten: UnlistenFn | undefined;
    let mounted = true;

    void listen<SimilarityScanProgress>("similarity-scan-progress", (event) => {
      const payload = event.payload;
      if (payload.scanId !== scanIdRef.current) return;
      setProgress(payload);
      if (payload.warning) {
        setWarnings((current) => [...current, payload.warning as SimilarityWarning]);
      }
      if (payload.done || payload.phase === "failed") {
        setIsScanning(false);
      }
      if (payload.phase === "failed" && payload.warning) {
        setErrorMessage(payload.warning.message);
      }
    }).then((handler) => {
      if (mounted) progressUnlisten = handler;
      else handler();
    });

    void listen<SimilarityScanComplete>("similarity-scan-complete", (event) => {
      const payload = event.payload;
      if (payload.scanId !== scanIdRef.current) return;
      setResult(payload);
      setWarnings(payload.warnings);
      setIsScanning(false);
      setProgress((current) => current ? { ...current, phase: "done", done: true } : current);
    }).then((handler) => {
      if (mounted) completeUnlisten = handler;
      else handler();
    });

    return () => {
      mounted = false;
      progressUnlisten?.();
      completeUnlisten?.();
    };
  }, []);

  const chooseFolderPath = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("tools.duplicateSimilarity.selectFolder")
    });
    if (!selected || Array.isArray(selected)) return;
    setFolderPath(selected);
    setResult(null);
    setWarnings([]);
    setErrorMessage("");
    setProgress(null);
  };

  const startScan = async () => {
    if (!folderPath || isScanning) return;
    const scanId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    scanIdRef.current = scanId;
    setIsScanning(true);
    setResult(null);
    setWarnings([]);
    setErrorMessage("");
    setProgress({ scanId, phase: "scanning", processed: 0, total: 0, done: false });
    try {
      await invokeCommand<void>("start_similarity_scan", {
        scanId,
        folder: folderPath,
        options: { threshold }
      });
    } catch (error) {
      setIsScanning(false);
      setErrorMessage(formatAppError(error));
    }
  };

  const cancelScan = async () => {
    const scanId = scanIdRef.current;
    if (!scanId) return;
    try {
      await invokeCommand<void>("cancel_similarity_scan", { scanId });
    } finally {
      setIsScanning(false);
    }
  };

  const closeDialog = () => {
    if (isScanning) {
      void cancelScan();
    }
    close();
  };

  const progressText =
    progress && progress.total > 0
      ? t("tools.duplicateSimilarity.progressCount", {
          processed: progress.processed,
          total: progress.total
        })
      : progress
        ? t(`tools.duplicateSimilarity.phase.${progress.phase}`)
        : "";

  return (
    <AnimatedPortal open={portalOpen}>
      <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5">
        <section
          className="flex h-[680px] w-full max-w-[980px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <ScanSearch size={18} className="shrink-0 text-neutral-700" />
              <h2 className="m-0 truncate text-[15px] font-semibold text-neutral-950">
                {t("tools.duplicateSimilarity.title")}
              </h2>
            </div>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700"
              onClick={closeDialog}
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_220px] gap-3 border-b border-neutral-100 px-5 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
                disabled={isScanning}
                onClick={() => void chooseFolderPath()}
              >
                <FolderOpen size={14} />
                {t("tools.duplicateSimilarity.selectFolder")}
              </button>
              <div className="min-w-0 flex-1 truncate text-[12px] text-neutral-500">
                {folderPath || t("tools.duplicateSimilarity.noFolderSelected")}
              </div>
            </div>
            <label className="grid grid-cols-[1fr_54px] items-center gap-2">
              <span className="truncate text-[12px] font-medium text-neutral-600">
                {t("tools.duplicateSimilarity.threshold")}
              </span>
              <span className="text-right text-[12px] text-neutral-500">
                {threshold.toFixed(2)}
              </span>
              <Slider
                className="col-span-2"
                min={0.8}
                max={0.99}
                step={0.01}
                value={threshold}
                disabled={isScanning}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
            </label>
          </div>

          <div className="min-h-0 flex-1 px-5 py-3">
            {errorMessage ? (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                {t("tools.duplicateSimilarity.scanFailed", { message: errorMessage })}
              </div>
            ) : null}

            {isScanning ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
                <Loader2 size={24} className="animate-spin" />
                <div className="text-[13px]">{progressText}</div>
                {progress?.currentPath ? (
                  <div className="max-w-full truncate text-[12px] text-neutral-400">
                    {progress.currentPath}
                  </div>
                ) : null}
              </div>
            ) : result ? (
              result.groups.length > 0 ? (
                <div ref={listRef} className="hover-scrollbar h-full overflow-auto">
                  <div
                    className="relative w-full"
                    style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const group = result.groups[virtualRow.index];
                      return (
                        <div
                          key={group.id}
                          className="absolute left-0 top-0 w-full pr-1"
                          style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                          <div className="mb-3 rounded-md border border-neutral-200 bg-white">
                            <div className="flex min-h-10 items-center justify-between gap-3 border-b border-neutral-100 px-3 py-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="rounded-sm bg-neutral-100 px-2 py-1 text-[11px] font-medium uppercase tracking-normal text-neutral-600">
                                  {group.groupKind === "exact"
                                    ? t("tools.duplicateSimilarity.exactGroup")
                                    : t("tools.duplicateSimilarity.similarGroup")}
                                </span>
                                <span className="truncate text-[12px] font-medium text-neutral-800">
                                  {t("tools.duplicateSimilarity.groupSummary", {
                                    count: group.images.length,
                                    min: formatScore(group.minScore),
                                    max: formatScore(group.maxScore)
                                  })}
                                </span>
                              </div>
                              <span className="shrink-0 text-[12px] text-neutral-400">
                                {t("tools.duplicateSimilarity.pairCount", {
                                  count: group.pairCount
                                })}
                              </span>
                            </div>
                            <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 p-3">
                              <div className="grid h-[96px] grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-md bg-neutral-100">
                                {group.images.slice(0, 4).map((image) => (
                                  <img
                                    key={image.filePath}
                                    src={resolveAssetSrc(image.filePath)}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                  />
                                ))}
                              </div>
                              <div className="min-w-0">
                                <div className="rounded-md border border-neutral-100">
                                  {group.images.slice(0, 5).map((image) => (
                                    <div
                                      key={image.filePath}
                                      className="grid grid-cols-[minmax(0,1fr)_86px_144px] gap-2 border-b border-neutral-100 px-2 py-1.5 text-[12px] last:border-b-0"
                                    >
                                      <div className="min-w-0 truncate text-neutral-800" title={image.filePath}>
                                        {image.filePath}
                                      </div>
                                      <div className="text-right text-neutral-500">
                                        {formatBytes(image.sizeBytes)}
                                      </div>
                                      <div className="truncate text-right text-neutral-400">
                                        {formatModifiedTime(image.modifiedMillis)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3">
                  <CheckCircle2 size={28} className="text-neutral-600" />
                  <div className="text-[13px] text-neutral-700">
                    {t("tools.duplicateSimilarity.noGroups")}
                  </div>
                </div>
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-400">
                <ScanSearch size={32} className="opacity-40" />
                <div className="text-[13px]">{t("tools.duplicateSimilarity.hint")}</div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-neutral-200 px-5 py-3">
            <div className="min-w-0 text-[12px] text-neutral-400">
              {result
                ? t("tools.duplicateSimilarity.resultSummary", {
                    scanned: result.scanned,
                    groups: result.groups.length,
                    cacheHits: result.cacheHits,
                    embedded: result.embedded,
                    seconds: result.elapsedSeconds.toFixed(1)
                  })
                : warnings.length > 0
                  ? t("tools.duplicateSimilarity.warningCount", { count: warnings.length })
                  : progressText}
            </div>
            <div className="flex items-center gap-2">
              {warnings.length > 0 ? (
                <div className="inline-flex h-9 items-center gap-1.5 text-[12px] text-amber-700">
                  <AlertTriangle size={14} />
                  {t("tools.duplicateSimilarity.warningCount", { count: warnings.length })}
                </div>
              ) : null}
              {isScanning ? (
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[13px] font-medium text-neutral-700 transition hover:bg-neutral-50"
                  onClick={() => void cancelScan()}
                >
                  <Square size={15} />
                  {t("actions.cancel")}
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
                disabled={!folderPath || isScanning}
                onClick={() => void startScan()}
              >
                {isScanning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {t("tools.duplicateSimilarity.scan")}
              </button>
            </div>
          </div>
        </section>
      </div>
    </AnimatedPortal>
  );
}
