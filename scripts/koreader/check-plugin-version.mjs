#!/usr/bin/env node

// Fails a release when the KOReader plugin changed since the previous release
// tag but PLUGIN_VERSION did not move forward. Devices only download a plugin
// whose version differs from theirs, so an unchanged version ships nothing.
// Usage: check-plugin-version.mjs [previous-tag]   Default: the newest v* tag.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = "koreader-plugin/bookorbit.koplugin";
const MAIN_LUA = `${PLUGIN_DIR}/main.lua`;

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export const readVersion = (source) => source.match(/^local PLUGIN_VERSION = "([^"]+)"/m)?.[1] ?? null;

const parts = (version) => version.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));

export const isNewer = (next, previous) => {
  const a = parts(next);
  const b = parts(previous);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x > y;
    return String(x) > String(y);
  }
  return false;
};

export const checkPluginVersion = ({ cwd = process.cwd(), previousTag } = {}) => {
  let tag = previousTag;
  if (!tag) {
    try {
      tag = git(["describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD"], cwd);
    } catch {
      return { ok: true, message: "No previous release tag: nothing to compare." };
    }
  }

  const changed = git(["diff", "--name-only", tag, "HEAD", "--", PLUGIN_DIR], cwd);
  if (!changed) {
    return { ok: true, message: `The KOReader plugin is unchanged since ${tag}.` };
  }

  const current = readVersion(readFileSync(`${cwd}/${MAIN_LUA}`, "utf8"));
  let previous = null;
  try {
    previous = readVersion(git(["show", `${tag}:${MAIN_LUA}`], cwd));
  } catch {
    previous = null;
  }
  if (!current) {
    return { ok: false, message: `${MAIN_LUA} has no PLUGIN_VERSION.` };
  }
  if (!previous) {
    return { ok: true, message: `The KOReader plugin is new since ${tag}, at ${current}.` };
  }
  if (!isNewer(current, previous)) {
    const files = changed.split("\n").length;
    return {
      ok: false,
      message:
        `${files} file(s) under ${PLUGIN_DIR} changed since ${tag}, but PLUGIN_VERSION is ${current} (was ${previous}). ` +
        `Raise PLUGIN_VERSION in ${MAIN_LUA} so devices download the new plugin.`,
    };
  }
  return { ok: true, message: `KOReader plugin ${previous} -> ${current} since ${tag}.` };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = checkPluginVersion({ previousTag: process.argv[2] });
  if (result.ok) {
    console.log(result.message);
  } else {
    console.error(`::error::${result.message}`);
    process.exit(1);
  }
}
