import { Controller, Get, Query } from '@nestjs/common';

import { CatalogService } from './catalog.service';

@Controller('metadata')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('authors')
  searchAuthors(@Query('q') q = '') {
    return this.catalogService.searchAuthors(q);
  }

  @Get('tags')
  searchTags(@Query('q') q = '') {
    return this.catalogService.searchTags(q);
  }
}
