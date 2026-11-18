import { Module } from '@nestjs/common';

import { DeliveryRepository } from './delivery.repository';
import { DeliverySetupFlow } from './delivery.setup-flow';
import { SetupFlowRegistry } from './setup-flow.registry';
import { SetupOverviewController } from './setup-overview.controller';
import { SetupOverviewService } from './setup-overview.service';

/**
 * The Setup Overview page's own module. It holds the registry and the route; the cards themselves
 * are contributed by the modules that own the settings, which import this one for the registry.
 */
@Module({
  controllers: [SetupOverviewController],
  providers: [SetupFlowRegistry, SetupOverviewService, DeliveryRepository, DeliverySetupFlow],
  exports: [SetupFlowRegistry],
})
export class SetupOverviewModule {}
