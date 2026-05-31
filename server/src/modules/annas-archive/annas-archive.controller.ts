import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AnnasArchiveService } from './annas-archive.service';
import { SearchAnnasArchiveDto } from './dto/search-annas-archive.dto';
import { StartDownloadDto } from './dto/start-download.dto';

@Controller('annas-archive')
@RequirePermission(Permission.LibraryUpload)
export class AnnasArchiveController {
  constructor(private readonly service: AnnasArchiveService) {}

  @Get('search')
  search(@Query() query: SearchAnnasArchiveDto) {
    return this.service.search(query.q, query.ext, query.lang);
  }

  @Get('md5/:md5/links')
  getDownloadLinks(@Param('md5') md5: string) {
    return this.service.getDownloadLinks(md5);
  }

  @Post('download')
  startDownload(@Body() dto: StartDownloadDto) {
    return this.service.startDownload(dto);
  }

  @Get('downloads')
  listDownloads() {
    return this.service.listDownloads();
  }

  @Get('downloads/:id')
  getDownload(@Param('id') id: string) {
    return this.service.getDownload(id);
  }

  @Get('domains')
  getActiveDomains() {
    return this.service.getActiveDomains();
  }

  @Post('domains/refresh')
  refreshDomains() {
    return this.service.refreshDomains();
  }
}
