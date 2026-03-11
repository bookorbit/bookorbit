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
