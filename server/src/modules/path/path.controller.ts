import { Permission } from '@projectx/types';
import { Controller, Get, Query } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PathService } from './path.service';

@Controller('path')
export class PathController {
  constructor(private readonly pathService: PathService) {}

  @Get()
  @RequirePermission(Permission.ManageLibraries)
  listDirectories(@Query('path') path: string) {
    return this.pathService.listDirectories(path || '/');
  }
}
