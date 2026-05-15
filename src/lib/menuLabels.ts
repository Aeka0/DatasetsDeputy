const existingDialogEllipsisPattern = /(\.\.\.|…)$/;

export function formatDialogMenuLabel(label: string) {
  return existingDialogEllipsisPattern.test(label) ? label : `${label}...`;
}
