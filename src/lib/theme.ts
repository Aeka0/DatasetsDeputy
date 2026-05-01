export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type WindowRenderMode = "blur" | "acrylic";

export interface WindowRenderingSettings {
  mode: WindowRenderMode;
}

const themeStorageKey = "datasets-deputy.theme";
const bottomOpacityStorageKey = "datasets-deputy.bottom-opacity";
const topOpacityStorageKey = "datasets-deputy.top-opacity";
const themePreferenceChangedEvent = "datasets-deputy:theme-preference-changed";
const uiOpacityChangedEvent = "datasets-deputy:ui-opacity-changed";
const windowRenderModeChangedEvent = "datasets-deputy:window-render-mode-changed";
const defaultBottomOpacity = 85;
const defaultTopOpacity = 95;
const defaultWindowRenderMode: WindowRenderMode = "blur";
const minBottomUiOpacity = 70;
const minTopUiOpacity = 30;
const maxUiOpacity = 100;

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function getThemePreference(): ThemePreference {
  if (typeof localStorage === "undefined") return "system";

  const stored = localStorage.getItem(themeStorageKey);
  return isThemePreference(stored) ? stored : "system";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  if (typeof window === "undefined") return "light";

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(preference = getThemePreference()) {
  if (typeof document === "undefined") return;

  const resolvedTheme = resolveTheme(preference);
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
  applyUiOpacity();
  applyWindowRenderMode();
}

export function setThemePreference(preference: ThemePreference) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(themeStorageKey, preference);
  }

  applyTheme(preference);
  window.dispatchEvent(new CustomEvent(themePreferenceChangedEvent, { detail: preference }));
}

export function watchSystemTheme() {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const updateSystemTheme = () => {
    if (getThemePreference() === "system") {
      applyTheme("system");
    }
  };

  media.addEventListener("change", updateSystemTheme);
  return () => media.removeEventListener("change", updateSystemTheme);
}

export function watchThemePreference(callback: (preference: ThemePreference) => void) {
  const handler = (event: Event) => {
    callback((event as CustomEvent<ThemePreference>).detail);
  };

  window.addEventListener(themePreferenceChangedEvent, handler);
  return () => window.removeEventListener(themePreferenceChangedEvent, handler);
}

export function getWindowRenderMode() {
  return defaultWindowRenderMode;
}

export function applyWindowRenderMode(mode = getWindowRenderMode()) {
  if (typeof document === "undefined") return;

  document.documentElement.dataset.windowRenderMode = mode;
}

export function setWindowRenderMode(mode: WindowRenderMode) {
  applyWindowRenderMode(mode);
  window.dispatchEvent(new CustomEvent(windowRenderModeChangedEvent, { detail: mode }));
}

export function watchWindowRenderMode(callback: (mode: WindowRenderMode) => void) {
  const handler = (event: Event) => {
    callback((event as CustomEvent<WindowRenderMode>).detail);
  };

  window.addEventListener(windowRenderModeChangedEvent, handler);
  return () => window.removeEventListener(windowRenderModeChangedEvent, handler);
}

function clampUiOpacity(value: number, minOpacity: number) {
  return Math.min(maxUiOpacity, Math.max(minOpacity, Math.round(value)));
}

function getStoredOpacity(storageKey: string, fallback: number, minOpacity: number) {
  if (typeof localStorage === "undefined") return fallback;

  const stored = Number(localStorage.getItem(storageKey));
  return Number.isFinite(stored) ? clampUiOpacity(stored, minOpacity) : fallback;
}

export function getBottomUiOpacity() {
  return getStoredOpacity(bottomOpacityStorageKey, defaultBottomOpacity, minBottomUiOpacity);
}

export function getTopUiOpacity() {
  return getStoredOpacity(topOpacityStorageKey, defaultTopOpacity, minTopUiOpacity);
}

export function applyUiOpacity() {
  if (typeof document === "undefined") return;

  document.documentElement.style.setProperty(
    "--app-bottom-opacity",
    String(getBottomUiOpacity() / 100)
  );
  document.documentElement.style.setProperty(
    "--app-top-opacity",
    String(getTopUiOpacity() / 100)
  );
}

export function setBottomUiOpacity(value: number) {
  const opacity = clampUiOpacity(value, minBottomUiOpacity);
  localStorage.setItem(bottomOpacityStorageKey, String(opacity));
  applyUiOpacity();
  window.dispatchEvent(new CustomEvent(uiOpacityChangedEvent));
}

export function setTopUiOpacity(value: number) {
  const opacity = clampUiOpacity(value, minTopUiOpacity);
  localStorage.setItem(topOpacityStorageKey, String(opacity));
  applyUiOpacity();
  window.dispatchEvent(new CustomEvent(uiOpacityChangedEvent));
}

export function watchUiOpacity(callback: () => void) {
  window.addEventListener(uiOpacityChangedEvent, callback);
  return () => window.removeEventListener(uiOpacityChangedEvent, callback);
}
