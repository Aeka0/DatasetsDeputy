import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import {
  generateAnnotationPrompt,
  type AnnotationPromptSettings
} from "../../lib/annotationPrompt";
import { hasTauriRuntime } from "../../lib/tauri";
import { invokeCommand } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import type { DatasetProject } from "../../types";
import {
  AnnotationExecutionDialog,
  type AnnotationConflictStrategy,
  type AnnotationExecutionScope
} from "../annotation/AnnotationExecutionDialog";
import { PromptManagementDialog } from "../annotation/PromptManagementDialog";
import { SettingsDialog } from "../settings/SettingsDialog";

type MenuKey = "file" | "edit" | "annotation" | "view" | "settings" | "about";
type DialogKey = "annotationExecution" | "promptManagement" | "settings" | "about";

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

function isAnnotatableProject(project: DatasetProject | undefined) {
  if (!project) return false;
  return (
    project.id !== "database-group" &&
    project.id !== "workspace-folder-group" &&
    project.imageIds.length > 0
  );
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
    selectedImageId,
    previewImageId,
    isLoading,
    setAppView,
    addAppLog,
    clearTableSavedCellMarks,
    openImportWizard,
    exportDataset,
    load,
    closeImagePreview,
    saveAnnotation,
    markImageAnnotating,
    setSearch
  } = useDatasetStore();
  const [openMenu, setOpenMenu] = useState<MenuKey>();
  const [dialog, setDialog] = useState<DialogKey>();
  const [isAnnotationRunning, setIsAnnotationRunning] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedProject = findProject(projects, selectedProjectId);
  const canRunAnnotation = isAnnotatableProject(selectedProject) && !isAnnotationRunning;

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
        setDialog(undefined);
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
          setIsAnnotationRunning(false);
          addAppLog("Annotation run stopped by user.", "warning");
        }
      },
      { type: "separator" },
      {
        label: t("menu.promptManagement"),
        onSelect: () => setDialog("promptManagement")
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
          addAppLog("Saved cell markers cleared.");
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
    if (scope === "selected") {
      return selectedImageId ? 1 : 0;
    }
    if (scope === "empty") {
      return selectedProject?.imageIds.filter((imageId) => {
        const image = images.find((item) => item.id === imageId);
        return image ? image.annotations.every((annotation) => !annotation.content.trim()) : false;
      }).length ?? 0;
    }
    return selectedProject?.imageIds.length ?? 0;
  };

  const getAnnotationTargets = (
    scope: AnnotationExecutionScope,
    conflictStrategy: AnnotationConflictStrategy
  ) => {
    if (!selectedProject) return [];
    const selectedProfileId = activeProfileId ?? profiles[0]?.id;

    return selectedProject.imageIds
      .filter((imageId) => (scope === "selected" ? imageId === selectedImageId : true))
      .map((imageId) => images.find((image) => image.id === imageId))
      .filter((image) => {
        if (!image) return false;
        if (scope === "empty") {
          return image.annotations.every((annotation) => !annotation.content.trim());
        }
        if (conflictStrategy === "skip") {
          if (image.sourceKind === "folder") {
            return image.annotations.every((annotation) => !annotation.content.trim());
          }
          return !image.annotations.some(
            (annotation) =>
              annotation.profileId === selectedProfileId && annotation.content.trim()
          );
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
    scope: AnnotationExecutionScope;
    conflictStrategy: AnnotationConflictStrategy;
  }) => {
    setDialog(undefined);
    setIsAnnotationRunning(true);

    const selectedProfileId = activeProfileId ?? profiles[0]?.id;
    const targetCount = getAnnotationTargetCount(options.scope);
    addAppLog("Annotation run requested.");
    addAppLog(`Dataset: ${selectedProject?.name ?? "Unknown dataset"}`);
    addAppLog(`Scope: ${options.scope}`);
    addAppLog(`Conflict strategy: ${options.conflictStrategy}`);
    addAppLog(`Target images: ${targetCount}`);
    addAppLog(`Annotation profile: ${selectedProfileId ?? "none"}`);
    if (options.scope === "selected" && !selectedImageId) {
      addAppLog("No image is selected. The run cannot start.", "warning");
      setIsAnnotationRunning(false);
      return;
    } else if (targetCount === 0) {
      addAppLog("No target images matched the requested scope.", "warning");
      setIsAnnotationRunning(false);
      return;
    }

    if (!hasTauriRuntime()) {
      addAppLog("Annotation worker requires the Tauri runtime.", "error");
      setIsAnnotationRunning(false);
      return;
    }
    if (!selectedProfileId) {
      addAppLog("No annotation profile is available. The run cannot start.", "error");
      setIsAnnotationRunning(false);
      return;
    }

    try {
      const settings = await invokeCommand<GeminiSettings>("get_gemini_settings");
      const prompt = generateAnnotationPrompt(settings);
      const targets = getAnnotationTargets(options.scope, options.conflictStrategy);
      addAppLog(`Runnable images after conflict filtering: ${targets.length}`);

      for (const image of targets) {
        if (!image) continue;
        addAppLog(`Annotating: ${image.fileName}`);
        markImageAnnotating(image.id, true);
        try {
          const content = await invokeCommand<string>("generate_gemini_annotation", {
            imagePath: image.path,
            prompt
          });
          await saveAnnotation(image.id, selectedProfileId, content);
          addAppLog(`Saved annotation: ${image.fileName}`);
        } finally {
          markImageAnnotating(image.id, false);
        }
      }

      addAppLog(`Annotation run completed: ${targets.length} images processed.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addAppLog(`Annotation run failed: ${message}`, "error");
    } finally {
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
          hasSelectedImage={Boolean(selectedImageId)}
          onClose={() => setDialog(undefined)}
          onConfirm={startAnnotation}
        />
      ) : null}
      {dialog === "promptManagement" ? (
        <PromptManagementDialog onClose={() => setDialog(undefined)} />
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
