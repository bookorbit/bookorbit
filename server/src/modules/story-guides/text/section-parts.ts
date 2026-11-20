/** A section with more words than this is cut into parts for the `lines` step. */
export const LONG_SECTION_WORDS = 8000;
/** The size the parts of a long section aim for. */
export const SECTION_PART_WORDS = 5000;

export interface SectionPart {
  /** 1-based. A section that is not long has one part. */
  part: number;
  /** UTF-16 offsets into the section's raw text. */
  start: number;
  end: number;
}

const WORD = /\S+/g;

export function countWords(text: string): number {
  let count = 0;
  WORD.lastIndex = 0;
  while (WORD.exec(text)) count++;
  return count;
}

function wordStarts(text: string): number[] {
  const starts: number[] = [];
  WORD.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD.exec(text))) starts.push(match.index);
  return starts;
}

/**
 * Cuts a long section into parts of about `SECTION_PART_WORDS` words, at the block start nearest
 * each even cut. A stretch with no block start is cut at a word boundary instead.
 */
export function sectionParts(text: string, blocks: number[]): SectionPart[] {
  const starts = wordStarts(text);
  if (starts.length <= LONG_SECTION_WORDS) return [{ part: 1, start: 0, end: text.length }];
  const count = Math.max(2, Math.round(starts.length / SECTION_PART_WORDS));
  const targets = Array.from({ length: count - 1 }, (_, k) => starts[Math.round(((k + 1) * starts.length) / count)]);
  const cuts: number[] = [];
  let previous = 0;
  for (const [k, target] of targets.entries()) {
    const limit = k + 1 < targets.length ? targets[k + 1] : text.length;
    let best: number | null = null;
    for (const block of blocks) {
      if (block <= previous || block >= limit) continue;
      if (best === null || Math.abs(block - target) < Math.abs(best - target)) best = block;
    }
    const cut = best ?? target;
    if (cut > previous && cut < text.length) {
      cuts.push(cut);
      previous = cut;
    }
  }
  const bounds = [0, ...cuts, text.length];
  return bounds.slice(0, -1).map((start, index) => ({ part: index + 1, start, end: bounds[index + 1] }));
}
