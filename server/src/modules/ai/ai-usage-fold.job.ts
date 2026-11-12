import { Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { SystemCron } from '../../common/decorators/system-cron.decorator';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AiLedgerRepository } from './ai-ledger.repository';

/** Usage rows are kept one by one for this long, then only as monthly totals. */
export const AI_USAGE_DETAIL_DAYS = 90;

@Injectable()
export class AiUsageFoldJob {
  private readonly logger = new Logger(AiUsageFoldJob.name);

  constructor(private readonly ledger: AiLedgerRepository) {}

  @SystemCron(CronExpression.EVERY_DAY_AT_4AM)
  async fold(now: Date = new Date()): Promise<number> {
    try {
      const folded = await this.ledger.foldBefore(new Date(now.getTime() - AI_USAGE_DETAIL_DAYS * 24 * 60 * 60 * 1000));
      if (folded > 0) this.logger.log(`[ai-usage] [fold] rows=${folded} - Folded old usage rows into monthly totals`);
      return folded;
    } catch (err) {
      this.logger.error(`[ai-usage] [fold] - Could not fold old usage rows: ${sanitizeLogValue(err instanceof Error ? err.message : String(err))}`);
      return 0;
    }
  }
}
