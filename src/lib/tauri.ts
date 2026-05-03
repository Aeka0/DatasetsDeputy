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

export function resolveAssetSrc(path?: string) {
  if (!path) {
    return undefined;
  }

  return isTauriRuntime ? convertFileSrc(path) : path;
}
