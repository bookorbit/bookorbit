import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { AnnotationSyncService } from '../../annotation/annotation-sync.service';
import {
  type DevicePositionRebuildResult,
  type DevicePositionRebuildTarget,
  type DevicePositionRebuilder,
  DevicePositionRebuilderRegistry,
} from '../../annotation/device-position-rebuilder';
import { KoboAnnotationMaterializerService } from './kobo-annotation-materializer.service';
import { KoboKepubContextService } from './kobo-kepub-context.service';

const EVENT = 'kobo.position_rebuild';

/**
 * Rebuilds canonical positions from a stored kobo_span position on demand, so a
 * conversion that failed during sync can be retried from the annotation hub instead
 * of waiting for the device to upload the annotation again.
 */
@Injectable()
export class KoboPositionRebuildService implements DevicePositionRebuilder, OnModuleInit {
  private readonly logger = new Logger(KoboPositionRebuildService.name);

  constructor(
    private readonly registry: DevicePositionRebuilderRegistry,
    private readonly annotationSync: AnnotationSyncService,
    private readonly kepubContext: KoboKepubContextService,
    private readonly materializer: KoboAnnotationMaterializerService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async rebuildCanonicalPositions(userId: number, annotation: DevicePositionRebuildTarget): Promise<DevicePositionRebuildResult> {
    const [koboSpan] = await this.annotationSync.findPositions([annotation.id], ['kobo_span']);
    if (!koboSpan?.pos0) return { rebuilt: false, reason: 'no_kobo_span_position' };

    const resolved = await this.kepubContext.resolveForBook(userId, annotation.bookId);
    if (!resolved.ok) return { rebuilt: false, reason: resolved.reason };

    const outcome = await this.materializer.convertFromKoboSpan(userId, annotation, koboSpan, resolved.file, resolved.ctx);
    this.logger.log(
      `[${EVENT}] [end] userId=${userId} annotationId=${annotation.id} converted=${outcome.converted} reason="${sanitizeLogValue(outcome.reason ?? 'none')}" - kobo span rebuild finished`,
    );
    return { rebuilt: outcome.converted, reason: outcome.reason };
  }
}
