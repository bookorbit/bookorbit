import { Injectable } from '@nestjs/common';

export interface DevicePositionRebuildTarget {
  id: number;
  bookId: number;
  text: string | null;
}

export interface DevicePositionRebuildResult {
  rebuilt: boolean;
  reason?: string;
}

/** Recomputes canonical positions from a device's own stored position format. */
export interface DevicePositionRebuilder {
  rebuildCanonicalPositions(userId: number, annotation: DevicePositionRebuildTarget): Promise<DevicePositionRebuildResult>;
}

/**
 * Holds the device-side rebuilder for the annotation hub's position retry, which
 * has to recompute cfi and xpointer from a device position when neither canonical
 * format has a usable source of its own.
 *
 * Device modules import AnnotationModule, so the dependency can only run in this
 * direction: the implementation registers itself here at startup instead of being
 * injected into the hub, which would close a module cycle.
 */
@Injectable()
export class DevicePositionRebuilderRegistry {
  private rebuilder: DevicePositionRebuilder | null = null;

  register(rebuilder: DevicePositionRebuilder): void {
    this.rebuilder = rebuilder;
  }

  get(): DevicePositionRebuilder | null {
    return this.rebuilder;
  }
}
