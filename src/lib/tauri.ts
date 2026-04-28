import { convertFileSrc, invoke } from "@tauri-apps/api/core";

const isTauriRuntime = "__TAURI_INTERNALS__" in window;

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime) {
    throw new Error(`Tauri command "${command}" is only available in the desktop app.`);
  }

  return invoke<T>(command, args);
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
