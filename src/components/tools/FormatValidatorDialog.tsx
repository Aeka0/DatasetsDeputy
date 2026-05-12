import { open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Loader2,
  Play,
  ShieldCheck,
  Wrench,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { invokeCommand } from "../../lib/tauri";
import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";

interface FormatMismatch {
  filePath: string;
  currentExtension: string;
  actualFormat: string;
  correctExtension: string;
}

interface FormatMismatchScanProgress {
  scanId: string;
  scanned: number;
  total: number;
  done: boolean;
  mismatch?: FormatMismatch;
  error?: string;
}

interface FormatValidatorDialogProps {
  onClose: () => void;
}

export function FormatValidatorDialog({ onClose }: FormatValidatorDialogProps) {
  const { t } = useTranslation();
  const { open: portalOpen, close } = useAnimatedPortalClose(onClose);
  const [folderPath, setFolderPath] = useState("");
  const [mismatches, setMismatches] = useState<FormatMismatch[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [fixedCount, setFixedCount] = useState<number | null>(null);
  const [scanProgress, setScanProgress] = useState({ scanned: 0, total: 0 });
  const scanIdRef = useRef<string | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let isMounted = true;

    void listen<FormatMismatchScanProgress>("format-mismatch-scan-progress", (event) => {
      const progress = event.payload;
      if (progress.scanId !== scanIdRef.current) return;

      setScanProgress({ scanned: progress.scanned, total: progress.total });
      const mismatch = progress.mismatch;
      if (mismatch) {
        setMismatches((current) =>
          current.some((item) => item.filePath === mismatch.filePath)
            ? current
            : [...current, mismatch]
        );
      }

      if (progress.done) {
        setIsScanning(false);
        setHasScanned(true);
      }
    }).then((handler) => {
      if (isMounted) {
        unlisten = handler;
      } else {
        handler();
      }
    });

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, []);

  const chooseFolderPath = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("tools.formatValidator.selectFolder")
    });

    if (!selected || Array.isArray(selected)) return;
    setFolderPath(selected);
    setMismatches([]);
    setHasScanned(false);
    setFixedCount(null);
    setScanProgress({ scanned: 0, total: 0 });
  };

  const startScan = async () => {
    if (!folderPath) return;

    setIsScanning(true);
    setMismatches([]);
    setHasScanned(false);
    setFixedCount(null);
    setScanProgress({ scanned: 0, total: 0 });

    try {
      const scanId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      scanIdRef.current = scanId;
      await invokeCommand<void>("start_format_mismatch_scan", {
        scanId,
        folder: folderPath
      });
    } catch {
      setMismatches([]);
      setHasScanned(true);
      setIsScanning(false);
    }
  };

  const fixAll = async () => {
    if (mismatches.length === 0) return;

    setIsFixing(true);
    try {
      const count = await invokeCommand<number>("fix_format_mismatches", {
        folder: folderPath,
        items: mismatches
      });
      setFixedCount(count ?? 0);
      setMismatches([]);
      setHasScanned(false);
      setScanProgress({ scanned: 0, total: 0 });
    } finally {
      setIsFixing(false);
    }
  };

  return (
    <AnimatedPortal open={portalOpen}>
    <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5">
      <section
        className="flex h-[580px] w-full max-w-[720px] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
          <div className="flex items-center gap-2.5">
            <ShieldCheck size={18} className="text-neutral-700" />
            <h2 className="m-0 text-[15px] font-semibold text-neutral-950">
              {t("tools.formatValidator.title")}
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
            className="inline-flex h-8 items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-50"
            onClick={() => void chooseFolderPath()}
          >
            <FolderOpen size={14} />
            {t("tools.formatValidator.selectFolder")}
          </button>
          {folderPath ? (
            <div className="min-w-0 flex-1 truncate text-[12px] text-neutral-500">{folderPath}</div>
          ) : (
            <div className="text-[12px] text-neutral-400">
              {t("tools.formatValidator.noFolderSelected")}
            </div>
          )}
        </div>

        <div className="hover-scrollbar min-h-0 flex-1 overflow-auto px-5 py-3">
          {fixedCount !== null ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <CheckCircle2 size={28} className="text-neutral-600" />
              <div className="text-[13px] text-neutral-700">
                {t("tools.formatValidator.fixComplete", { count: fixedCount })}
              </div>
            </div>
          ) : mismatches.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-neutral-700">
                {isScanning ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <AlertTriangle size={14} />
                )}
                {t("tools.formatValidator.foundMismatches", { count: mismatches.length })}
              </div>
              <div className="rounded-md border border-neutral-200">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50">
                      <th className="px-3 py-2 text-left font-medium text-neutral-600">
                        {t("tools.formatValidator.colFile")}
                      </th>
                      <th className="w-[90px] px-3 py-2 text-left font-medium text-neutral-600">
                        {t("tools.formatValidator.colExtension")}
                      </th>
                      <th className="w-[90px] px-3 py-2 text-left font-medium text-neutral-600">
                        {t("tools.formatValidator.colActualFormat")}
                      </th>
                      <th className="w-[100px] px-3 py-2 text-left font-medium text-neutral-600">
                        {t("tools.formatValidator.colCorrectExt")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {mismatches.map((item) => (
                      <tr
                        key={item.filePath}
                        className="border-b border-neutral-100 last:border-b-0"
                      >
                        <td className="max-w-0 truncate px-3 py-2 text-neutral-800">
                          {item.filePath}
                        </td>
                        <td className="px-3 py-2 text-neutral-600">.{item.currentExtension}</td>
                        <td className="px-3 py-2 text-neutral-700">{item.actualFormat}</td>
                        <td className="px-3 py-2 font-medium text-neutral-900">
                          .{item.correctExtension}
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
              <div className="text-[13px]">
                {scanProgress.total > 0
                  ? t("tools.formatValidator.scanProgress", scanProgress)
                  : t("tools.formatValidator.scanning")}
              </div>
            </div>
          ) : hasScanned && mismatches.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <CheckCircle2 size={28} className="text-neutral-600" />
              <div className="text-[13px] text-neutral-700">
                {t("tools.formatValidator.noMismatches")}
              </div>
            </div>
          ) : !hasScanned ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-400">
              <ShieldCheck size={32} className="opacity-40" />
              <div className="text-[13px]">{t("tools.formatValidator.hint")}</div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-neutral-200 px-5 py-3">
          <div className="text-[12px] text-neutral-400">
            {isScanning && scanProgress.total > 0
              ? t("tools.formatValidator.scanProgress", scanProgress)
              : hasScanned && mismatches.length > 0
              ? t("tools.formatValidator.mismatchSummary", { count: mismatches.length })
              : ""}
          </div>
          <div className="flex items-center gap-2">
            {mismatches.length > 0 ? (
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-700 bg-neutral-700 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
                disabled={isFixing || isScanning}
                onClick={() => void fixAll()}
              >
                {isFixing ? <Loader2 size={16} className="animate-spin" /> : <Wrench size={16} />}
                {t("tools.formatValidator.fixAll")}
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
              disabled={!folderPath || isScanning}
              onClick={() => void startScan()}
            >
              {isScanning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {t("tools.formatValidator.scan")}
            </button>
          </div>
        </div>
      </section>
    </div>
    </AnimatedPortal>
  );
}
