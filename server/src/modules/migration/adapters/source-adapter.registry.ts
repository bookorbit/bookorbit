import { BadRequestException, Injectable } from '@nestjs/common';

import type { SourceAdapter } from './source-adapter.types';
import { BookloreSourceAdapter } from './booklore/booklore-source.adapter';

@Injectable()
export class SourceAdapterRegistry {
  private readonly adaptersByType: Map<string, SourceAdapter<any>>;

  constructor(bookloreAdapter: BookloreSourceAdapter) {
    const adapters: SourceAdapter<any>[] = [bookloreAdapter];
    this.adaptersByType = new Map(adapters.map((adapter) => [adapter.type, adapter]));
  }

  listTypes(): string[] {
    return [...this.adaptersByType.keys()].sort();
  }

  get(type: string): SourceAdapter<any> {
    const key = type.trim().toLowerCase();
    const found = this.adaptersByType.get(key);
    if (!found) {
      throw new BadRequestException(`Unsupported migration source type: ${type}`);
    }
    return found;
  }
}
