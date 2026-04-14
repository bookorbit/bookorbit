import { Module } from '@nestjs/common';

import { OidcIdentityRepository } from './oidc-identity.repository';
import { UserAvatarStorageService } from './user-avatar-storage.service';
import { UserAvatarService } from './user-avatar.service';
import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  controllers: [UserController],
  providers: [UserService, UserRepository, UserAvatarService, UserAvatarStorageService, OidcIdentityRepository],
  exports: [UserService, UserRepository, UserAvatarService, UserAvatarStorageService, OidcIdentityRepository],
})
export class UserModule {}
