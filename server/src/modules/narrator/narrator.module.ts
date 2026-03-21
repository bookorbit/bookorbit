import { Module } from '@nestjs/common';

import { NarratorRepository } from './narrator.repository';
import { NarratorService } from './narrator.service';

@Module({
  providers: [NarratorRepository, NarratorService],
  exports: [NarratorService],
})
export class NarratorModule {}
