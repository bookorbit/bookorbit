import 'reflect-metadata';

import { PathController } from './path.controller';
import { PathModule } from './path.module';
import { PathService } from './path.service';

describe('PathModule', () => {
  it('registers path controller and service', () => {
    expect(Reflect.getMetadata('controllers', PathModule)).toEqual([PathController]);
    expect(Reflect.getMetadata('providers', PathModule)).toEqual([PathService]);
  });
});
