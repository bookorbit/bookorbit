import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { ReaderPreferencesController } from './reader-preferences.controller';
import { ReaderPreferencesRepository } from './reader-preferences.repository';
import { ReaderPreferencesService } from './reader-preferences.service';

@Module({
  imports: [BookModule],
  controllers: [ReaderPreferencesController],
  providers: [ReaderPreferencesRepository, ReaderPreferencesService],
})
export class ReaderPreferencesModule {}
