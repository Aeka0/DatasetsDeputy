import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

import { hasTauriRuntime } from "../../lib/tauri";
import { useDatasetStore } from "../../stores/datasetStore";

type MenuKey = "file" | "edit" | "settings" | "about";
type DialogKey = "settings" | "about";

interface MenuAction {
  label: string;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
}

const copy = {
  file: "\u6587\u4ef6",
  edit: "\u7f16\u8f91",
  settings: "\u8bbe\u7f6e",
  about: "\u5173\u4e8e",
  importDataset: "\u5bfc\u5165\u6570\u636e\u96c6",
  exportTxt: "\u5bfc\u51fa TXT \u6807\u6ce8",
  refresh: "\u5237\u65b0\u6570\u636e",
  exit: "\u9000\u51fa",
  backToGrid: "\u8fd4\u56de\u6570\u636e\u96c6",
  clearSearch: "\u6e05\u7a7a\u641c\u7d22",
  settingsTitle: "\u8bbe\u7f6e",
  settingsBody:
    "\u8bbe\u7f6e\u9875\u5c1a\u672a\u5c55\u5f00\u3002\u5f53\u524d\u9636\u6bb5\u5148\u4fdd\u7559\u5165\u53e3\uff0c\u540e\u7eed\u63a5\u8bed\u8a00\u3001\u5bfc\u51fa\u9884\u8bbe\u548c\u6570\u636e\u5e93\u5de5\u5177\u3002",
  aboutTitle: "Datasets Deputy",
  aboutBody:
    "\u6570\u636e\u96c6\u56fe\u7247\u9884\u89c8\u3001\u6807\u6ce8\u7ef4\u5ea6\u7ba1\u7406\u4e0e\u5bfc\u51fa\u5de5\u5177\u3002",
  version: "\u5f00\u53d1\u7248",
  close: "\u5173\u95ed",
  noDataset: "\u9700\u8981\u5148\u8f7d\u5165\u6570\u636e\u96c6"
};

const menuLabels: Array<{ key: MenuKey; label: string }> = [
  { key: "file", label: copy.file },
  { key: "edit", label: copy.edit },
  { key: "settings", label: copy.settings },
  { key: "about", label: copy.about }
];

export function TitleMenuBar() {
  const {
    images,
    search,
    selectedImageId,
    isLoading,
    importFolder,
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

  const menus: Record<MenuKey, MenuAction[]> = {
    file: [
      {
        label: copy.importDataset,
        disabled: isLoading,
        onSelect: importFolder
      },
      {
        label: copy.exportTxt,
        disabled: images.length === 0 || isLoading,
        onSelect: () => exportDataset("txt_per_image")
      },
      {
        label: copy.refresh,
        disabled: isLoading,
        onSelect: load
      },
      {
        label: copy.exit,
        onSelect: closeWindow
      }
    ],
    edit: [
      {
        label: copy.backToGrid,
        disabled: !selectedImageId,
        onSelect: () => selectImage(undefined)
      },
      {
        label: copy.clearSearch,
        disabled: !search,
        onSelect: () => setSearch("")
      }
    ],
    settings: [
      {
        label: copy.settingsTitle,
        onSelect: () => setDialog("settings")
      }
    ],
    about: [
      {
        label: copy.aboutTitle,
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
              className={`title-menu-button h-5 rounded-[3px] px-2 text-[0.6875rem] leading-5 transition ${
                openMenu === menu.key
                  ? "bg-slate-900/8 text-slate-900"
                  : "text-slate-600 hover:bg-slate-900/6 hover:text-slate-900"
              }`}
              onClick={() =>
                setOpenMenu((current) => (current === menu.key ? undefined : menu.key))
              }
            >
              {menu.label}
            </button>

            {openMenu === menu.key ? (
              <div className="absolute left-0 top-6 z-50 min-w-32 rounded-[4px] border border-slate-200/90 bg-white/98 py-0.5 shadow-[0_4px_14px_rgba(15,23,42,0.10)]">
                {menus[menu.key].map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="flex h-[18px] w-full items-center px-4 text-left text-[0.6875rem] leading-[18px] text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
                    disabled={action.disabled}
                    onClick={() => selectAction(action)}
                  >
                    <span className="truncate">{action.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </nav>

      {dialog ? (
        <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-slate-950/16">
          <div className="w-[360px] rounded-md border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="m-0 text-base font-semibold text-slate-900">
              {dialog === "settings" ? copy.settingsTitle : copy.aboutTitle}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {dialog === "settings" ? copy.settingsBody : copy.aboutBody}
            </p>
            {dialog === "about" ? (
              <div className="mt-3 text-xs text-slate-400">{copy.version}</div>
            ) : null}
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white transition hover:bg-slate-800"
                onClick={() => setDialog(undefined)}
              >
                {copy.close}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
