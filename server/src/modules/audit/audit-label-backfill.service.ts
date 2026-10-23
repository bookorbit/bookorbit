import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { AuditRepository } from './audit.repository';

/**
 * Names the audit rows written before every event snapshotted its target, so the log can show
 * "Novels" instead of "Library #3", and still name a library that has since been deleted.
 *
 * Runs once per database: a flag records that it finished. A failure is logged and swallowed,
 * because unnamed rows still read as "Library #3", and the next boot tries again.
 */
@Injectable()
export class AuditLabelBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuditLabelBackfillService.name);

  constructor(
    private readonly auditRepository: AuditRepository,
    private readonly appSettings: AppSettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const event = 'audit.label_backfill';
    const startedAt = Date.now();
    try {
      if (await this.appSettings.getValue(APP_SETTING_KEYS.AUDIT_TARGET_LABELS_BACKFILLED)) return;
      this.logger.log(`[${event}] [start] - naming audit targets recorded before label snapshots`);
      const { fromLive, fromHistory } = await this.auditRepository.backfillTargetLabels();
      await this.appSettings.setValue(APP_SETTING_KEYS.AUDIT_TARGET_LABELS_BACKFILLED, new Date().toISOString());
      this.logger.log(
        `[${event}] [end] durationMs=${Date.now() - startedAt} fromLive=${fromLive} fromHistory=${fromHistory} - audit target names backfilled`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - audit target name backfill failed`,
      );
    }
  }
}
