import { coverShapeFromSize, type CoverMedium } from '@bookorbit/types';

const TARGET_RATIO: Record<CoverMedium, number> = { ebook: 2 / 3, audio: 1 };

export type CoverShape = 'square' | 'portrait' | 'ambiguous';

export function classifyCoverShape(width: number | null | undefined, height: number | null | undefined): CoverShape {
  const shape = coverShapeFromSize(width, height);
  return shape === 'unknown' ? 'ambiguous' : shape;
}

export type FolderImageCandidate = {
  path: string;
  name: string;
  width: number;
  height: number;
};

export type FolderImageAssignmentOptions = {
  /** The book has both media, so an image's shape decides which slot it may fill. */
  bothMedia: boolean;
  /** The only audio is an EPUB's read-along, so its slot takes nothing but square art. */
  squareOnlyAudio: boolean;
  primaryMedium: CoverMedium;
};

/**
 * Chooses a folder image for each slot that still needs one. With both media, square art belongs
 * to the audio slot and portrait art to the ebook slot, and anything in between fills whichever
 * slot is still empty, the primary file's medium first. Ties keep basename order.
 */
export function assignFolderImages(
  images: readonly FolderImageCandidate[],
  needed: readonly CoverMedium[],
  options: FolderImageAssignmentOptions,
): Map<CoverMedium, FolderImageCandidate> {
  const sorted = [...images].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const assigned = new Map<CoverMedium, FolderImageCandidate>();
  if (needed.length === 0 || sorted.length === 0) return assigned;

  if (!options.bothMedia) {
    const medium = needed[0]!;
    const best = bestFit(sorted, medium);
    if (best) assigned.set(medium, best);
    return assigned;
  }

  const used = new Set<FolderImageCandidate>();
  const take = (medium: CoverMedium, pool: FolderImageCandidate[]) => {
    const best = bestFit(
      pool.filter((image) => !used.has(image)),
      medium,
    );
    if (!best) return;
    assigned.set(medium, best);
    used.add(best);
  };

  if (needed.includes('audio'))
    take(
      'audio',
      sorted.filter((image) => classifyCoverShape(image.width, image.height) === 'square'),
    );
  if (needed.includes('ebook'))
    take(
      'ebook',
      sorted.filter((image) => classifyCoverShape(image.width, image.height) === 'portrait'),
    );

  const ambiguous = sorted.filter((image) => classifyCoverShape(image.width, image.height) === 'ambiguous');
  const order: CoverMedium[] = options.primaryMedium === 'audio' ? ['audio', 'ebook'] : ['ebook', 'audio'];
  for (const medium of order) {
    if (!needed.includes(medium) || assigned.has(medium)) continue;
    if (medium === 'audio' && options.squareOnlyAudio) continue;
    const next = ambiguous.find((image) => !used.has(image));
    if (!next) continue;
    assigned.set(medium, next);
    used.add(next);
  }
  return assigned;
}

function bestFit(images: readonly FolderImageCandidate[], medium: CoverMedium): FolderImageCandidate | null {
  let best: FolderImageCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const image of images) {
    const distance = Math.abs(image.width / image.height - TARGET_RATIO[medium]);
    if (distance < bestDistance) {
      best = image;
      bestDistance = distance;
    }
  }
  return best;
}
