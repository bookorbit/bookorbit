import 'reflect-metadata';

import { Permission } from '@bookorbit/types';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { SharedReadingInsightsController } from './shared-reading-insights.controller';

describe('SharedReadingInsightsController', () => {
  it('requires view-user-activity permission for every administrator endpoint', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, SharedReadingInsightsController)).toBe(Permission.ViewUserActivity);
  });
});
