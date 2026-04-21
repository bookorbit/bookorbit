import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { SmartScopeController } from './smart-scope.controller';
import { SmartScopeRepository } from './smart-scope.repository';
import { SmartScopeService } from './smart-scope.service';

@Module({
  imports: [BookModule, LibraryModule],
  controllers: [SmartScopeController],
  providers: [SmartScopeService, SmartScopeRepository],
  exports: [SmartScopeService],
})
export class SmartScopeModule {}
