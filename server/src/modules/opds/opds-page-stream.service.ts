import { createReadStream } from 'fs';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { CbzService } from '../reader/cbz/cbz.service';
import { OpdsPageCountService, type PseFile } from './opds-page-count.service';
import { OpdsPdfPageService } from './opds-pdf-page.service';

export interface StreamedPage {
  stream: NodeJS.ReadableStream;
  mimeType: string;
  totalPages: number;
}

@Injectable()
export class OpdsPageStreamService {
  constructor(
    private readonly cbzService: CbzService,
    private readonly pdfPageService: OpdsPdfPageService,
    private readonly pageCountService: OpdsPageCountService,
  ) {}

  async streamPage(file: PseFile, pageNumber: number, user: RequestUser): Promise<StreamedPage> {
    if (pageNumber < 0) throw new BadRequestException('pageNumber must be >= 0');

    const totalPages = await this.pageCountService.ensure(file);
    if (totalPages == null) throw new NotFoundException(`Unable to determine page count for file ${file.id}`);
    if (pageNumber >= totalPages) throw new BadRequestException(`pageNumber ${pageNumber} is out of range (0-${totalPages - 1})`);

    if (file.format === 'pdf') {
      const path = await this.pdfPageService.ensurePage(file.id, file.absolutePath, pageNumber);
      return { stream: createReadStream(path), mimeType: 'image/jpeg', totalPages };
    }

    const { stream, mimeType } = await this.cbzService.streamPage(file.id, pageNumber, user);
    return { stream, mimeType, totalPages };
  }

  async invalidateCache(file: PseFile): Promise<void> {
    if (file.format === 'pdf') await this.pdfPageService.invalidate(file.id);
  }
}
