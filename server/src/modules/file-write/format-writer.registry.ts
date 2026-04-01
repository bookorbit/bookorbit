import { Inject, Injectable } from '@nestjs/common';

import type { FormatWriter } from './interfaces/format-writer.interface';
import { FORMAT_WRITERS } from './interfaces/format-writer.interface';

@Injectable()
export class FormatWriterRegistry {
  private readonly map: Map<string, FormatWriter>;

  constructor(@Inject(FORMAT_WRITERS) writers: FormatWriter[]) {
    this.map = new Map();

    for (const writer of writers ?? []) {
      const key = writer.format.toLowerCase();
      if (this.map.has(key)) {
        throw new Error(`Duplicate format writer registered: ${key}`);
      }
      this.map.set(key, writer);
    }
  }

  get(format: string): FormatWriter | undefined {
    return this.map.get(format.toLowerCase());
  }

  supports(format: string): boolean {
    return this.map.has(format.toLowerCase());
  }
}
