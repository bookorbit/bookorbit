// Shared 7z-wasm singleton - one WASM instance for the server lifetime.
// The comic reader, metadata extraction and release archives all use this.

import { randomUUID } from 'crypto';

export interface SevenZipFS {
  open(path: string, flags: string): number;
  write(fd: number, buf: Uint8Array, offset: number, length: number): number;
  close(fd: number): void;
  mkdir(path: string): void;
  readdir(path: string): string[];
  readFile(path: string): Uint8Array;
  /** An entry's size and kind without reading it, which is what bounds an extraction. */
  stat(path: string): { mode: number; size: number };
  isDir(mode: number): boolean;
  unlink(path: string): void;
  rmdir(path: string): void;
}

export interface SevenZipModule {
  FS: SevenZipFS;
  callMain(args: string[]): void;
}

let _instance: SevenZipModule | null = null;
let _instancePromise: Promise<SevenZipModule> | null = null;

export async function getSevenZip(): Promise<SevenZipModule> {
  if (_instance) return _instance;

  if (!_instancePromise) {
    _instancePromise = import('7z-wasm')
      .then((mod) => {
        const factory = (mod.default ?? mod) as unknown as (opts?: object) => Promise<SevenZipModule>;
        return factory();
      })
      .then((module) => {
        _instance = module;
        return module;
      })
      .catch((error) => {
        _instancePromise = null;
        throw error;
      });
  }
  return _instancePromise;
}

/**
 * A name for one caller's scratch directory in the shared WASM filesystem.
 *
 * There is one instance for the whole server, so two extractions running at once share a
 * filesystem: anything derived from the clock collides, and a collision means one of them removes
 * the other's tree while it is still being read.
 */
export function createSevenZipTempId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
