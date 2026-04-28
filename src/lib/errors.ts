import type { AppErrorPayload } from "../types";

export function normalizeAppError(error: unknown): AppErrorPayload {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error as AppErrorPayload;
  }

  if (error instanceof Error) {
    return {
      code: "unknown",
      message: error.message
    };
  }

  return {
    code: "unknown",
    message: String(error)
  };
}
