import { Module } from '@nestjs/common';

import { AppAttestModule } from '../app-attest/app-attest.module';
import { BookModule } from '../book/book.module';
import { ShelfMatchController } from './shelf-match.controller';
import { VisualMatchController } from './visual-match.controller';
import { VisualMatchRepository } from './visual-match.repository';
import { VisualMatchService } from './visual-match.service';

@Module({
  imports: [AppAttestModule, BookModule],
  controllers: [VisualMatchController, ShelfMatchController],
  providers: [VisualMatchService, VisualMatchRepository],
})
export class VisualMatchModule {}
