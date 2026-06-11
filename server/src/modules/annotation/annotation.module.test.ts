import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { BookModule } from '../book/book.module';
import { AnnotationController } from './annotation.controller';
import { AnnotationHubController } from './annotation-hub.controller';
import { AnnotationHubService } from './annotation-hub.service';
import { AnnotationModule } from './annotation.module';
import { AnnotationRepository } from './annotation.repository';
import { AnnotationService } from './annotation.service';
import { AnnotationSyncService } from './annotation-sync.service';

describe('AnnotationModule', () => {
  it('registers expected imports, controller, and providers', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AnnotationModule);
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AnnotationModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AnnotationModule);

    expect(imports).toEqual(expect.arrayContaining([BookModule]));
    expect(controllers).toEqual([AnnotationController, AnnotationHubController]);
    expect(providers).toEqual(expect.arrayContaining([AnnotationService, AnnotationRepository, AnnotationSyncService, AnnotationHubService]));
  });
});
