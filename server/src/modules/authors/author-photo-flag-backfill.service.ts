import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AuthorImageStorageService } from './author-image-storage.service';
import { AuthorsRepository } from './authors.repository';

/**
 * Reconciles `authors.has_photo` with the author image store.
 *
 * The list API resolves an author's portrait from disk, but the "has photo" filter
 * queries the column, so any drift between the two makes the filter quietly lie:
 * authors that plainly show a portrait still come back under "no portrait". Drift is
 * expected after a database reset, a restore, or an image written by an older build.
 *
 * One directory listing plus at most two statements, so the cost does not grow with
 * the library and this can run on every boot. A failure is logged and swallowed:
 * a stale flag is a wrong filter, not a reason to refuse to start.
 */
@Injectable()
export class AuthorPhotoFlagBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthorPhotoFlagBackfillService.name);

  constructor(
    private readonly authorsRepo: AuthorsRepository,
    private readonly authorImageStorage: AuthorImageStorageService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const event = 'author.photo_flag_backfill';
    const startedAt = Date.now();

    try {
      const idsWithImage = await this.authorImageStorage.listAuthorIdsWithStoredImage();
      const { marked, cleared } = await this.authorsRepo.reconcileHasPhoto(idsWithImage);
      if (marked === 0 && cleared === 0) return;

      this.logger.log(
        `[${event}] [end] durationMs=${Date.now() - startedAt} stored=${idsWithImage.length} marked=${marked} cleared=${cleared} - author photo flags reconciled with the image store`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - author photo flag reconciliation failed`,
      );
    }
  }
}
