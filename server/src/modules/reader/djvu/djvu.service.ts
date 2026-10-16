import { Injectable, NotFoundException } from '@nestjs/common';
import type { RequestUser } from '../../../common/types/request-user';
import { BookService } from '../../book/book.service';
import { DjvuDocumentService, type DjvuPageResult } from '../../djvu/djvu-document.service';

@Injectable()
export class DjvuService {
  constructor(
    private readonly bookService: BookService,
    private readonly documents: DjvuDocumentService,
  ) {}

  async getPageCount(fileId: number, user: RequestUser): Promise<number> {
    const file = await this.authorizedFile(fileId, user);
    return this.documents.getPageCount(file.absolutePath, file.libraryFolderPath);
  }

  async getPage(fileId: number, pageIndex: number, size: number, user: RequestUser, ifNoneMatch?: string): Promise<DjvuPageResult> {
    const file = await this.authorizedFile(fileId, user);
    return this.documents.getPage(file.absolutePath, file.libraryFolderPath, pageIndex, size, ifNoneMatch);
  }

  async getPageText(fileId: number, pageIndex: number, user: RequestUser): Promise<{ text: string }> {
    const file = await this.authorizedFile(fileId, user);
    return this.documents.getPageText(file.absolutePath, file.libraryFolderPath, pageIndex);
  }

  private async authorizedFile(fileId: number, user: RequestUser) {
    // Access is checked on every request, including cached pages and conditional responses.
    const file = await this.bookService.verifyFileAccess(fileId, user);
    if (file.format?.toLowerCase() !== 'djvu') throw new NotFoundException('File is not a DjVu document');
    return file;
  }
}
