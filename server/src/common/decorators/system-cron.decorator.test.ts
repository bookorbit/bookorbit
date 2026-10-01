import { describe, expect, it } from 'vitest';

import { SYSTEM_TIME_ZONE } from '../utils/timezone.utils';
import { SystemCron } from './system-cron.decorator';

describe('SystemCron', () => {
  it('registers cron jobs with the validated system timezone', () => {
    class TestJob {
      @SystemCron('0 3 * * *')
      run(): void {}
    }

    const metadata = Reflect.getMetadataKeys(TestJob.prototype.run).map((key) => Reflect.getMetadata(key, TestJob.prototype.run));

    expect(metadata).toContainEqual({ cronTime: '0 3 * * *', timeZone: SYSTEM_TIME_ZONE });
  });
});
