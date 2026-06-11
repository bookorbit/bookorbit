import { Module } from '@nestjs/common';

import { EpubDomService } from './epub-dom.service';
import { PositionConverterService } from './position-converter.service';

@Module({
  providers: [EpubDomService, PositionConverterService],
  exports: [PositionConverterService],
})
export class PositionConverterModule {}
