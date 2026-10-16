import type { SevenZipFS, SevenZipModule } from '../../../common/sevenzip';

const DIR_MODE = 0o040000;
const FILE_MODE = 0o100000;
const LINK_MODE = 0o120000;

interface FakeNode {
  mode: number;
  data?: Uint8Array;
  target?: string;
}

/** An archive entry: file contents, or `{ link }` for a symbolic link with that target. */
export type FakeArchiveEntry = string | { link: string };

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? '/' : path.slice(0, slash);
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/**
 * A small in-memory stand-in for the 7z-wasm module: enough of the Emscripten filesystem for the
 * comic reader, and a `callMain` whose `x` writes `archive` under the `-o` folder with its folders
 * kept, the way 7-Zip does.
 */
export class FakeSevenZip implements SevenZipModule {
  readonly nodes = new Map<string, FakeNode>([['/', { mode: DIR_MODE }]]);
  readonly calls: string[][] = [];
  private readonly handles: string[] = [];

  constructor(public archive: Record<string, FakeArchiveEntry> = {}) {}

  readonly FS: SevenZipFS = {
    open: (path) => {
      this.nodes.set(path, { mode: FILE_MODE, data: new Uint8Array() });
      return this.handles.push(path) - 1;
    },
    write: (fd, buf, offset, length) => {
      this.nodes.get(this.handles[fd]!)!.data = Uint8Array.from(buf.subarray(offset, offset + length));
      return length;
    },
    close: () => undefined,
    mkdir: (path) => {
      if (this.nodes.has(path)) throw errno('EEXIST');
      this.nodes.set(path, { mode: DIR_MODE });
    },
    readdir: (path) => {
      if (this.nodes.get(path)?.mode !== DIR_MODE) throw errno('ENOTDIR');
      const children = [...this.nodes.keys()].filter((key) => key !== '/' && key !== path && parentOf(key) === path);
      return ['.', '..', ...children.map((key) => key.slice(key.lastIndexOf('/') + 1))];
    },
    readFile: (path) => {
      const node = this.nodes.get(this.FS.lookupPath(path, { follow: true }).path);
      if (node?.mode !== FILE_MODE) throw errno('ENOENT');
      return node.data!;
    },
    stat: (path) => this.FS.lstat(this.FS.lookupPath(path, { follow: true }).path),
    lstat: (path) => {
      const node = this.nodes.get(path);
      if (!node) throw errno('ENOENT');
      return { mode: node.mode, size: node.data?.length ?? 0 };
    },
    lookupPath: (path, opts) => {
      let current = path;
      for (let hops = 0; hops < 8; hops++) {
        const node = this.nodes.get(current);
        if (!node) throw errno('ENOENT');
        if (node.mode !== LINK_MODE || !opts?.follow) return { path: current };
        current = node.target!.startsWith('/') ? normalize(node.target!) : normalize(`${parentOf(current)}/${node.target}`);
      }
      throw errno('ELOOP');
    },
    isDir: (mode) => mode === DIR_MODE,
    isFile: (mode) => mode === FILE_MODE,
    isLink: (mode) => mode === LINK_MODE,
    unlink: (path) => {
      const node = this.nodes.get(path);
      if (!node || node.mode === DIR_MODE) throw errno('EISDIR');
      this.nodes.delete(path);
    },
    rmdir: (path) => {
      if (this.nodes.get(path)?.mode !== DIR_MODE) throw errno('ENOTDIR');
      if (this.FS.readdir(path).length > 2) throw errno('ENOTEMPTY');
      this.nodes.delete(path);
    },
  };

  callMain(args: string[]): void {
    this.calls.push(args);
    const outArg = args.find((arg) => arg.startsWith('-o'));
    if (args[0] !== 'x' || !outArg) return;
    const outDir = outArg.slice(2);
    for (const [entryPath, entry] of Object.entries(this.archive)) {
      const path = `${outDir}/${entryPath}`;
      this.ensureDir(parentOf(path));
      this.nodes.set(path, typeof entry === 'string' ? { mode: FILE_MODE, data: Buffer.from(entry) } : { mode: LINK_MODE, target: entry.link });
    }
  }

  addFile(path: string, contents: string): void {
    this.ensureDir(parentOf(path));
    this.nodes.set(path, { mode: FILE_MODE, data: Buffer.from(contents) });
  }

  paths(): string[] {
    return [...this.nodes.keys()].filter((key) => key !== '/').sort();
  }

  private ensureDir(path: string): void {
    if (path === '/' || this.nodes.has(path)) return;
    this.ensureDir(parentOf(path));
    this.nodes.set(path, { mode: DIR_MODE });
  }
}
