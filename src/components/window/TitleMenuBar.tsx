import { getCurrentWindow } from "@tauri-apps/api/window";
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
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetImage, DatasetProject } from "../../types";
import {
  AnnotationExecutionDialog,
  type AnnotationExecutionMode,
  type AnnotationConflictStrategy,
  type AnnotationExecutionScope
} from "../annotation/AnnotationExecutionDialog";
import { PromptManagementDialog } from "../annotation/PromptManagementDialog";
import { Wd14TaggerSettingsDialog } from "../annotation/Wd14TaggerSettingsDialog";
import { SettingsDialog } from "../settings/SettingsDialog";

type MenuKey = "file" | "edit" | "annotation" | "view" | "settings" | "about";
type DialogKey =
  | "annotationExecution"
  | "promptManagement"
  | "wd14Settings"
  | "settings"
  | "about";

interface MenuPosition {
  left: number;
  top: number;
}

interface MenuAction {
  type?: "action";
  label: string;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

interface MenuSeparator {
  type: "separator";
}

type MenuEntry = MenuAction | MenuSeparator;

interface GeminiSettings extends AnnotationPromptSettings {
  model: string;
}

const menuLabels: Array<{ key: MenuKey; labelKey: string }> = [
  { key: "file", labelKey: "menu.file" },
  { key: "edit", labelKey: "menu.edit" },
  { key: "annotation", labelKey: "menu.annotation" },
  { key: "view", labelKey: "menu.view" },
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
    project.id !== "database-group" &&
    project.id !== "workspace-folder-group" &&
    project.imageIds.length > 0
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

interface TitleMenuBarProps {
  isProjectTreeCollapsed: boolean;
  onToggleProjectTree: () => void;
}

export function TitleMenuBar({
  isProjectTreeCollapsed,
  onToggleProjectTree
}: TitleMenuBarProps) {
  const { t } = useTranslation();
  const {
    images,
    projects,
    profiles,
    search,
    activeProfileId,
    selectedProjectId,
    selectedImageIds,
    previewImageId,
    tableDraftProfileId,
    tableAnnotationDrafts,
    tableInstructionDrafts,
    isLoading,
    setAppView,
    addAppLog,
    clearTableSavedCellMarks,
    openImportWizard,
    exportDataset,
    load,
    closeImagePreview,
    applyGeneratedAnnotationDraft,
    markImageAnnotating,
    setSearch
  } = useDatasetStore();
  const [openMenu, setOpenMenu] = useState<MenuKey>();
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
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(undefined);
        setMenuPosition(undefined);
      }
    };

    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const closeWindow = () => {
    if (hasTauriRuntime()) {
      void getCurrentWindow().close();
      return;
    }
    window.close();
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
        onSelect: () => exportDataset("txt_per_image")
      },
      {
        label: t("menu.refresh"),
        disabled: isLoading,
        onSelect: load
      },
      { type: "separator" },
      {
        label: t("menu.exit"),
        onSelect: closeWindow
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
      { type: "separator" },
      {
        label: t("menu.clearSavedMarks"),
        onSelect: () => {
          clearTableSavedCellMarks();
          addAppLog("已清理保存标记。");
        }
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
    void action.onSelect();
  };

  const getAnnotationTargetCount = (scope: AnnotationExecutionScope) => {
    const selectedProfileId = activeProfileId ?? profiles[0]?.id;
    const hasEffectiveAnnotation = (imageId: number) => {
      const image = images.find((item) => item.id === imageId);
      if (!image) return false;
      if (tableDraftProfileId === selectedProfileId) {
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
    conflictStrategy: AnnotationConflictStrategy
  ) => {
    if (!selectedProject) return [];
    const selectedProfileId = activeProfileId ?? profiles[0]?.id;
    const hasEffectiveAnnotation = (image: (typeof images)[number]) => {
      if (tableDraftProfileId === selectedProfileId) {
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
      return;
    }

    if (openMenu === menu) {
      setOpenMenu(undefined);
      setMenuPosition(undefined);
      return;
    }

    const rect = button.getBoundingClientRect();
    setMenuPosition({
      left: Math.min(rect.left, window.innerWidth - 188),
      top: rect.bottom + 4
    });
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

    const selectedProfileId = activeProfileId ?? profiles[0]?.id;
    const targetCount = getAnnotationTargetCount(options.scope);
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
    if (!selectedProfileId) {
      addAppLog("没有可用的标注类型，无法开始标注。", "error");
      setIsAnnotationRunning(false);
      return;
    }

    const targets = getAnnotationTargets(options.scope, options.conflictStrategy);
    addAppLog(`冲突过滤后可执行图片：${targets.length}`);

    try {
      const prompt =
        options.mode === "gemini"
          ? generateAnnotationPrompt(await invokeCommand<GeminiSettings>("get_gemini_settings"))
          : "";

      for (const image of targets) {
        if (!image) continue;
        if (annotationCancelRef.current) {
          addAppLog("标注任务已停止。", "warning");
          throw new Error(annotationCancelledError);
        }
        addAppLog(`正在标注：${image.fileName}`);
        markImageAnnotating(image.id, true);
        try {
          const content =
            options.mode === "gemini"
              ? await invokeCommand<string>("generate_gemini_annotation", {
                  imagePath: image.path,
                  prompt: buildGeminiPrompt(
                    prompt,
                    getImageInstruction(
                      image,
                      selectedProfileId,
                      tableDraftProfileId,
                      tableInstructionDrafts
                    )
                  )
                })
              : await invokeCommand<string>("generate_wd14_annotation", {
                  imagePath: image.path
                });
          if (annotationCancelRef.current) {
            addAppLog(`已丢弃停止后返回的标注结果：${image.fileName}`, "warning");
            throw new Error(annotationCancelledError);
          }
          applyGeneratedAnnotationDraft(selectedProfileId, image.id, content);
          addAppLog(`已生成临时标注：${image.fileName}`);
        } finally {
          markImageAnnotating(image.id, false);
        }
      }

      addAppLog(`标注任务完成：已处理 ${targets.length} 张图片。`);
      if (annotationCancelRef.current) {
        return;
      }
    } catch (error) {
      const message = formatAppError(error);
      if (message === annotationCancelledError) {
        return;
      }
      addAppLog(`标注任务失败：${message}`, "error");
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
            ) : (
              <button
                key={entry.label}
                type="button"
                className="app-dropdown-item flex h-9 w-full items-center px-3.5 text-left text-[12px] font-medium leading-4 text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                disabled={entry.disabled}
                onClick={() => selectAction(entry)}
              >
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
