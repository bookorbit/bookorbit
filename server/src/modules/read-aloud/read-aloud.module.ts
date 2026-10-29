import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import { AuthModule } from '../auth/auth.module';
import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { NotificationModule } from '../notification/notification.module';
import { UploadModule } from '../upload/upload.module';
import { UserModule } from '../user/user.module';
import { ReadAloudActivityService } from './read-aloud-activity.service';
import { ReadAloudEventRepository } from './read-aloud-event.repository';
import { ReadAloudJobRepository } from './read-aloud-job.repository';
import { ReadAloudLifecycleService } from './read-aloud-lifecycle.service';
import { ReadAloudNotifier } from './read-aloud-notifier.service';
import { ReadAloudPresenter } from './read-aloud-presenter.service';
import { ReadAloudPublisher } from './read-aloud-publisher.service';
import { ReadAloudController } from './read-aloud.controller';
import { ReadAloudGateway } from './read-aloud.gateway';
import { ReadAloudService } from './read-aloud.service';
import { ReadAloudWorkerClientService } from './read-aloud-worker-client.service';
import { ReadAloudWorkerService } from './read-aloud-worker.service';
import { ReadAloudWorkspace } from './read-aloud-workspace.service';

@Module({
  imports: [
    AuthModule,
    BookModule,
    LibraryModule,
    NotificationModule,
    UploadModule,
    UserModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.getOrThrow<StringValue | number>('auth.jwtExpiresIn') },
      }),
    }),
  ],
  controllers: [ReadAloudController],
  providers: [
    ReadAloudActivityService,
    ReadAloudEventRepository,
    ReadAloudGateway,
    ReadAloudJobRepository,
    ReadAloudLifecycleService,
    ReadAloudNotifier,
    ReadAloudPresenter,
    ReadAloudPublisher,
    ReadAloudService,
    ReadAloudWorkerClientService,
    ReadAloudWorkerService,
    ReadAloudWorkspace,
  ],
})
export class ReadAloudModule {}
