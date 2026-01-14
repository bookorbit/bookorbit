import { Module } from '@nestjs/common';

import { PathController } from './path.controller';
import { PathService } from './path.service';

@Module({
  controllers: [PathController],
  providers: [PathService],
})
export class PathModule {}
