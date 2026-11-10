import { Global, Module } from '@nestjs/common';

import { DbModule } from '../../db/db.module';
import { LibraryScopeRepository } from './library-scope.repository';
import { LibraryScopeService } from './library-scope.service';

@Global()
@Module({
  imports: [DbModule],
  providers: [LibraryScopeRepository, LibraryScopeService],
  exports: [LibraryScopeService],
})
export class LibraryScopeModule {}
