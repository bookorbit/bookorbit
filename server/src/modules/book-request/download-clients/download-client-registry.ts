import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { DownloadClientType } from '@bookorbit/types';

import { DOWNLOAD_CLIENT_ADAPTERS, type DownloadClientAdapter } from './download-client-adapter';

@Injectable()
export class DownloadClientRegistry {
  constructor(@Inject(DOWNLOAD_CLIENT_ADAPTERS) private readonly adapters: DownloadClientAdapter[]) {}

  all(): DownloadClientAdapter[] {
    return this.adapters;
  }

  find(type: DownloadClientType): DownloadClientAdapter | undefined {
    return this.adapters.find((adapter) => adapter.type === type);
  }

  /** Used on every grab and poll, so a row whose type was dropped from the build fails loudly. */
  require(type: DownloadClientType): DownloadClientAdapter {
    const adapter = this.find(type);
    if (!adapter) throw new BadRequestException(`Unknown download client type: ${type}`);
    return adapter;
  }
}
