import { Controller } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { KoboService } from './kobo.service';

@Controller('kobo')
@RequirePermission('kobo_sync')
export class KoboController {
  constructor(private readonly koboService: KoboService) {}
}
