import { Controller, Get, MessageEvent, Query, Sse } from '@nestjs/common';
import { MetadataCandidate, MetadataProviderInfo } from '@projectx/types';
import { map, Observable } from 'rxjs';

import { LookupMetadataDto } from './dto/lookup-metadata.dto';
import { MetadataSearchDto } from './dto/metadata-search.dto';
import { MetadataFetchService } from './metadata-fetch.service';
import { ProviderRegistry } from './provider-registry';
import { MetadataSearchParams } from './providers/metadata-search-params';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';

@Controller('metadata-fetch')
export class MetadataFetchController {
  constructor(
    private readonly metadataFetchService: MetadataFetchService,
    private readonly registry: ProviderRegistry,
    private readonly providerConfig: ProviderConfigService,
  ) {}

  @Get('providers')
  async listProviders(): Promise<MetadataProviderInfo[]> {
    const config = await this.providerConfig.getConfig();
    return this.registry
      .all()
      .filter((p) => config[p.key]?.enabled !== false)
      .map((p) => ({
        key: p.key,
        label: p.label,
        identifiable: p.identifiable,
      }));
  }

  @Sse('stream')
  async stream(@Query() dto: MetadataSearchDto): Promise<Observable<MessageEvent>> {
    const existingProviderIds = dto.bookId ? await this.metadataFetchService.getStoredProviderIds(dto.bookId) : {};

    const params: MetadataSearchParams = {
      title: dto.title,
      author: dto.author,
      isbn: dto.isbn,
      existingProviderIds,
    };

    return this.metadataFetchService.search(params, dto.providers).pipe(map((candidate: MetadataCandidate) => ({ data: candidate })));
  }

  @Get('lookup')
  async lookup(@Query() dto: LookupMetadataDto): Promise<MetadataCandidate | null> {
    return this.metadataFetchService.lookupById(dto.provider, dto.id);
  }
}
