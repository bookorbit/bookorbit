// Shared 7z-wasm singleton — one WASM instance for the server lifetime.
// Both the comic reader service and metadata extraction use this.

export interface SevenZipFS {
  open(path: string, flags: string): number;
  write(fd: number, buf: Uint8Array, offset: number, length: number): number;
  close(fd: number): void;
  mkdir(path: string): void;
  readdir(path: string): string[];
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  rmdir(path: string): void;
}

export interface SevenZipModule {
  FS: SevenZipFS;
  callMain(args: string[]): void;
}

let _instance: SevenZipModule | null = null;

export async function getSevenZip(): Promise<SevenZipModule> {
  if (!_instance) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const factory = require('7z-wasm') as (opts?: object) => Promise<SevenZipModule>;
    _instance = await factory();
  }
  return _instance;
}
