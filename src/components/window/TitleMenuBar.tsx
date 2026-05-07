import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  generateAnnotationPrompt,
  type AnnotationPromptSettings
} from "../../lib/annotationPrompt";
import { formatAppError } from "../../lib/errors";
import { hasTauriRuntime } from "../../lib/tauri";
import { invokeCommand } from "../../lib/tauri";
import { useDatasetStore, type ViewFilterMode } from "../../stores/datasetStore";
import type { AnnotationChange, DatasetImage, DatasetProject } from "../../types";
import {
  AnnotationExecutionDialog,
  type AnnotationExecutionMode,
  type AnnotationConflictStrategy,
  type AnnotationExecutionScope
} from "../annotation/AnnotationExecutionDialog";
import { PromptManagementDialog } from "../annotation/PromptManagementDialog";
import { Wd14TaggerSettingsDialog } from "../annotation/Wd14TaggerSettingsDialog";
import { SettingsDialog } from "../settings/SettingsDialog";
import { FormatValidatorDialog } from "../tools/FormatValidatorDialog";

type MenuKey = "file" | "edit" | "annotation" | "view" | "tools" | "settings" | "about";
type DialogKey =
  | "annotationExecution"
  | "promptManagement"
  | "wd14Settings"
  | "settings"
  | "formatValidator"
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

function findProject(projects: DatasetProject[], id?: string): DatasetProject | undefined {
  if (!id) return undefined;

  for (const project of projects) {
    if (project.id === id) {
      return project;
    }
    const child = findProject(project.children ?? [], id);
    if (child) {
      return child;
    }
  }

  return undefined;
}

function findProjectPath(
  projects: DatasetProject[],
  id?: string,
  trail: DatasetProject[] = []
): DatasetProject[] | undefined {
  if (!id) return undefined;

  for (const project of projects) {
    const nextTrail = [...trail, project];
    if (project.id === id) {
      return nextTrail;
    }
    const childPath = findProjectPath(project.children ?? [], id, nextTrail);
    if (childPath) {
      return childPath;
    }
  }

  return undefined;
}

function formatProjectPath(projects: DatasetProject[], id?: string) {
  return findProjectPath(projects, id)
    ?.map((project) => project.name)
    .filter(Boolean)
    .join(" / ");
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

function getAnnotationForProfile(image: DatasetImage, profileId: number | undefined) {
  if (profileId === undefined) return undefined;
  return image.annotations.find((annotation) => annotation.profileId === profileId);
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
    search,
    viewFilterMode,
    activeProfileId,
    selectedProjectId,
    selectedImageIds,
    previewImageId,
    tableDraftProfileId,
    tableAnnotationDrafts,
    tableInstructionDrafts,
    isLoading,
    autoSaveAfterAnnotation,
    setAppView,
    addAppLog,
    setViewFilter,
    clearTableSavedCellMarks,
    openImportWizard,
    openExportDialog,
    load,
    closeImagePreview,
    applyGeneratedAnnotationDraft,
    saveAnnotationChanges,
    markImageAnnotating,
    setSearch
  } = useDatasetStore();
  const [openMenu, setOpenMenu] = useState<MenuKey>();
  const [activeSubmenu, setActiveSubmenu] = useState<string>();
  const [dialog, setDialog] = useState<DialogKey>();
  const [isAnnotationRunning, setIsAnnotationRunning] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const annotationCancelRef = useRef(false);
  const selectedProject = findProject(projects, selectedProjectId);
  const selectedProjectPathLabel =
    formatProjectPath(projects, selectedProjectId) ?? selectedProject?.name ?? "";
  const canRunAnnotation = isAnnotatableProject(selectedProject) && !isAnnotationRunning;
  const selectedProjectImageIds = new Set(selectedProject?.imageIds ?? []);
  const selectedTargetImageIds = selectedImageIds.filter((imageId) =>
    selectedProjectImageIds.has(imageId)
  );
  const selectedTargetImageIdSet = new Set(selectedTargetImageIds);
  const selectedProfileId = getProjectProfileId(selectedProject, images, activeProfileId);

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

  const menus: Record<MenuKey, MenuEntry[]> = {
    file: [
      {
        label: t("menu.importDataset"),
        disabled: isLoading,
        onSelect: openImportWizard
      },
      {
        label: t("menu.exportTxt"),
        disabled: images.length === 0 || isLoading,
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
        label: t("menu.backToGrid"),
        disabled: !previewImageId,
        onSelect: closeImagePreview
      },
      {
        label: t("menu.clearSearch"),
        disabled: !search,
        onSelect: () => setSearch("")
      }
    ],
    annotation: [
      {
        label: t("menu.executeAnnotation"),
        disabled: !canRunAnnotation,
        onSelect: () => setDialog("annotationExecution")
      },
      {
        label: t("menu.stopAnnotation"),
        disabled: !isAnnotationRunning,
        onSelect: () => {
          annotationCancelRef.current = true;
          setIsAnnotationRunning(false);
          addAppLog("用户已停止标注任务。", "warning");
        }
      },
      { type: "separator" },
      {
        label: t("menu.promptManagement"),
        onSelect: () => setDialog("promptManagement")
      },
      {
        label: t("menu.wd14Settings"),
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
          addAppLog("已清理保存标记。");
        }
      }
    ],
    tools: [
      {
        type: "submenu",
        label: t("menu.datasetDebug"),
        entries: [
          {
            label: t("menu.formatValidator"),
            onSelect: () => setDialog("formatValidator")
          }
        ]
      }
    ],
    settings: [
      {
        label: t("menu.settings"),
        onSelect: () => setDialog("settings")
      }
    ],
    about: [
      {
        label: "Datasets Deputy",
        onSelect: () => setDialog("about")
      }
    ]
  };

  const selectAction = (action: MenuAction) => {
    if (action.disabled) return;
    setOpenMenu(undefined);
    setMenuPosition(undefined);
    setActiveSubmenu(undefined);
    void action.onSelect();
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
      options.scope === "selected" ? "选中图片" : options.scope === "all" ? "所有图片" : "无标图片";
    const conflictLabel = options.conflictStrategy === "overwrite" ? "覆盖" : "跳过";
    addAppLog("已请求执行标注。");
    addAppLog(`数据集：${selectedProject?.name ?? "未知数据集"}`);
    addAppLog(`标注范围：${scopeLabel}`);
    addAppLog(`冲突策略：${conflictLabel}`);
    addAppLog(
      `标注模式：${
        options.mode === "gemini" ? t("annotationRun.modeGemini") : t("annotationRun.modeWd14")
      }`
    );
    addAppLog(`目标图片：${targetCount}`);
    addAppLog(`标注类型：${selectedProfileId ?? "无"}`);
    if (options.scope === "selected" && selectedTargetImageIds.length === 0) {
      addAppLog("未选中任何图片，无法开始标注。", "warning");
      setIsAnnotationRunning(false);
      return;
    } else if (targetCount === 0) {
      addAppLog("没有图片符合当前标注范围。", "warning");
      setIsAnnotationRunning(false);
      return;
    }

    if (!hasTauriRuntime()) {
      addAppLog("标注任务需要在 Tauri 桌面环境中运行。", "error");
      setIsAnnotationRunning(false);
      return;
    }
    if (selectedProfileId === undefined || !hasValidProfile) {
      addAppLog("未选择当前数据集的标注类型，无法开始标注。", "error");
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

    const applyGeneratedContent = (image: DatasetImage, content: string) => {
      applyGeneratedAnnotationDraft(selectedProfileId, image.id, content);
      generatedChanges.push({
        imageId: image.id,
        profileId: selectedProfileId,
        content
      });
    };

    const saveGeneratedChanges = async () => {
      if (!autoSaveAfterAnnotation || generatedChanges.length === 0) return;

      await saveAnnotationChanges(generatedChanges);
      addAppLog(`Auto-saved generated annotations: ${generatedChanges.length}`);
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
                  ? "bg-slate-900/8 text-black"
                  : "text-black/78 hover:bg-slate-900/6 hover:text-black"
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
                className="app-dropdown-separator my-1.5 h-px bg-slate-200/90"
              />
            ) : entry.type === "submenu" ? (
              <div
                key={entry.label}
                className="relative"
                onMouseEnter={() => setActiveSubmenu(entry.label)}
              >
                <button
                  type="button"
                  className="app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[12px] font-medium leading-4 text-slate-700 transition hover:bg-slate-100"
                  onClick={() =>
                    setActiveSubmenu((current) =>
                      current === entry.label ? undefined : entry.label
                    )
                  }
                >
                  <span className="flex w-4 shrink-0 justify-center" />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  <ChevronRight size={14} className="shrink-0 text-slate-400" />
                </button>
                {activeSubmenu === entry.label ? (
                  <div className="app-dropdown-menu no-drag absolute left-[calc(100%-4px)] top-0 z-[60] min-w-[180px] rounded-lg py-2">
                    <div className="app-dropdown-backdrop" />
                    {entry.entries.map((subEntry) => (
                      <button
                        key={subEntry.label}
                        type="button"
                        className="app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[12px] font-medium leading-4 text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                        disabled={subEntry.disabled}
                        onClick={() => selectAction(subEntry)}
                      >
                        <span className="flex w-4 shrink-0 justify-center">
                          {subEntry.checked ? <Check size={14} /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{subEntry.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                key={entry.label}
                type="button"
                className="app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[12px] font-medium leading-4 text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                disabled={entry.disabled}
                onClick={() => selectAction(entry)}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {entry.checked ? <Check size={14} /> : null}
                </span>
                <span className="truncate">{entry.label}</span>
              </button>
            )
          )}
        </div>,
          document.body
        )
        : null}

      {dialog === "settings" ? <SettingsDialog onClose={() => setDialog(undefined)} /> : null}
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

      {dialog === "about"
        ? createPortal(
        <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-slate-950/16">
          <div className="w-[360px] rounded-md border border-slate-200 bg-white p-5">
            <h2 className="m-0 text-base font-semibold text-slate-900">
              Datasets Deputy
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {t("menu.aboutBody")}
            </p>
            <div className="mt-3 text-xs text-slate-400">{t("menu.version")}</div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white transition hover:bg-slate-800"
                onClick={() => setDialog(undefined)}
              >
                {t("menu.close")}
              </button>
            </div>
          </div>
        </div>,
          document.body
        )
        : null}
    </>
  );
}
