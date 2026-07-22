export const defaultGeminiTextModel = "gemini-3.6-flash";

export const defaultGeminiTextModels = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview"
];

const unsupportedVertexAliases = new Set(["gemini-flash-latest", "gemini-pro-latest"]);

export function modelForGoogleSource(source: string, model: string) {
  return source === "vertex_ai" && unsupportedVertexAliases.has(model.trim())
    ? defaultGeminiTextModel
    : model;
}
