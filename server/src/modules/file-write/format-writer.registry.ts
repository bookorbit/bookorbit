import { Inject, Injectable } from '@nestjs/common';

import type { FormatWriter } from './interfaces/format-writer.interface';
import { FORMAT_WRITERS } from './interfaces/format-writer.interface';

@Injectable()
export class FormatWriterRegistry {
  private readonly map: Map<string, FormatWriter>;

  constructor(@Inject(FORMAT_WRITERS) writers: FormatWriter[]) {
    this.map = new Map((writers ?? []).map((w) => [w.format.toLowerCase(), w]));
  }

  get(format: string): FormatWriter | undefined {
    return this.map.get(format.toLowerCase());
  }

  supports(format: string): boolean {
    return this.map.has(format.toLowerCase());
  }
}
