import { Module } from '@nestjs/common';

import { AppAttestModule } from '../app-attest/app-attest.module';
import { BookModule } from '../book/book.module';
import { PositionConverterModule } from '../position-converter/position-converter.module';
import { PageLocatorController } from './page-locator.controller';
import { PageLocatorService } from './page-locator.service';

@Module({
  imports: [AppAttestModule, BookModule, PositionConverterModule],
  controllers: [PageLocatorController],
  providers: [PageLocatorService],
})
export class PageLocatorModule {}
