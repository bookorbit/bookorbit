import type { EpubMediaOverlayCapability } from '@bookorbit/types';

import { inspectEpubMediaOverlayFile } from './epub-media-overlay';

export type EpubMediaOverlayColumnFields = {
  mediaOverlayAvailable: boolean;
  mediaOverlayDurationSeconds: number | null;
  mediaOverlayCheckedAt: Date | null;
};

type CapabilitySource = {
  format: string | null;
  mediaOverlayAvailable?: boolean | null;
  mediaOverlayDurationSeconds?: number | null;
  mediaOverlayCheckedAt?: Date | null;
};

export function clearEpubMediaOverlayFields(): EpubMediaOverlayColumnFields {
  return {
    mediaOverlayAvailable: false,
    mediaOverlayDurationSeconds: null,
    mediaOverlayCheckedAt: null,
  };
}

export function mediaOverlayCapabilityFromFields(file: CapabilitySource): EpubMediaOverlayCapability | null {
  if (file.format?.toLowerCase() !== 'epub') return null;
  if (!file.mediaOverlayAvailable && !file.mediaOverlayCheckedAt) return null;
  return {
    available: file.mediaOverlayAvailable === true,
    durationSeconds: file.mediaOverlayAvailable === true ? (file.mediaOverlayDurationSeconds ?? null) : null,
  };
}

export async function inspectEpubMediaOverlayFields(
  absolutePath: string,
  format: string | null,
  onError?: (err: unknown) => void,
): Promise<EpubMediaOverlayColumnFields> {
  if (format?.toLowerCase() !== 'epub') return clearEpubMediaOverlayFields();

  try {
    const capability = await inspectEpubMediaOverlayFile(absolutePath);
    return {
      mediaOverlayAvailable: capability.available,
      mediaOverlayDurationSeconds: capability.available ? (capability.durationSeconds ?? null) : null,
      mediaOverlayCheckedAt: new Date(),
    };
  } catch (err) {
    onError?.(err);
    return {
      mediaOverlayAvailable: false,
      mediaOverlayDurationSeconds: null,
      mediaOverlayCheckedAt: new Date(),
    };
  }
}
