import { Module } from '@nestjs/common';

import { UserAvatarStorageService } from './user-avatar-storage.service';
import { UserAvatarService } from './user-avatar.service';
import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  controllers: [UserController],
  providers: [UserService, UserRepository, UserAvatarService, UserAvatarStorageService],
  exports: [UserService, UserRepository, UserAvatarService, UserAvatarStorageService],
})
export class UserModule {}
