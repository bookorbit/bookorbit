export const MIN_VALID_FILE_TIME_MS = 1000;

export function usableFileTime(date: Date | null | undefined): Date | undefined {
  if (!(date instanceof Date)) return undefined;
  const ms = date.getTime();
  return Number.isFinite(ms) && ms > MIN_VALID_FILE_TIME_MS ? date : undefined;
}
