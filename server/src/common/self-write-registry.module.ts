import { Module } from '@nestjs/common';

import { SelfWriteRegistry } from './services/self-write-registry.service';

@Module({
  providers: [SelfWriteRegistry],
  exports: [SelfWriteRegistry],
})
export class SelfWriteRegistryModule {}
