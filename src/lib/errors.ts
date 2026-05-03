import type { AppErrorPayload } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringFromUnknown(value: unknown) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (isRecord(value) && typeof value.message === "string") return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class AppCommandError extends Error {
  code: string;
  params?: AppErrorPayload["params"];

  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = "AppCommandError";
    this.code = payload.code;
    this.params = payload.params;
  }
}

export function normalizeAppError(error: unknown): AppErrorPayload {
  if (error instanceof AppCommandError) {
    return {
      code: error.code,
      message: error.message,
      params: error.params
    };
  }

  if (isRecord(error) && "code" in error) {
    return {
      code: typeof error.code === "string" ? error.code : "unknown",
      message: stringFromUnknown(error.message ?? error),
      params: isRecord(error.params) ? (error.params as AppErrorPayload["params"]) : undefined
    };
  }

  if (error instanceof Error) {
    return {
      code: "unknown",
      message: error.message
    };
  }

  return {
    code: "unknown",
    message: stringFromUnknown(error)
  };
}

export function formatAppError(error: unknown) {
  return normalizeAppError(error).message;
}
