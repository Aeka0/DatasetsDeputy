import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { getAnnotationForProfile } from "../../lib/annotations";
import {
  generateAnnotationPrompt,
  type AnnotationPromptSettings
} from "../../lib/annotationPrompt";
import {
  convertAnimaToBooruTag,
  convertBooruTagToAnima
} from "../../lib/annotationFormatConversion";
import {
  normalizeAnnotation,
  type AnnotationNormalizationOptions
} from "../../lib/annotationNormalization";
import { formatAppError } from "../../lib/errors";
import { formatDialogMenuLabel } from "../../lib/menuLabels";
import { findProject, formatProjectPath, getProjectDisplayName } from "../../lib/projects";
import { hasTauriRuntime, invokeCommand } from "../../lib/tauri";
import { useDatasetStore, type ViewFilterMode } from "../../stores/datasetStore";
import type { AnnotationChange, DatasetImage, DatasetProject } from "../../types";
import {
  AnnotationExecutionDialog,
  type AnnotationExecutionMode,
  type AnnotationConflictStrategy,
  type AnnotationExecutionScope
} from "../annotation/AnnotationExecutionDialog";
import {
  BatchAnnotationFormatConversionDialog,
  type BatchAnnotationFormatConversionOptions
} from "../annotation/BatchAnnotationFormatConversionDialog";
import { BatchAnnotationNormalizationDialog } from "../annotation/BatchAnnotationNormalizationDialog";
import { PromptManagementDialog } from "../annotation/PromptManagementDialog";
import { Wd14TaggerSettingsDialog } from "../annotation/Wd14TaggerSettingsDialog";
import { SettingsDialog } from "../settings/SettingsDialog";
import { FormatValidatorDialog } from "../tools/FormatValidatorDialog";
import { TrainingCacheCleanerDialog } from "../tools/TrainingCacheCleanerDialog";
import { AnimatedPortal } from "../ui/AnimatedPortal";
import { Switch } from "../ui/Switch";

type MenuKey = "file" | "edit" | "annotation" | "view" | "tools" | "settings" | "about";
type DialogKey =
  | "annotationExecution"
  | "promptManagement"
  | "wd14Settings"
  | "settings"
  | "batchAdd"
  | "batchReplace"
  | "batchAnnotationFormatConversion"
  | "batchAnnotationNormalization"
  | "formatValidator"
  | "trainingCacheCleaner"
  | "about";

interface MenuPosition {
  left: number;
  top: number;
}

interface MenuAction {
  type?: "action";
  label: string;
  disabled?: boolean;
  checked?: boolean;
  opensDialog?: boolean;
  onSelect: () => void | Promise<void>;
}

interface MenuSubmenu {
  type: "submenu";
  label: string;
  entries: MenuAction[];
}

interface MenuSeparator {
  type: "separator";
}

type MenuEntry = MenuAction | MenuSubmenu | MenuSeparator;

interface GeminiSettings extends AnnotationPromptSettings {
  model: string;
}

interface Wd14AnnotationProgress {
  start: number;
  contents: string[];
  executionProvider: string;
}

type BatchEditScope = "all" | "selected";
type BatchEditTarget = "annotation" | "instruction" | "both";
type BatchAddPosition = "prefix" | "suffix";

interface BatchAddOptions {
  text: string;
  position: BatchAddPosition;
  scope: BatchEditScope;
  target: BatchEditTarget;
}

interface BatchReplaceOptions {
  find: string;
  replace: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  spaceUnderscore: boolean;
  scope: BatchEditScope;
  target: BatchEditTarget;
}

const menuLabels: Array<{ key: MenuKey; labelKey: string }> = [
  { key: "file", labelKey: "menu.file" },
  { key: "edit", labelKey: "menu.edit" },
  { key: "annotation", labelKey: "menu.annotation" },
  { key: "view", labelKey: "menu.view" },
  { key: "tools", labelKey: "menu.tools" },
  { key: "settings", labelKey: "menu.settings" },
  { key: "about", labelKey: "menu.about" }
];

const annotationCancelledError = "annotation_cancelled";

function formatMenuActionLabel(action: MenuAction) {
  return action.opensDialog ? formatDialogMenuLabel(action.label) : action.label;
}

function isAnnotatableProject(project: DatasetProject | undefined) {
  if (!project) return false;
  return (
    project.id !== "asset-database-group" &&
    project.id !== "database-group" &&
    project.id !== "workspace-folder-group" &&
    project.imageIds.length > 0
  );
}

function getProjectProfileId(
  project: DatasetProject | undefined,
  images: DatasetImage[],
  activeProfileId: number | undefined
) {
  if (!project) return undefined;
  if (project.sourceKind === "folder") {
    const projectImages = images.filter((image) => project.imageIds.includes(image.id));
    const projectProfileIds = new Set(
      projectImages.flatMap((image) => image.annotations.map((annotation) => annotation.profileId))
    );
    if (activeProfileId !== undefined && projectProfileIds.has(activeProfileId)) {
      return activeProfileId;
    }

    return projectImages.at(0)?.annotations.at(0)?.profileId;
  }

  return activeProfileId;
}

function isProfileInProject(
  project: DatasetProject | undefined,
  profileId: number | undefined,
  profiles: { id: number; datasetId?: string }[]
) {
  if (!project || profileId === undefined) return false;
  if (project.sourceKind === "folder") return true;
  return profiles.some(
    (profile) => profile.id === profileId && profile.datasetId === project.datasetId
  );
}

function getImageInstruction(
  image: DatasetImage,
  profileId: number,
  tableDraftProfileId: number | undefined,
  tableInstructionDrafts: Record<number, string>
) {
  if (
    tableDraftProfileId === profileId &&
    Object.prototype.hasOwnProperty.call(tableInstructionDrafts, image.id)
  ) {
    return tableInstructionDrafts[image.id].trim();
  }

  return (
    image.annotations
      .find((annotation) => annotation.profileId === profileId)
      ?.instruction.trim() ?? ""
  );
}

function buildGeminiPrompt(basePrompt: string, imageInstruction: string) {
  const prompt = basePrompt.trim();
  const instruction = imageInstruction.trim();

  if (!instruction) {
    return prompt;
  }

  return prompt ? `${prompt}\n\nAdditional instruction for this image: ${instruction}` : instruction;
}

function hasEffectiveAnnotation(image: DatasetImage, profileId: number | undefined) {
  if (profileId === undefined) {
    return image.annotations.some((annotation) => annotation.content.trim());
  }
  return Boolean(getAnnotationForProfile(image, profileId)?.content.trim());
}

function hasUnsavedChange(
  image: DatasetImage,
  profileId: number | undefined,
  tableDraftProfileId: number | undefined,
  annotationDrafts: Record<number, string>,
  instructionDrafts: Record<number, string>
) {
  if (profileId === undefined || tableDraftProfileId !== profileId) return false;

  const annotation = getAnnotationForProfile(image, profileId);
  return (
    (annotationDrafts[image.id] ?? "") !== (annotation?.content ?? "") ||
    (instructionDrafts[image.id] ?? "") !== (annotation?.instruction ?? "")
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function BatchAddDialog({
  hasSelection,
  onClose,
  onConfirm
}: {
  hasSelection: boolean;
  onClose: () => void;
  onConfirm: (options: BatchAddOptions) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [position, setPosition] = useState<BatchAddPosition>("prefix");
  const [scope, setScope] = useState<BatchEditScope>(hasSelection ? "selected" : "all");
  const [target, setTarget] = useState<BatchEditTarget>("annotation");

  return (
    <AnimatedPortal open>
      <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/16 px-4">
        <form
          className="w-full max-w-[420px] rounded-lg border border-neutral-200 bg-white p-5 shadow-xl"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text) return;
            onConfirm({ text, position, scope, target });
          }}
        >
          <h2 className="m-0 text-[15px] font-semibold leading-6 text-neutral-950">
            {t("batchEdit.addTitle")}
          </h2>
          <label className="mt-4 block">
            <span className="text-[12px] font-medium text-neutral-600">
              {t("batchEdit.text")}
            </span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="batch-edit-textarea glass-input mt-1 h-20 w-full resize-none px-3 py-2"
              autoFocus
            />
          </label>
          <BatchRadioGroup
            title={t("batchEdit.position")}
            value={position}
            options={[
              ["prefix", t("batchEdit.prefix")],
              ["suffix", t("batchEdit.suffix")]
            ]}
            onChange={(value) => setPosition(value as BatchAddPosition)}
          />
          <BatchRadioGroup
            title={t("batchEdit.target")}
            value={target}
            options={[
              ["annotation", t("batchEdit.annotation")],
              ["instruction", t("batchEdit.instruction")],
              ["both", t("batchEdit.both")]
            ]}
            onChange={(value) => setTarget(value as BatchEditTarget)}
          />
          <BatchRadioGroup
            title={t("batchEdit.scope")}
            value={scope}
            options={[
              ["all", t("batchEdit.allRows")],
              ["selected", t("batchEdit.selectedRows"), !hasSelection]
            ]}
            onChange={(value) => setScope(value as BatchEditScope)}
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="h-8 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 transition hover:bg-neutral-50"
              onClick={onClose}
            >
              {t("actions.cancel")}
            </button>
            <button
              type="submit"
              className="h-8 rounded-md bg-neutral-950 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!text}
            >
              {t("actions.apply")}
            </button>
          </div>
        </form>
      </div>
    </AnimatedPortal>
  );
}

function BatchReplaceDialog({
  hasSelection,
  onClose,
  onConfirm
}: {
  hasSelection: boolean;
  onClose: () => void;
  onConfirm: (options: BatchReplaceOptions) => void;
}) {
  const { t } = useTranslation();
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [spaceUnderscore, setSpaceUnderscore] = useState(false);
  const [scope, setScope] = useState<BatchEditScope>(hasSelection ? "selected" : "all");
  const [target, setTarget] = useState<BatchEditTarget>("annotation");

  return (
    <AnimatedPortal open>
      <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/16 px-4">
        <form
          className="w-full max-w-[560px] rounded-lg border border-neutral-200 bg-white shadow-xl"
          onSubmit={(event) => {
            event.preventDefault();
            if (!find) return;
            onConfirm({
              find,
              replace,
              caseSensitive,
              wholeWord,
              spaceUnderscore,
              scope,
              target
            });
          }}
        >
          <div className="border-b border-neutral-100 px-5 py-4">
            <h2 className="m-0 text-[15px] font-semibold leading-6 text-neutral-950">
              {t("batchEdit.replaceTitle")}
            </h2>
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="text-[12px] font-medium text-neutral-600">
                  {t("batchEdit.find")}
                </span>
                <textarea
                  value={find}
                  onChange={(event) => setFind(event.target.value)}
                  className="batch-edit-textarea glass-input mt-1 h-20 w-full resize-none px-3 py-2"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-neutral-600">
                  {t("batchEdit.replace")}
                </span>
                <textarea
                  value={replace}
                  onChange={(event) => setReplace(event.target.value)}
                  className="batch-edit-textarea glass-input mt-1 h-20 w-full resize-none px-3 py-2"
                />
              </label>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <BatchRadioGroup
                className="mt-0"
                title={t("batchEdit.target")}
                value={target}
                options={[
                  ["annotation", t("batchEdit.annotation")],
                  ["instruction", t("batchEdit.instruction")],
                  ["both", t("batchEdit.both")]
                ]}
                onChange={(value) => setTarget(value as BatchEditTarget)}
              />
              <BatchRadioGroup
                className="mt-0"
                title={t("batchEdit.scope")}
                value={scope}
                options={[
                  ["all", t("batchEdit.allRows")],
                  ["selected", t("batchEdit.selectedRows"), !hasSelection]
                ]}
                onChange={(value) => setScope(value as BatchEditScope)}
              />
            </div>

            <fieldset className="mt-4 rounded-lg border border-neutral-200 px-3 py-2.5">
              <legend className="px-1 text-[12px] font-medium text-neutral-500">
                {t("batchEdit.options")}
              </legend>
              <div className="grid grid-cols-3 gap-2">
                <Switch
                  className="batch-edit-switch min-h-8"
                  checked={caseSensitive}
                  label={t("batchEdit.caseSensitive")}
                  onCheckedChange={setCaseSensitive}
                />
                <Switch
                  className="batch-edit-switch min-h-8"
                  checked={wholeWord}
                  label={t("batchEdit.wholeWord")}
                  onCheckedChange={setWholeWord}
                />
                <Switch
                  className="batch-edit-switch min-h-8"
                  checked={spaceUnderscore}
                  label={t("batchEdit.spaceUnderscore")}
                  onCheckedChange={setSpaceUnderscore}
                />
              </div>
            </fieldset>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="h-8 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 transition hover:bg-neutral-50"
                onClick={onClose}
              >
                {t("actions.cancel")}
              </button>
              <button
                type="submit"
                className="h-8 rounded-md bg-neutral-950 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!find}
              >
                {t("actions.apply")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </AnimatedPortal>
  );
}

function BatchRadioGroup({
  title,
  value,
  options,
  onChange,
  className
}: {
  title: string;
  value: string;
  options: Array<[string, string, boolean?]>;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <fieldset className={`mt-4 rounded-lg border border-neutral-200 px-3 py-2.5 ${className ?? ""}`}>
      <legend className="px-1 text-[12px] font-medium text-neutral-500">{title}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map(([optionValue, label, disabled]) => (
          <label key={optionValue} className="inline-flex items-center gap-2 text-[13px] text-neutral-700">
            <input
              type="radio"
              checked={value === optionValue}
              disabled={disabled}
              onChange={() => onChange(optionValue)}
            />
            <span className={disabled ? "text-neutral-400" : ""}>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface TitleMenuBarProps {
  isProjectTreeCollapsed: boolean;
  onToggleProjectTree: () => void;
  onExit: () => void;
}

export function TitleMenuBar({
  isProjectTreeCollapsed,
  onToggleProjectTree,
  onExit
}: TitleMenuBarProps) {
  const { t } = useTranslation();
  const {
    images,
    projects,
    profiles,
    viewFilterMode,
    activeProfileId,
    selectedProjectId,
    selectedImageIds,
    tableDraftProfileId,
    tableAnnotationDrafts,
    tableInstructionDrafts,
    isLoading,
    autoSaveAfterAnnotation,
    autoSaveAfterBatch,
    setAppView,
    setWorkspaceTab,
    addAppLog,
    setViewFilter,
    clearTableSavedCellMarks,
    openImportWizard,
    openExportDialog,
    load,
    applyGeneratedAnnotationDraft,
    applyBatchTableDrafts,
    saveAnnotationChanges,
    markImageAnnotating,
    markTableCellFailed,
    clearTableCellFailure,
  } = useDatasetStore(
    useShallow((state) => ({
      images: state.images,
      projects: state.projects,
      profiles: state.profiles,
      viewFilterMode: state.viewFilterMode,
      activeProfileId: state.activeProfileId,
      selectedProjectId: state.selectedProjectId,
      selectedImageIds: state.selectedImageIds,
      tableDraftProfileId: state.tableDraftProfileId,
      tableAnnotationDrafts: state.tableAnnotationDrafts,
      tableInstructionDrafts: state.tableInstructionDrafts,
      isLoading: state.isLoading,
      autoSaveAfterAnnotation: state.autoSaveAfterAnnotation,
      autoSaveAfterBatch: state.autoSaveAfterBatch,
      setAppView: state.setAppView,
      setWorkspaceTab: state.setWorkspaceTab,
      addAppLog: state.addAppLog,
      setViewFilter: state.setViewFilter,
      clearTableSavedCellMarks: state.clearTableSavedCellMarks,
      openImportWizard: state.openImportWizard,
      openExportDialog: state.openExportDialog,
      load: state.load,
      applyGeneratedAnnotationDraft: state.applyGeneratedAnnotationDraft,
      applyBatchTableDrafts: state.applyBatchTableDrafts,
      saveAnnotationChanges: state.saveAnnotationChanges,
      markImageAnnotating: state.markImageAnnotating,
      markTableCellFailed: state.markTableCellFailed,
      clearTableCellFailure: state.clearTableCellFailure
    }))
  );
  const [openMenu, setOpenMenu] = useState<MenuKey>();
  const [activeSubmenu, setActiveSubmenu] = useState<string>();
  const [dialog, setDialog] = useState<DialogKey | undefined>("about");
  const [isAnnotationRunning, setIsAnnotationRunning] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const annotationCancelRef = useRef(false);
  const selectedProject = findProject(projects, selectedProjectId);
  const getSelectedProjectDisplayName = (project: DatasetProject) =>
    getProjectDisplayName(project, () => t("tree.looseFiles"));
  const selectedProjectPathLabel =
    formatProjectPath(projects, selectedProjectId, getSelectedProjectDisplayName) ??
    (selectedProject ? getSelectedProjectDisplayName(selectedProject) : "");
  const canRunAnnotation = isAnnotatableProject(selectedProject) && !isAnnotationRunning;
  const selectedProjectImageIds = new Set(selectedProject?.imageIds ?? []);
  const selectedTargetImageIds = selectedImageIds.filter((imageId) =>
    selectedProjectImageIds.has(imageId)
  );
  const selectedTargetImageIdSet = new Set(selectedTargetImageIds);
  const selectedProfileId = getProjectProfileId(selectedProject, images, activeProfileId);
  const canBatchEdit =
    selectedProfileId !== undefined &&
    selectedProjectImageIds.size > 0 &&
    isProfileInProject(selectedProject, selectedProfileId, profiles);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        (containerRef.current?.contains(event.target) ||
          dropdownRef.current?.contains(event.target))
      ) {
        return;
      }
      setOpenMenu(undefined);
      setMenuPosition(undefined);
      setActiveSubmenu(undefined);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(undefined);
        setMenuPosition(undefined);
        setActiveSubmenu(undefined);
      }
    };

    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const createFilterImageIds = (mode: ViewFilterMode) => {
    if (mode === "all") return [];

    return images
      .filter((image) => selectedProjectImageIds.size === 0 || selectedProjectImageIds.has(image.id))
      .filter((image) =>
        mode === "unannotated"
          ? !hasEffectiveAnnotation(image, selectedProfileId)
          : hasUnsavedChange(
              image,
              selectedProfileId,
              tableDraftProfileId,
              tableAnnotationDrafts,
              tableInstructionDrafts
            )
      )
      .map((image) => image.id);
  };

  const selectViewFilter = (mode: ViewFilterMode) => {
    setViewFilter(mode, selectedProjectId, createFilterImageIds(mode));
  };

  const getBatchTargetImages = (scope: BatchEditScope) => {
    if (!selectedProject) return [];
    const targetIds =
      scope === "selected"
        ? selectedProject.imageIds.filter((imageId) => selectedTargetImageIdSet.has(imageId))
        : selectedProject.imageIds;
    return targetIds
      .map((imageId) => images.find((image) => image.id === imageId))
      .filter((image): image is DatasetImage => Boolean(image));
  };

  const getCurrentAnnotationDraft = (image: DatasetImage, profileId: number) => {
    if (
      tableDraftProfileId === profileId &&
      Object.prototype.hasOwnProperty.call(tableAnnotationDrafts, image.id)
    ) {
      return tableAnnotationDrafts[image.id] ?? "";
    }
    return getAnnotationForProfile(image, profileId)?.content ?? "";
  };

  const getCurrentInstructionDraft = (image: DatasetImage, profileId: number) => {
    if (
      tableDraftProfileId === profileId &&
      Object.prototype.hasOwnProperty.call(tableInstructionDrafts, image.id)
    ) {
      return tableInstructionDrafts[image.id] ?? "";
    }
    return getAnnotationForProfile(image, profileId)?.instruction ?? "";
  };

  const finalizeBatchChanges = async (
    changes: Array<{ imageId: number; content?: string; instruction?: string }>
  ) => {
    if (selectedProfileId === undefined || changes.length === 0) return;
    applyBatchTableDrafts(selectedProfileId, changes);
    if (!autoSaveAfterBatch) return;
    try {
      await saveAnnotationChanges(
        changes.map((change) => ({
          ...change,
          profileId: selectedProfileId
        }))
      );
    } catch (error) {
      addAppLog(
        t("appLog.batchAutoSaveFailed", { message: formatAppError(error) }),
        "error"
      );
    }
  };

  const applyBatchAdd = async (options: BatchAddOptions) => {
    if (selectedProfileId === undefined) return;
    const changes = getBatchTargetImages(options.scope)
      .map((image) => {
        const draft: { imageId: number; content?: string; instruction?: string } = {
          imageId: image.id
        };

        if (options.target === "annotation" || options.target === "both") {
          const current = getCurrentAnnotationDraft(image, selectedProfileId);
          const next =
            options.position === "prefix" ? `${options.text}${current}` : `${current}${options.text}`;
          if (next !== current) {
            draft.content = next;
          }
        }
        if (options.target === "instruction" || options.target === "both") {
          const current = getCurrentInstructionDraft(image, selectedProfileId);
          const next =
            options.position === "prefix" ? `${options.text}${current}` : `${current}${options.text}`;
          if (next !== current) {
            draft.instruction = next;
          }
        }

        return draft.content !== undefined || draft.instruction !== undefined ? draft : undefined;
      })
      .filter((draft): draft is { imageId: number; content?: string; instruction?: string } =>
        Boolean(draft)
      );

    if (changes.length > 0) {
      await finalizeBatchChanges(changes);
    }
    addAppLog(t("appLog.batchAddComplete", { count: changes.length }));
    setDialog(undefined);
  };

  const applyBatchReplace = async (options: BatchReplaceOptions) => {
    if (selectedProfileId === undefined || !options.find) return;
    let pattern = escapeRegExp(options.find);
    if (options.spaceUnderscore) {
      pattern = pattern.replace(/_/g, "[ _]").replace(/ /g, "[ _]");
    }
    if (options.wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
    const regex = new RegExp(pattern, options.caseSensitive ? "g" : "gi");
    const replaceLiteral = (value: string) => value.replace(regex, () => options.replace);
    const changes = getBatchTargetImages(options.scope)
      .map((image) => {
        const draft: { imageId: number; content?: string; instruction?: string } = {
          imageId: image.id
        };

        if (options.target === "annotation" || options.target === "both") {
          const current = getCurrentAnnotationDraft(image, selectedProfileId);
          const next = replaceLiteral(current);
          if (next !== current) {
            draft.content = next;
          }
        }
        if (options.target === "instruction" || options.target === "both") {
          const current = getCurrentInstructionDraft(image, selectedProfileId);
          const next = replaceLiteral(current);
          if (next !== current) {
            draft.instruction = next;
          }
        }

        return draft.content !== undefined || draft.instruction !== undefined ? draft : undefined;
      })
      .filter((draft): draft is { imageId: number; content?: string; instruction?: string } =>
        Boolean(draft)
      );

    if (changes.length > 0) {
      await finalizeBatchChanges(changes);
    }
    addAppLog(t("appLog.batchReplaceComplete", { count: changes.length }));
    setDialog(undefined);
  };

  const applyAnnotationFormatConversion = async (
    options: BatchAnnotationFormatConversionOptions
  ) => {
    try {
      if (selectedProfileId === undefined) {
        setDialog(undefined);
        return;
      }

      const isBooruTagToAnima =
        options.currentFormat === "booruTag" && options.targetFormat === "anima";
      const isAnimaToBooruTag =
        options.currentFormat === "anima" && options.targetFormat === "booruTag";
      if (!isBooruTagToAnima && !isAnimaToBooruTag) {
        setDialog(undefined);
        return;
      }

      const styleTags = isBooruTagToAnima
        ? new Set(await invokeCommand<string[]>("list_danbooru_style_tags"))
        : undefined;
      setWorkspaceTab("table");

      const changes = getBatchTargetImages("all")
        .map((image) => {
          const current = getCurrentAnnotationDraft(image, selectedProfileId);
          const next = isBooruTagToAnima
            ? convertBooruTagToAnima(
                current,
                styleTags ?? new Set<string>(),
                options.qualityWordPlacement
              )
            : convertAnimaToBooruTag(current);

          return next !== current
            ? {
                imageId: image.id,
                content: next
              }
            : undefined;
        })
        .filter((draft): draft is { imageId: number; content: string } => Boolean(draft));

      if (changes.length > 0) {
        await finalizeBatchChanges(changes);
      }
      addAppLog(t("appLog.annotationFormatConversionComplete", { count: changes.length }));
      setDialog(undefined);
    } catch (error) {
      addAppLog(t("appLog.menuActionFailed", { message: formatAppError(error) }), "error");
    }
  };

  const applyBatchAnnotationNormalization = async (
    options: AnnotationNormalizationOptions
  ) => {
    if (selectedProfileId === undefined) {
      setDialog(undefined);
      return;
    }

    setWorkspaceTab("table");
    const changes = getBatchTargetImages("all")
      .map((image) => {
        const current = getCurrentAnnotationDraft(image, selectedProfileId);
        const next = normalizeAnnotation(current, options);

        return next !== current
          ? {
              imageId: image.id,
              content: next
            }
          : undefined;
      })
      .filter((draft): draft is { imageId: number; content: string } => Boolean(draft));

    if (changes.length > 0) {
      await finalizeBatchChanges(changes);
    }
    addAppLog(t("appLog.batchAnnotationNormalizationComplete", { count: changes.length }));
    setDialog(undefined);
  };

  const menus: Record<MenuKey, MenuEntry[]> = {
    file: [
      {
        label: t("menu.importDataset"),
        disabled: isLoading,
        opensDialog: true,
        onSelect: openImportWizard
      },
      {
        label: t("menu.exportTxt"),
        disabled: images.length === 0 || isLoading,
        opensDialog: true,
        onSelect: openExportDialog
      },
      {
        label: t("menu.refresh"),
        disabled: isLoading,
        onSelect: load
      },
      { type: "separator" },
      {
        label: t("menu.exit"),
        onSelect: onExit
      }
    ],
    edit: [
      {
        label: t("menu.batchAdd"),
        disabled: !canBatchEdit,
        opensDialog: true,
        onSelect: () => setDialog("batchAdd")
      },
      {
        label: t("menu.batchReplace"),
        disabled: !canBatchEdit,
        opensDialog: true,
        onSelect: () => setDialog("batchReplace")
      },
      {
        label: t("menu.batchAnnotationFormatConversion"),
        disabled: !canBatchEdit,
        opensDialog: true,
        onSelect: () => setDialog("batchAnnotationFormatConversion")
      },
      {
        label: t("menu.batchAnnotationNormalization"),
        disabled: !canBatchEdit,
        opensDialog: true,
        onSelect: () => setDialog("batchAnnotationNormalization")
      }
    ],
    annotation: [
      {
        label: t("menu.executeAnnotation"),
        disabled: !canRunAnnotation,
        opensDialog: true,
        onSelect: () => setDialog("annotationExecution")
      },
      {
        label: t("menu.stopAnnotation"),
        disabled: !isAnnotationRunning,
        onSelect: () => {
          annotationCancelRef.current = true;
          setIsAnnotationRunning(false);
          addAppLog(t("appLog.annotationStopped"), "warning");
        }
      },
      { type: "separator" },
      {
        label: t("menu.promptManagement"),
        opensDialog: true,
        onSelect: () => setDialog("promptManagement")
      },
      {
        label: t("menu.wd14Settings"),
        opensDialog: true,
        onSelect: () => setDialog("wd14Settings")
      }
    ],
    view: [
      {
        label: isProjectTreeCollapsed ? t("menu.expandFileTree") : t("menu.collapseFileTree"),
        onSelect: onToggleProjectTree
      },
      { type: "separator" },
      {
        label: t("menu.initialPage"),
        onSelect: () => setAppView("initial")
      },
      {
        label: t("menu.logPage"),
        onSelect: () => setAppView("logs")
      },
      {
        type: "submenu",
        label: t("menu.filterView"),
        entries: [
          {
            label: t("menu.filterUnannotated"),
            checked: viewFilterMode === "unannotated",
            onSelect: () => selectViewFilter("unannotated")
          },
          {
            label: t("menu.filterUnsaved"),
            checked: viewFilterMode === "unsaved",
            onSelect: () => selectViewFilter("unsaved")
          },
          {
            label: t("menu.filterAll"),
            checked: viewFilterMode === "all",
            onSelect: () => selectViewFilter("all")
          }
        ]
      },
      { type: "separator" },
      {
        label: t("menu.clearSavedMarks"),
        onSelect: () => {
          clearTableSavedCellMarks();
          addAppLog(t("appLog.savedMarksCleared"));
        }
      }
    ],
    tools: [
      {
        label: t("menu.trainingCacheCleaner"),
        opensDialog: true,
        onSelect: () => setDialog("trainingCacheCleaner")
      },
      { type: "separator" },
      {
        type: "submenu",
        label: t("menu.datasetDebug"),
        entries: [
          {
            label: t("menu.formatValidator"),
            opensDialog: true,
            onSelect: () => setDialog("formatValidator")
          }
        ]
      }
    ],
    settings: [
      {
        label: t("menu.settings"),
        opensDialog: true,
        onSelect: () => setDialog("settings")
      }
    ],
    about: [
      {
        label: "Datasets Deputy",
        opensDialog: true,
        onSelect: () => setDialog("about")
      }
    ]
  };

  const selectAction = (action: MenuAction) => {
    if (action.disabled) return;
    setOpenMenu(undefined);
    setMenuPosition(undefined);
    setActiveSubmenu(undefined);
    Promise.resolve(action.onSelect()).catch((error) => {
      addAppLog(t("appLog.menuActionFailed", { message: formatAppError(error) }), "error");
    });
  };

  const getAnnotationTargetCount = (
    scope: AnnotationExecutionScope,
    selectedProfileId: number | undefined
  ) => {
    const hasEffectiveAnnotation = (imageId: number) => {
      const image = images.find((item) => item.id === imageId);
      if (!image) return false;
      if (selectedProfileId !== undefined && tableDraftProfileId === selectedProfileId) {
        return Boolean(tableAnnotationDrafts[imageId]?.trim());
      }
      if (image.sourceKind === "folder") {
        return image.annotations.some((annotation) => annotation.content.trim());
      }
      return image.annotations.some(
        (annotation) =>
          annotation.profileId === selectedProfileId && annotation.content.trim()
      );
    };

    if (scope === "selected") {
      return selectedTargetImageIds.length;
    }
    if (scope === "empty") {
      return selectedProject?.imageIds.filter((imageId) => !hasEffectiveAnnotation(imageId)).length ?? 0;
    }
    return selectedProject?.imageIds.length ?? 0;
  };

  const getAnnotationTargets = (
    scope: AnnotationExecutionScope,
    conflictStrategy: AnnotationConflictStrategy,
    selectedProfileId: number | undefined
  ) => {
    if (!selectedProject) return [];
    const hasEffectiveAnnotation = (image: (typeof images)[number]) => {
      if (selectedProfileId !== undefined && tableDraftProfileId === selectedProfileId) {
        return Boolean(tableAnnotationDrafts[image.id]?.trim());
      }
      if (image.sourceKind === "folder") {
        return image.annotations.some((annotation) => annotation.content.trim());
      }
      return image.annotations.some(
        (annotation) =>
          annotation.profileId === selectedProfileId && annotation.content.trim()
      );
    };

    return selectedProject.imageIds
      .filter((imageId) =>
        scope === "selected" ? selectedTargetImageIdSet.has(imageId) : true
      )
      .map((imageId) => images.find((image) => image.id === imageId))
      .filter((image) => {
        if (!image) return false;
        if (scope === "empty") {
          return !hasEffectiveAnnotation(image);
        }
        if (conflictStrategy === "skip") {
          return !hasEffectiveAnnotation(image);
        }
        return true;
      });
  };

  const toggleMenu = (menu: MenuKey, button: HTMLButtonElement) => {
    if (menus[menu].length === 0) {
      setOpenMenu(undefined);
      setMenuPosition(undefined);
      setActiveSubmenu(undefined);
      return;
    }

    if (openMenu === menu) {
      setOpenMenu(undefined);
      setMenuPosition(undefined);
      setActiveSubmenu(undefined);
      return;
    }

    const rect = button.getBoundingClientRect();
    setMenuPosition({
      left: Math.min(rect.left, window.innerWidth - 188),
      top: rect.bottom + 4
    });
    setActiveSubmenu(undefined);
    setOpenMenu(menu);
  };

  const startAnnotation = async (options: {
    mode: AnnotationExecutionMode;
    scope: AnnotationExecutionScope;
    conflictStrategy: AnnotationConflictStrategy;
  }) => {
    setDialog(undefined);
    annotationCancelRef.current = false;
    setIsAnnotationRunning(true);

    const selectedProfileId = getProjectProfileId(selectedProject, images, activeProfileId);
    const hasValidProfile = isProfileInProject(selectedProject, selectedProfileId, profiles);
    const targetCount = getAnnotationTargetCount(options.scope, selectedProfileId);
    const scopeLabel =
      options.scope === "selected"
        ? t("appLog.annotationScopeSelected")
        : options.scope === "all"
        ? t("appLog.annotationScopeAll")
        : t("appLog.annotationScopeEmpty");
    const conflictLabel =
      options.conflictStrategy === "overwrite"
        ? t("annotationRun.conflictOverwrite")
        : t("annotationRun.conflictSkip");
    addAppLog(t("appLog.annotationRequested"));
    addAppLog(
      t("appLog.annotationDataset", {
        name: selectedProject
          ? getSelectedProjectDisplayName(selectedProject)
          : t("appLog.unknownDataset")
      })
    );
    addAppLog(t("appLog.annotationScope", { scope: scopeLabel }));
    addAppLog(t("appLog.annotationConflict", { strategy: conflictLabel }));
    addAppLog(
      t("appLog.annotationMode", {
        mode: options.mode === "gemini" ? t("annotationRun.modeGemini") : t("annotationRun.modeWd14")
      })
    );
    addAppLog(t("appLog.annotationTargetImages", { count: targetCount }));
    addAppLog(t("appLog.annotationProfile", { profile: selectedProfileId ?? t("appLog.none") }));
    if (options.scope === "selected" && selectedTargetImageIds.length === 0) {
      addAppLog(t("appLog.annotationNoSelection"), "warning");
      setIsAnnotationRunning(false);
      return;
    } else if (targetCount === 0) {
      addAppLog(t("appLog.annotationNoTargets"), "warning");
      setIsAnnotationRunning(false);
      return;
    }

    if (!hasTauriRuntime()) {
      addAppLog(t("appLog.annotationTauriRequired"), "error");
      setIsAnnotationRunning(false);
      return;
    }
    if (selectedProfileId === undefined || !hasValidProfile) {
      addAppLog(t("appLog.annotationProfileRequired"), "error");
      setIsAnnotationRunning(false);
      return;
    }

    const targets = getAnnotationTargets(
      options.scope,
      options.conflictStrategy,
      selectedProfileId
    ).filter((image): image is DatasetImage => Boolean(image));
    addAppLog(`Filtered annotation targets: ${targets.length}`);
    const generatedChanges: AnnotationChange[] = [];
    const failedAnnotationImageIds = new Set<number>();

    const applyGeneratedContent = (image: DatasetImage, content: string) => {
      clearTableCellFailure(`${image.id}:annotation`);
      applyGeneratedAnnotationDraft(selectedProfileId, image.id, content);
      generatedChanges.push({
        imageId: image.id,
        profileId: selectedProfileId,
        content
      });
    };

    const saveGeneratedChanges = async () => {
      if (!autoSaveAfterAnnotation) return;

      const successfulChanges = generatedChanges.filter(
        (change) => !failedAnnotationImageIds.has(change.imageId)
      );
      if (successfulChanges.length === 0) return;
      if (successfulChanges.length !== generatedChanges.length) {
        addAppLog(
          `Auto-save skipped ${generatedChanges.length - successfulChanges.length} failed annotations.`,
          "warning"
        );
      }

      await saveAnnotationChanges(successfulChanges);
      addAppLog(`Auto-saved generated annotations: ${successfulChanges.length}`);
    };

    const markAnnotationFailed = (image: DatasetImage) => {
      failedAnnotationImageIds.add(image.id);
      markTableCellFailed(`${image.id}:annotation`);
    };

    const markUnfinishedAnnotationsFailed = () => {
      const generatedImageIds = new Set(generatedChanges.map((change) => change.imageId));
      for (const image of targets) {
        if (!generatedImageIds.has(image.id) && !failedAnnotationImageIds.has(image.id)) {
          markAnnotationFailed(image);
        }
      }
    };

    const markWd14MissingResultsFailed = (generatedContents: Array<string | undefined>) => {
      for (const [index, image] of targets.entries()) {
        if (generatedContents[index] === undefined) {
          markAnnotationFailed(image);
        }
      }
    };

    try {
      if (options.mode === "wd14") {
        for (const image of targets) {
          markImageAnnotating(image.id, true);
        }
        const generatedContents = new Array<string | undefined>(targets.length);
        let loggedWd14Provider = "";
        let unlistenWd14Progress: UnlistenFn | undefined;
        try {
          addAppLog(`WD14 batch inference started: ${targets.length} images.`);
          unlistenWd14Progress = await listen<Wd14AnnotationProgress>(
            "wd14-annotation-progress",
            (event) => {
              if (annotationCancelRef.current) return;
              const { start, contents, executionProvider } = event.payload;
              if (executionProvider && executionProvider !== loggedWd14Provider) {
                loggedWd14Provider = executionProvider;
                addAppLog(`WD14 execution provider: ${executionProvider}`);
              }
              for (const [offset, content] of contents.entries()) {
                const index = start + offset;
                const image = targets[index];
                if (!image) continue;
                generatedContents[index] = content;
                applyGeneratedContent(image, content);
                markImageAnnotating(image.id, false);
                addAppLog(`Generated draft annotation: ${image.fileName}`);
              }
            }
          );
          const contents = await invokeCommand<string[]>("generate_wd14_annotations", {
            imagePaths: targets.map((image) => image.storagePath ?? image.path)
          });
          if (contents.length !== targets.length) {
            markWd14MissingResultsFailed(generatedContents);
            throw new Error(`WD14 returned ${contents.length} results for ${targets.length} images.`);
          }
          if (annotationCancelRef.current) {
            addAppLog("Discarded WD14 results returned after cancellation.", "warning");
            throw new Error(annotationCancelledError);
          }
          for (const [index, image] of targets.entries()) {
            const content = contents[index] ?? "";
            if (generatedContents[index] === undefined) {
              applyGeneratedContent(image, content);
              addAppLog(`Generated draft annotation: ${image.fileName}`);
            }
          }
        } catch (error) {
          if (!annotationCancelRef.current) {
            markWd14MissingResultsFailed(generatedContents);
          }
          throw error;
        } finally {
          unlistenWd14Progress?.();
          for (const image of targets) {
            markImageAnnotating(image.id, false);
          }
        }
        addAppLog(`WD14 annotation completed: processed ${targets.length} images.`);
        await saveGeneratedChanges();
        return;
      }

      const prompt = generateAnnotationPrompt(
        await invokeCommand<GeminiSettings>("get_gemini_settings")
      );

      for (const image of targets) {
        if (annotationCancelRef.current) {
          addAppLog("Annotation task stopped.", "warning");
          throw new Error(annotationCancelledError);
        }
        addAppLog(`Annotating: ${image.fileName}`);
        markImageAnnotating(image.id, true);
        try {
          const imagePath = image.storagePath ?? image.path;
          const content = await invokeCommand<string>("generate_gemini_annotation", {
            imagePath,
            prompt: buildGeminiPrompt(
              prompt,
              getImageInstruction(
                image,
                selectedProfileId,
                tableDraftProfileId,
                tableInstructionDrafts
              )
            )
          });
          if (annotationCancelRef.current) {
            addAppLog(`Discarded annotation returned after cancellation: ${image.fileName}`, "warning");
            throw new Error(annotationCancelledError);
          }
          applyGeneratedContent(image, content);
          addAppLog(`Generated draft annotation: ${image.fileName}`);
        } catch (error) {
          const message = formatAppError(error);
          if (message === annotationCancelledError) {
            throw error;
          }
          markAnnotationFailed(image);
          addAppLog(`Annotation failed: ${image.fileName}: ${message}`, "error");
        } finally {
          markImageAnnotating(image.id, false);
        }
      }

      addAppLog(`Annotation completed: processed ${targets.length} images.`);
      if (annotationCancelRef.current) {
        return;
      }
      await saveGeneratedChanges();
    } catch (error) {
      const message = formatAppError(error);
      if (message === annotationCancelledError) {
        return;
      }
      markUnfinishedAnnotationsFailed();
      addAppLog(`Annotation task failed: ${message}`, "error");
    } finally {
      annotationCancelRef.current = false;
      setIsAnnotationRunning(false);
    }
  };

  return (
    <>
      <nav
        ref={containerRef}
        className="no-drag relative flex h-10 items-center gap-1"
        aria-label="Application menu"
      >
        {menuLabels.map((menu) => (
          <div key={menu.key} className="relative">
            <button
              type="button"
              className={`title-menu-button h-7 rounded-md px-3 text-[12px] font-medium leading-7 transition ${
                openMenu === menu.key
                  ? "bg-neutral-900/8 text-black"
                  : "text-black/78 hover:bg-neutral-900/6 hover:text-black"
              }`}
              onClick={(event) => toggleMenu(menu.key, event.currentTarget)}
            >
              {t(menu.labelKey)}
            </button>
          </div>
        ))}
      </nav>

      {openMenu && menuPosition && menus[openMenu].length > 0
        ? createPortal(
        <div
          ref={dropdownRef}
          className="app-dropdown-menu no-drag fixed z-50 min-w-[180px] rounded-lg py-2"
          style={{ left: menuPosition.left, top: menuPosition.top }}
        >
          <div className="app-dropdown-backdrop" />
          {menus[openMenu].map((entry, index) =>
            entry.type === "separator" ? (
              <div
                key={`${openMenu}-separator-${index}`}
                className="app-dropdown-separator my-1.5 h-px bg-neutral-200/90"
              />
            ) : entry.type === "submenu" ? (
              <div
                key={entry.label}
                className="relative"
                onMouseEnter={() => setActiveSubmenu(entry.label)}
              >
                <button
                  type="button"
                  className="app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[12px] font-medium leading-4 text-neutral-700 transition hover:bg-neutral-100"
                  onClick={() =>
                    setActiveSubmenu((current) =>
                      current === entry.label ? undefined : entry.label
                    )
                  }
                >
                  <span className="flex w-4 shrink-0 justify-center" />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  <ChevronRight size={14} className="shrink-0 text-neutral-400" />
                </button>
                {activeSubmenu === entry.label ? (
                  <div className="app-dropdown-menu no-drag absolute left-[calc(100%-4px)] top-0 z-[60] min-w-[180px] rounded-lg py-2">
                    <div className="app-dropdown-backdrop" />
                    {entry.entries.map((subEntry) => (
                      <button
                        key={subEntry.label}
                        type="button"
                        className="app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[12px] font-medium leading-4 text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"
                        disabled={subEntry.disabled}
                        onClick={() => selectAction(subEntry)}
                      >
                        <span className="flex w-4 shrink-0 justify-center">
                          {subEntry.checked ? <Check size={14} /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {formatMenuActionLabel(subEntry)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                key={entry.label}
                type="button"
                className="app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[12px] font-medium leading-4 text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-400 disabled:hover:bg-transparent"
                disabled={entry.disabled}
                onClick={() => selectAction(entry)}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {entry.checked ? <Check size={14} /> : null}
                </span>
                <span className="truncate">{formatMenuActionLabel(entry)}</span>
              </button>
            )
          )}
        </div>,
          document.body
        )
        : null}

      {dialog === "settings" ? <SettingsDialog onClose={() => setDialog(undefined)} /> : null}
      {dialog === "batchAdd" ? (
        <BatchAddDialog
          hasSelection={selectedTargetImageIds.length > 0}
          onClose={() => setDialog(undefined)}
          onConfirm={applyBatchAdd}
        />
      ) : null}
      {dialog === "batchReplace" ? (
        <BatchReplaceDialog
          hasSelection={selectedTargetImageIds.length > 0}
          onClose={() => setDialog(undefined)}
          onConfirm={applyBatchReplace}
        />
      ) : null}
      {dialog === "batchAnnotationFormatConversion" ? (
        <BatchAnnotationFormatConversionDialog
          onClose={() => setDialog(undefined)}
          onConfirm={applyAnnotationFormatConversion}
        />
      ) : null}
      {dialog === "batchAnnotationNormalization" ? (
        <BatchAnnotationNormalizationDialog
          onClose={() => setDialog(undefined)}
          onConfirm={applyBatchAnnotationNormalization}
        />
      ) : null}
      {dialog === "annotationExecution" && selectedProject ? (
        <AnnotationExecutionDialog
          datasetName={selectedProject.name}
          datasetPathLabel={selectedProjectPathLabel}
          hasSelectedImage={selectedTargetImageIds.length > 0}
          selectedImageCount={selectedTargetImageIds.length}
          onClose={() => setDialog(undefined)}
          onConfirm={startAnnotation}
        />
      ) : null}
      {dialog === "promptManagement" ? (
        <PromptManagementDialog onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog === "wd14Settings" ? (
        <Wd14TaggerSettingsDialog onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog === "formatValidator" ? (
        <FormatValidatorDialog onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog === "trainingCacheCleaner" ? (
        <TrainingCacheCleanerDialog onClose={() => setDialog(undefined)} />
      ) : null}

      <AnimatedPortal open={dialog === "about"}>
        {dialog === "about" ? (
        <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/16 px-5">
          <div className="w-full max-w-[460px] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.18)]">
            <header className="border-b border-neutral-200 px-5 py-4">
              <h2 className="m-0 text-[16px] font-semibold text-neutral-950">
                Datasets Deputy
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-neutral-600">
                {t("menu.aboutBody")}
              </p>
            </header>

            <div className="px-5 py-4">
              <dl className="m-0 grid grid-cols-[72px_minmax(0,1fr)] gap-x-4 gap-y-3 text-[13px]">
                <dt className="text-neutral-500">{t("menu.versionLabel")}</dt>
                <dd className="m-0 font-medium text-neutral-900">{t("menu.version")}</dd>

                <dt className="text-neutral-500">{t("menu.authorLabel")}</dt>
                <dd className="m-0 text-neutral-900">{t("menu.author")}</dd>

                <dt className="text-neutral-500">{t("menu.projectLabel")}</dt>
                <dd className="m-0 min-w-0">
                  <a
                    className="break-all text-neutral-900 underline decoration-neutral-300 underline-offset-2 transition hover:decoration-neutral-700"
                    href="https://github.com/Aeka0/DatasetsDeputy"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("menu.project")}
                  </a>
                </dd>

                <dt className="text-neutral-500">{t("menu.licenseLabel")}</dt>
                <dd className="m-0 text-neutral-900">{t("menu.license")}</dd>
              </dl>

              <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-900">
                {t("menu.developmentNotice")}
              </p>
            </div>

            <footer className="flex justify-end border-t border-neutral-200 px-5 py-4">
              <button
                type="button"
                className="h-8 rounded-md bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800"
                onClick={() => setDialog(undefined)}
              >
                {t("menu.close")}
              </button>
            </footer>
          </div>
        </div>
        ) : null}
      </AnimatedPortal>
    </>
  );
}
