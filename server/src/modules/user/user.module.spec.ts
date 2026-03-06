import 'reflect-metadata';

import { UserController } from './user.controller';
import { UserModule } from './user.module';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

describe('UserModule', () => {
  it('registers expected controller/providers/exports', () => {
    expect(Reflect.getMetadata('controllers', UserModule)).toEqual([UserController]);
    expect(Reflect.getMetadata('providers', UserModule)).toEqual([UserService, UserRepository]);
    expect(Reflect.getMetadata('exports', UserModule)).toEqual([UserService, UserRepository]);
  });
});
