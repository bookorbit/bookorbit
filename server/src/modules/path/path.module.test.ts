import 'reflect-metadata';

import { PathController } from './path.controller';
import { PathModule } from './path.module';
import { PathPolicyService } from './path-policy.service';
import { PathService } from './path.service';

describe('PathModule', () => {
  it('registers path controller and service', () => {
    expect(Reflect.getMetadata('controllers', PathModule)).toEqual([PathController]);
    expect(Reflect.getMetadata('providers', PathModule)).toEqual([PathPolicyService, PathService]);
    expect(Reflect.getMetadata('exports', PathModule)).toEqual([PathPolicyService]);
  });
});
