import { normalizeTitleText } from './title-match';

const SERIES_POSITION_MARKERS = new Set(['book', 'bk', 'vol', 'volume', 'part']);
const EXPLICIT_POSITION = /(?:^|[^\p{L}\p{N}])(?:book|bk|vol(?:ume)?|part)\.?\s*(?:#\s*)?(\d+(?:[.,]\d+)?)(?![\p{L}\p{N}])/giu;
const HASH_POSITION = /(?:^|[^\p{L}\p{N}])#\s*(\d+(?:[.,]\d+)?)(?![\p{L}\p{N}])/gu;

export function parseSeriesPosition(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function sameSeriesPosition(left: string | number | null | undefined, right: string | number | null | undefined): boolean {
  const a = parseSeriesPosition(left);
  const b = parseSeriesPosition(right);
  return a !== null && b !== null && a === b;
}

export function sameSeriesName(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left?.trim() || !right?.trim()) return false;
  return normalizeTitleText(left) === normalizeTitleText(right);
}

/** Reads only explicit volume markers or a number immediately following the requested series name. */
export function inferSeriesPositionFromTitle(title: string, seriesName: string | null | undefined): number | null {
  if (!title.trim()) return null;

  if (seriesName?.trim()) {
    const titleTokens = normalizeTitleText(title).split(' ').filter(Boolean);
    const seriesTokens = normalizeTitleText(seriesName).split(' ').filter(Boolean);

    for (let start = 0; start <= titleTokens.length - seriesTokens.length; start++) {
      if (!seriesTokens.every((token, offset) => titleTokens[start + offset] === token)) continue;

      let position = start + seriesTokens.length;
      if (SERIES_POSITION_MARKERS.has(titleTokens[position] ?? '')) position++;
      const inferred = parseInferredPosition(titleTokens[position]);
      if (inferred !== null) return inferred;
    }
  }

  for (const pattern of [EXPLICIT_POSITION, HASH_POSITION]) {
    for (const match of title.matchAll(pattern)) {
      const inferred = parseInferredPosition(match[1]);
      if (inferred !== null) return inferred;
    }
  }

  return null;
}

function parseInferredPosition(value: string | undefined): number | null {
  const parsed = parseSeriesPosition(value);
  if (parsed === null) return null;
  return Number.isInteger(parsed) && parsed >= 1900 && parsed <= 2099 ? null : parsed;
}
