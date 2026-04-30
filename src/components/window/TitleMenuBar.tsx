import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { hasTauriRuntime } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";
import { SettingsDialog } from "../settings/SettingsDialog";

type MenuKey = "file" | "edit" | "settings" | "about";
type DialogKey = "settings" | "about";

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

const menuLabels: Array<{ key: MenuKey; labelKey: string }> = [
  { key: "file", labelKey: "menu.file" },
  { key: "edit", labelKey: "menu.edit" },
  { key: "settings", labelKey: "menu.settings" },
  { key: "about", labelKey: "menu.about" }
];

export function TitleMenuBar() {
  const { t } = useTranslation();
  const {
    images,
    search,
    selectedImageId,
    isLoading,
    openImportWizard,
    exportDataset,
    load,
    selectImage,
    setSearch
  } = useDatasetStore();
  const [openMenu, setOpenMenu] = useState<MenuKey>();
  const [dialog, setDialog] = useState<DialogKey>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpenMenu(undefined);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(undefined);
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
        disabled: !selectedImageId,
        onSelect: () => selectImage(undefined)
      },
      {
        label: t("menu.clearSearch"),
        disabled: !search,
        onSelect: () => setSearch("")
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
    void action.onSelect();
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
              onClick={() =>
                setOpenMenu((current) => (current === menu.key ? undefined : menu.key))
              }
            >
              {t(menu.labelKey)}
            </button>

            {openMenu === menu.key ? (
              <div className="absolute left-0 top-8 z-50 min-w-[180px] rounded-lg border border-slate-200/90 bg-white/98 py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.16)]">
                {menus[menu.key].map((entry, index) =>
                  entry.type === "separator" ? (
                    <div
                      key={`${menu.key}-separator-${index}`}
                      className="my-1 h-px bg-slate-200/90"
                    />
                  ) : (
                    <button
                      key={entry.label}
                      type="button"
                      className="flex h-8 w-full items-center px-3.5 text-left text-[12px] font-medium leading-4 text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                      disabled={entry.disabled}
                      onClick={() => selectAction(entry)}
                    >
                      <span className="truncate">{entry.label}</span>
                    </button>
                  )
                )}
              </div>
            ) : null}
          </div>
        ))}
      </nav>

      {dialog === "settings" ? <SettingsDialog onClose={() => setDialog(undefined)} /> : null}

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
