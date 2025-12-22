import { Module } from '@nestjs/common';
import { KoboController } from './kobo.controller';
import { KoboService } from './kobo.service';

@Module({
  controllers: [KoboController],
  providers: [KoboService],
})
export class KoboModule {}
