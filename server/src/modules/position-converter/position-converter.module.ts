import { Module } from '@nestjs/common';

import { EpubDomService } from './epub-dom.service';
import { KepubDomService } from './kepub-dom.service';
import { KoboSpanConverterService } from './kobo-span-converter.service';
import { PositionConverterService } from './position-converter.service';

@Module({
  providers: [EpubDomService, KepubDomService, KoboSpanConverterService, PositionConverterService],
  exports: [PositionConverterService, KoboSpanConverterService],
})
export class PositionConverterModule {}
