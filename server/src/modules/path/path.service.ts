import { Injectable } from '@nestjs/common';
import { readdir, stat } from 'fs/promises';
import { join, resolve, sep } from 'path';

const BLOCKED = ['/proc', '/sys', '/dev', '/run', '/var/run'];

@Injectable()
export class PathService {
  async listDirectories(rawPath: string): Promise<{ name: string; path: string }[]> {
    const resolved = resolve(rawPath || '/');
    if (BLOCKED.some((b) => resolved === b || resolved.startsWith(b + sep))) {
      return [];
    }
    try {
      const entries = await readdir(resolved, { withFileTypes: true });
      const dirs: { name: string; path: string }[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name.startsWith('.')) continue;
        const full = join(resolved, entry.name);
        try {
          const s = await stat(full);
          if (s.isDirectory()) dirs.push({ name: entry.name, path: full });
        } catch {
          // skip inaccessible entries
        }
      }
      return dirs.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }
}
