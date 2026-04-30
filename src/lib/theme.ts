export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const themeStorageKey = "datasets-deputy.theme";
const themePreferenceChangedEvent = "datasets-deputy:theme-preference-changed";

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
