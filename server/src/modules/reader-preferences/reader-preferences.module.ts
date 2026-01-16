import { Module } from '@nestjs/common';

import { ReaderPreferencesController } from './reader-preferences.controller';
import { ReaderPreferencesRepository } from './reader-preferences.repository';
import { ReaderPreferencesService } from './reader-preferences.service';

@Module({
  controllers: [ReaderPreferencesController],
  providers: [ReaderPreferencesRepository, ReaderPreferencesService],
})
export class ReaderPreferencesModule {}
