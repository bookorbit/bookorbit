import 'reflect-metadata';

import { FolderInsightService } from './folder-insight.service';
import { PathController } from './path.controller';
import { PathModule } from './path.module';
import { PathPolicyService } from './path-policy.service';
import { PathRepository } from './path.repository';
import { PathService } from './path.service';

describe('PathModule', () => {
  it('registers the path controller, its services and the library folder repository', () => {
    expect(Reflect.getMetadata('controllers', PathModule)).toEqual([PathController]);
    expect(Reflect.getMetadata('providers', PathModule)).toEqual([PathPolicyService, PathService, PathRepository, FolderInsightService]);
    expect(Reflect.getMetadata('exports', PathModule)).toEqual([PathPolicyService]);
  });
});
