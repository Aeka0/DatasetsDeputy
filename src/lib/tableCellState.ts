export type TableCellState = "dirty" | "saved" | "failed";

export function getLatestVisibleTableCellState({
  latestState,
  isDirty,
  isSaved,
  isFailed
}: {
  latestState?: TableCellState;
  isDirty: boolean;
  isSaved: boolean;
  isFailed: boolean;
}) {
  if (latestState === "dirty" && isDirty) return "dirty";
  if (latestState === "saved" && isSaved) return "saved";
  if (latestState === "failed" && isFailed) return "failed";

  if (isFailed) return "failed";
  if (isSaved) return "saved";
  if (isDirty) return "dirty";
  return undefined;
}
