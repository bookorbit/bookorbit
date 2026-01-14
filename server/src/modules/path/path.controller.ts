import { Controller, Get, Query } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PathService } from './path.service';

@Controller('path')
export class PathController {
  constructor(private readonly pathService: PathService) {}

  @Get()
  @RequirePermission('manage_libraries')
  listDirectories(@Query('path') path: string) {
    return this.pathService.listDirectories(path || '/');
  }
}
