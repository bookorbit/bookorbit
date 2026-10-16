import { Module } from '@nestjs/common';
import { PathModule } from '../path/path.module';
import { DjvuDocumentService } from './djvu-document.service';
import { DjvuProcess } from './djvu-process';

@Module({
  imports: [PathModule],
  providers: [DjvuDocumentService, DjvuProcess],
  exports: [DjvuDocumentService],
})
export class DjvuDocumentModule {}
