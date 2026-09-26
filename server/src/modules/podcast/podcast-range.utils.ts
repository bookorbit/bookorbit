export interface PodcastByteRange {
  start: number;
  end: number;
}

export function parsePodcastByteRange(value: string, size: number): PodcastByteRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = safeInteger(match[2]!);
    if (suffixLength === null || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = safeInteger(match[1]);
  if (start === null || start >= size) return null;
  if (!match[2]) return { start, end: size - 1 };

  const requestedEnd = safeInteger(match[2]);
  if (requestedEnd === null || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function safeInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
