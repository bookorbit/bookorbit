import { Cron } from '@nestjs/schedule';
import type { CronOptions } from '@nestjs/schedule';

import { SYSTEM_TIME_ZONE } from '../utils/timezone.utils';

type SystemCronOptions = Omit<CronOptions, 'timeZone' | 'utcOffset'>;

export function SystemCron(cronTime: Parameters<typeof Cron>[0], options: SystemCronOptions = {}): MethodDecorator {
  return Cron(cronTime, { ...options, timeZone: SYSTEM_TIME_ZONE });
}
