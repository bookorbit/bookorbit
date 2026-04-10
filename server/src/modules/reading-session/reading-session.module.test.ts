import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookModule } from '../book/book.module';
import { ReadingSessionController } from './reading-session.controller';
import { ReadingSessionModule } from './reading-session.module';
import { ReadingSessionRepository } from './reading-session.repository';
import { ReadingSessionService } from './reading-session.service';

describe('ReadingSessionModule', () => {
  it('registers expected imports, controller, and providers', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, ReadingSessionModule)).toEqual([BookModule]);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, ReadingSessionModule)).toEqual([ReadingSessionController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ReadingSessionModule)).toEqual([ReadingSessionService, ReadingSessionRepository]);
  });
});
