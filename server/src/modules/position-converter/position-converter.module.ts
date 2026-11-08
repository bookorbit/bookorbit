import { Module } from '@nestjs/common';

import { EpubDomService } from './epub-dom.service';
import { KepubDomService } from './kepub-dom.service';
import { KoboSpanConverterService } from './kobo-span-converter.service';
import { PositionConverterService } from './position-converter.service';
import { TextLocatorService } from './text-locator.service';

@Module({
  providers: [EpubDomService, KepubDomService, KoboSpanConverterService, PositionConverterService, TextLocatorService],
  exports: [PositionConverterService, KoboSpanConverterService, TextLocatorService],
})
export class PositionConverterModule {}
