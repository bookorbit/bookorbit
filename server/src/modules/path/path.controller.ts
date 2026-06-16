import { Permission } from '@bookorbit/types';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateFolderDto } from './dto/create-folder.dto';
import { PathService } from './path.service';

@Controller('path')
export class PathController {
  constructor(private readonly pathService: PathService) {}

  @Get()
  @RequirePermission(Permission.ManageLibraries)
  listDirectories(@Query('path') path: string) {
    return this.pathService.listDirectories(path || '/');
  }

  @Post()
  @RequirePermission(Permission.ManageLibraries)
  createFolder(@Body() dto: CreateFolderDto) {
    return this.pathService.createDirectory(dto.parentPath, dto.name);
  }
}
