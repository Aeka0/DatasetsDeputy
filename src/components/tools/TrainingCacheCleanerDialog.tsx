import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Play,
  Trash2,
  X
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatAppError } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import { invokeCommand } from "../../lib/tauri";
import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";

interface TrainingCacheItem {
  path: string;
  itemType: "file" | "directory";
  sizeBytes: number;
}

interface TrainingCacheScanResult {
  folderPath: string;
  scannedEntries: number;
  items: TrainingCacheItem[];
  totalSizeBytes: number;
}

interface TrainingCacheRemoveResult {
  deleted: number;
  failed: number;
  releasedSizeBytes: number;
}

interface TrainingCacheCleanerDialogProps {
  onClose: () => void;
}

function formatByteValue(bytes: number) {
  return bytes === 0 ? "0 B" : formatBytes(bytes);
}

export function TrainingCacheCleanerDialog({ onClose }: TrainingCacheCleanerDialogProps) {
  const { t } = useTranslation();
  const { open: portalOpen, close } = useAnimatedPortalClose(onClose);
  const [folderPath, setFolderPath] = useState("");
  const [items, setItems] = useState<TrainingCacheItem[]>([]);
  const [scannedEntries, setScannedEntries] = useState(0);
  const [totalSizeBytes, setTotalSizeBytes] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [removeResult, setRemoveResult] = useState<TrainingCacheRemoveResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const startScan = async (path = folderPath) => {
    if (!path) return;

    setIsScanning(true);
    setItems([]);
    setScannedEntries(0);
    setTotalSizeBytes(0);
    setHasScanned(false);
    setRemoveResult(null);
    setErrorMessage("");

    try {
      const result = await invokeCommand<TrainingCacheScanResult>("scan_training_cache", {
        folder: path
      });
      setFolderPath(result.folderPath);
      setItems(result.items);
      setScannedEntries(result.scannedEntries);
      setTotalSizeBytes(result.totalSizeBytes);
      setHasScanned(true);
    } catch (error) {
      setErrorMessage(formatAppError(error));
      setHasScanned(true);
    } finally {
      setIsScanning(false);
    }
  };

  const chooseFolderPath = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("tools.trainingCacheCleaner.selectFolder")
    });

    if (!selected || Array.isArray(selected)) return;
    setFolderPath(selected);
    void startScan(selected);
  };

  const removeItems = async () => {
    if (!folderPath || items.length === 0) return;

    setIsRemoving(true);
    setErrorMessage("");
    try {
      const result = await invokeCommand<TrainingCacheRemoveResult>("remove_training_cache", {
        folder: folderPath,
        items
      });
      setRemoveResult(result);
      setItems([]);
      setTotalSizeBytes(0);
      setScannedEntries(0);
      setHasScanned(false);
    } catch (error) {
      setErrorMessage(formatAppError(error));
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <AnimatedPortal open={portalOpen}>
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5">
      <section
        className="flex h-[580px] w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
          <div className="flex items-center gap-2.5">
            <Trash2 size={18} className="text-neutral-700" />
            <h2 className="m-0 text-[15px] font-semibold text-neutral-950">
              {t("tools.trainingCacheCleaner.title")}
            </h2>
          </div>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700"
            onClick={close}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-b border-neutral-100 px-5 py-3">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
            disabled={isScanning || isRemoving}
            onClick={() => void chooseFolderPath()}
          >
            <FolderOpen size={14} />
            {t("tools.trainingCacheCleaner.selectFolder")}
          </button>
          {folderPath ? (
            <div className="min-w-0 flex-1 truncate text-[12px] text-neutral-500">{folderPath}</div>
          ) : (
            <div className="text-[12px] text-neutral-400">
              {t("tools.trainingCacheCleaner.noFolderSelected")}
            </div>
          )}
        </div>

        <div className="hover-scrollbar min-h-0 flex-1 overflow-auto px-5 py-3">
          {errorMessage ? (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
              {t("tools.trainingCacheCleaner.actionFailed", { message: errorMessage })}
            </div>
          ) : null}

          {removeResult ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <CheckCircle2 size={28} className="text-neutral-600" />
              <div className="text-[13px] text-neutral-700">
                {t("tools.trainingCacheCleaner.removeComplete", {
                  count: removeResult.deleted,
                  failed: removeResult.failed,
                  size: formatByteValue(removeResult.releasedSizeBytes)
                })}
              </div>
            </div>
          ) : items.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-neutral-700">
                  {isScanning ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <AlertTriangle size={14} />
                  )}
                  <span className="truncate">
                    {t("tools.trainingCacheCleaner.foundItems", {
                      count: items.length,
                      size: formatByteValue(totalSizeBytes)
                    })}
                  </span>
                </div>
                <div className="shrink-0 text-[12px] text-neutral-400">
                  {t("tools.trainingCacheCleaner.scannedEntries", { count: scannedEntries })}
                </div>
              </div>
              <div className="rounded-md border border-neutral-200">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50">
                      <th className="w-[96px] px-3 py-2 text-left font-medium text-neutral-600">
                        {t("tools.trainingCacheCleaner.colType")}
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-neutral-600">
                        {t("tools.trainingCacheCleaner.colPath")}
                      </th>
                      <th className="w-[108px] px-3 py-2 text-right font-medium text-neutral-600">
                        {t("tools.trainingCacheCleaner.colSize")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.path} className="border-b border-neutral-100 last:border-b-0">
                        <td className="px-3 py-2 text-neutral-600">
                          {item.itemType === "directory"
                            ? t("tools.trainingCacheCleaner.typeDirectory")
                            : t("tools.trainingCacheCleaner.typeFile")}
                        </td>
                        <td className="max-w-0 truncate px-3 py-2 text-neutral-800">
                          {item.path}
                        </td>
                        <td className="px-3 py-2 text-right text-neutral-700">
                          {formatByteValue(item.sizeBytes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : isScanning ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
              <Loader2 size={24} className="animate-spin" />
              <div className="text-[13px]">{t("tools.trainingCacheCleaner.scanning")}</div>
            </div>
          ) : hasScanned ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <CheckCircle2 size={28} className="text-neutral-600" />
              <div className="text-[13px] text-neutral-700">
                {t("tools.trainingCacheCleaner.noItems")}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-400">
              <Trash2 size={32} className="opacity-40" />
              <div className="text-[13px]">{t("tools.trainingCacheCleaner.hint")}</div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-neutral-200 px-5 py-3">
          <div className="text-[12px] text-neutral-400">
            {items.length > 0
              ? t("tools.trainingCacheCleaner.summary", {
                  count: items.length,
                  size: formatByteValue(totalSizeBytes)
                })
              : ""}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[13px] font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
              disabled={!folderPath || isScanning || isRemoving}
              onClick={() => void startScan()}
            >
              {isScanning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {t("tools.trainingCacheCleaner.rescan")}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-red-700 bg-red-700 px-3 text-[13px] font-medium text-white transition hover:bg-red-800 disabled:opacity-50"
              disabled={items.length === 0 || isScanning || isRemoving}
              onClick={() => void removeItems()}
            >
              {isRemoving ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              {t("tools.trainingCacheCleaner.confirmRemove")}
            </button>
          </div>
        </div>
      </section>
    </div>
    </AnimatedPortal>
  );
}
