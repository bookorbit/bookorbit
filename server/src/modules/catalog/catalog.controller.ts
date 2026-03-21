import { Controller, Get, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';

@Controller('metadata')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('authors')
  searchAuthors(@Query('q') q = '') {
    return this.catalogService.searchAuthors(q);
  }

  @Get('genres')
  searchGenres(@Query('q') q = '') {
    return this.catalogService.searchGenres(q);
  }

  @Get('tags')
  searchTags(@Query('q') q = '') {
    return this.catalogService.searchTags(q);
  }

  @Get('narrators')
  searchNarrators(@Query('q') q = '') {
    return this.catalogService.searchNarrators(q);
  }

  @Get('publishers')
  searchPublishers(@Query('q') q = '') {
    return this.catalogService.searchPublishers(q);
  }

  @Get('series')
  searchSeries(@Query('q') q = '') {
    return this.catalogService.searchSeries(q);
  }

  @Get('languages')
  searchLanguages(@Query('q') q = '') {
    return this.catalogService.searchLanguages(q);
  }

  @Get('collections')
  searchCollections(@CurrentUser() user: { id: number }, @Query('q') q = '') {
    return this.catalogService.searchCollections(user.id, q);
  }
}
