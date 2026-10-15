import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { ServerIdentityResponse } from '@bookorbit/types';

import { ServerIdentityRepository } from './server-identity.repository';

@Injectable()
export class ServerIdentityService {
  private identityFlight?: Promise<ServerIdentityResponse>;

  constructor(private readonly repository: ServerIdentityRepository) {}

  getIdentity(): Promise<ServerIdentityResponse> {
    this.identityFlight ??= this.load().catch((error: unknown) => {
      this.identityFlight = undefined;
      throw error;
    });
    return this.identityFlight;
  }

  private async load(): Promise<ServerIdentityResponse> {
    const instanceId = await this.repository.getOrCreate();
    if (!instanceId) throw new ServiceUnavailableException('Server identity is unavailable');
    return { product: 'bookorbit', protocolVersion: 1, instanceId };
  }
}
