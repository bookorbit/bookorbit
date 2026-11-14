import { isAbsolute, join, relative, resolve } from "node:path";
import { within } from "./paths.js";

/** One folder as the BookOrbit server names it (`remote`) and as this machine reaches it (`local`). */
export type PathMapping = { remote: string; local: string };

type Env = Record<string, string | undefined>;

/**
 * READ_ALOUD_PATH_MAP: comma-separated `server-path=local-path` pairs for a worker whose view of the
 * shared folders is mounted somewhere else than where the server sees it. Empty means every path the
 * server sends is used as written.
 */
export function parsePathMap(env: Env): PathMapping[] {
  const value = env.READ_ALOUD_PATH_MAP?.trim();
  if (!value) return [];
  const mappings: PathMapping[] = [];
  for (const entry of value.split(",")) {
    const text = entry.trim();
    if (!text) continue;
    const separator = text.indexOf("=");
    const remote = separator < 0 ? "" : text.slice(0, separator).trim();
    const local = separator < 0 ? "" : text.slice(separator + 1).trim();
    if (!isAbsolute(remote) || !isAbsolute(local)) {
      throw new Error(`READ_ALOUD_PATH_MAP entries must look like /server/path=/local/path, got "${text}"`);
    }
    const mapping = { remote: resolve(remote), local: resolve(local) };
    if (isFilesystemRoot(mapping.remote) || isFilesystemRoot(mapping.local)) {
      throw new Error("READ_ALOUD_PATH_MAP must not map a filesystem root");
    }
    if (mappings.some((existing) => existing.remote === mapping.remote)) {
      throw new Error(`READ_ALOUD_PATH_MAP lists the server path ${mapping.remote} twice`);
    }
    if (mappings.some((existing) => existing.local === mapping.local)) {
      throw new Error(`READ_ALOUD_PATH_MAP lists the local path ${mapping.local} twice`);
    }
    mappings.push(mapping);
  }
  return mappings;
}

/**
 * A path the server sent, as this machine reaches it. The longest matching server folder wins; a path
 * outside every mapping is returned untouched, so the usual root checks still reject it.
 */
export function toLocalPath(path: string, map: readonly PathMapping[]): string {
  return translate(path, map, "remote", "local");
}

/** A path on this machine, as the server names it: what the health reply reports. */
export function toRemotePath(path: string, map: readonly PathMapping[]): string {
  return translate(path, map, "local", "remote");
}

function translate(path: string, map: readonly PathMapping[], from: keyof PathMapping, to: keyof PathMapping): string {
  if (map.length === 0 || !isAbsolute(path)) return path;
  // Normalised first, so a `..` cannot step out of a mapped folder after the prefix has matched.
  const normalized = resolve(path);
  let best: PathMapping | null = null;
  for (const mapping of map) {
    if (within(normalized, mapping[from]) && (!best || mapping[from].length > best[from].length)) best = mapping;
  }
  return best ? join(best[to], relative(best[from], normalized)) : path;
}

function isFilesystemRoot(path: string): boolean {
  return resolve(path, "..") === path;
}
