import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { describe, expect, it } from 'vitest';

import { SYSTEM_TIME_ZONE } from '../utils/timezone.utils';
import { SystemCron } from './system-cron.decorator';

describe('SystemCron', () => {
  it('registers cron jobs with the validated system timezone', () => {
    class TestJob {
      @SystemCron('0 3 * * *')
      run(): void {}
    }

    expect(Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, TestJob.prototype.run)).toEqual({
      cronTime: '0 3 * * *',
      timeZone: SYSTEM_TIME_ZONE,
    });
  });
});
