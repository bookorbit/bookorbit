import type {
  FolderInspection,
  FolderListing,
  FolderPlaces,
  FolderSearchResult,
  FolderSummary,
  PathConfig,
  UnclaimedFolders,
} from '@bookorbit/types';
import { Permission } from '@bookorbit/types';
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateFolderDto } from './dto/create-folder.dto';
import { FolderPathQueryDto } from './dto/folder-path-query.dto';
import { FolderSummariesDto } from './dto/folder-summaries.dto';
import { SearchFoldersQueryDto } from './dto/search-folders-query.dto';
import { FolderInsightService } from './folder-insight.service';
import { PathService } from './path.service';

@Controller('path')
export class PathController {
  constructor(
    private readonly pathService: PathService,
    private readonly folderInsight: FolderInsightService,
  ) {}

  @Get('config')
  @RequirePermission(Permission.ManageLibraries)
  getConfig(): PathConfig {
    return this.pathService.getConfig();
  }

  @Get()
  @RequirePermission(Permission.ManageLibraries)
  listDirectories(@Query('path') path?: string) {
    return this.pathService.listDirectories(path);
  }

  @Get('listing')
  @RequirePermission(Permission.ManageLibraries)
  listFolder(@Query() query: FolderPathQueryDto): Promise<FolderListing> {
    return this.pathService.listFolder(query.path);
  }

  @Post('summaries')
  @HttpCode(200)
  @RequirePermission(Permission.ManageLibraries)
  summarize(@Body() dto: FolderSummariesDto): Promise<FolderSummary[]> {
    return this.folderInsight.summarize(dto.paths);
  }

  @Get('inspect')
  @RequirePermission(Permission.ManageLibraries)
  inspect(@Query() query: FolderPathQueryDto): Promise<FolderInspection> {
    return this.folderInsight.inspect(query.path ?? '');
  }

  @Get('search')
  @RequirePermission(Permission.ManageLibraries)
  search(@Query() query: SearchFoldersQueryDto): Promise<FolderSearchResult> {
    return this.pathService.searchFolders(query.q, query.path, query.system === 'true');
  }

  @Get('places')
  @RequirePermission(Permission.ManageLibraries)
  places(): Promise<FolderPlaces> {
    return this.pathService.getPlaces();
  }

  @Get('unclaimed')
  @RequirePermission(Permission.ManageLibraries)
  unclaimed(): Promise<UnclaimedFolders> {
    return this.folderInsight.unclaimed();
  }

  @Post()
  @RequirePermission(Permission.ManageLibraries)
  async createFolder(@Body() dto: CreateFolderDto) {
    const created = await this.pathService.createDirectory(dto.parentPath, dto.name);
    this.folderInsight.forget();
    return created;
  }
}
