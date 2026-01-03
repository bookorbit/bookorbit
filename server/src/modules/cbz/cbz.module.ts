import { Module } from '@nestjs/common';
import { BookModule } from '../book/book.module';
import { CbzController } from './cbz.controller';
import { CbzService } from './cbz.service';

@Module({
  imports: [BookModule],
  controllers: [CbzController],
  providers: [CbzService],
})
export class CbzModule {}
