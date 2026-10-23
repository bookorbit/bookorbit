import { Module } from '@nestjs/common';
import { BookModule } from '../../book/book.module';
import { DjvuDocumentModule } from '../../djvu/djvu-document.module';
import { DjvuController } from './djvu.controller';
import { DjvuService } from './djvu.service';

@Module({
  imports: [BookModule, DjvuDocumentModule],
  controllers: [DjvuController],
  providers: [DjvuService],
})
export class DjvuModule {}
