import { Module } from '@nestjs/common';

import { MetadataService } from './metadata.service';

@Module({
  providers: [MetadataService],
  exports: [MetadataService],
})
export class MetadataModule {}
