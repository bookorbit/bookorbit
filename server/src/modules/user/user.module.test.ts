import 'reflect-metadata';

import { OidcIdentityRepository } from './oidc-identity.repository';
import { UserController } from './user.controller';
import { UserAvatarStorageService } from './user-avatar-storage.service';
import { UserAvatarService } from './user-avatar.service';
import { UserModule } from './user.module';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

describe('UserModule', () => {
  it('registers expected controller/providers/exports', () => {
    expect(Reflect.getMetadata('controllers', UserModule)).toEqual([UserController]);
    expect(Reflect.getMetadata('providers', UserModule)).toEqual([
      UserService,
      UserRepository,
      UserAvatarService,
      UserAvatarStorageService,
      OidcIdentityRepository,
    ]);
    expect(Reflect.getMetadata('exports', UserModule)).toEqual([
      UserService,
      UserRepository,
      UserAvatarService,
      UserAvatarStorageService,
      OidcIdentityRepository,
    ]);
  });
});
