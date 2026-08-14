import { CronTime } from 'cron';
import { isFiveFieldCronExpression } from '@bookorbit/types';

import { isValidLibraryAutoScanCronExpression } from './library-cron.validator';

const ACCEPTED = [
  '0 4 * * *',
  '*/30 * * * *',
  '0 0 * * 1',
  '0 4 * * MON',
  '0 4 * * mon-fri',
  '0 4 * jan-mar *',
  '1-5/2 * * * *',
  '5/10 * * * *',
  '0,30 4 1,15 * *',
  '0 4 * * 0-7',
  '05 04 * * *',
  '  0 4 * * *  ',
  '0  4 * * *',
];

const REJECTED = [
  'not a cron',
  '0 99 * * *',
  '* * * * * *',
  '@daily',
  '*/0 * * * *',
  '5-1 * * * *',
  '0 4 */0 * *',
  '0 4 * * FRI-MON',
  '0 4 L * *',
  '0 4 * * mon#2',
  '0 4 * * ?',
  '0,,30 4 * * *',
  '0 4 * * jan',
  '0 4 * * 8',
  '',
];

describe('isValidLibraryAutoScanCronExpression', () => {
  it.each(ACCEPTED)('accepts %s', (expression) => {
    expect(isValidLibraryAutoScanCronExpression(expression)).toBe(true);
  });

  it.each(REJECTED)('rejects %s', (expression) => {
    expect(isValidLibraryAutoScanCronExpression(expression)).toBe(false);
  });

  it.each([null, undefined, 42, {}])('rejects the non-string value %s', (value) => {
    expect(isValidLibraryAutoScanCronExpression(value)).toBe(false);
  });

  it('never accepts an expression the scheduler cannot build a job from', () => {
    const unschedulable = [...ACCEPTED, ...REJECTED].filter((expression) => {
      if (!isFiveFieldCronExpression(expression)) return false;
      try {
        new CronTime(expression);
        return false;
      } catch {
        return true;
      }
    });

    expect(unschedulable).toEqual([]);
  });
});
