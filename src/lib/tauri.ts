import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import { AppCommandError, normalizeAppError } from "./errors";

const isTauriRuntime = "__TAURI_INTERNALS__" in window;

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime) {
    throw new Error(`Tauri command "${command}" is only available in the desktop app.`);
  }

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new AppCommandError(normalizeAppError(error));
  }
}

export function hasTauriRuntime() {
  return isTauriRuntime;
}

export async function openExternalUrl(url: string) {
  const href = url.trim();
  if (!href) {
    return;
  }

  if (!isTauriRuntime) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }

  try {
    await invokeCommand("open_external_url", { url: href });
  } catch {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

export function resolveAssetSrc(path?: string, cacheKey?: string | number) {
  if (!path) {
    return undefined;
  }

  const src = isTauriRuntime ? convertFileSrc(path) : path;
  if (cacheKey === undefined || cacheKey === "") {
    return src;
  }

  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}v=${encodeURIComponent(String(cacheKey))}`;
}
