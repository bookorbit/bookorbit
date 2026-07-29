#!/usr/bin/env node

// Verifies that what Crowdin would export for a language matches the catalog in
// Git, and optionally reconciles the difference.
//
// Crowdin's bulk translation import is lossy: it silently skips entries that the
// per-string translation endpoint accepts, so a language can report a healthy
// percentage while real translations are missing. Because untranslated strings
// export as English source text, those gaps come back as a pull request that
// overwrites good translations in Git. The progress percentage cannot detect
// this; only diffing the built export against the catalog can.
//
// Usage:
//   CROWDIN_TOKEN=... node scripts/crowdin-verify/verify.mjs es-ES es.json
//   CROWDIN_TOKEN=... node scripts/crowdin-verify/verify.mjs es-ES es.json --reconcile
//
// Exits non-zero while any key still differs, so it can gate enabling export for
// a newly seeded language.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API = "https://api.crowdin.com/api/v2";
const SOURCE_PATH_SUFFIX = "/client/src/locales/en.json";
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const localesDirectory = path.join(repoRoot, "client/src/locales");

export function flattenMessages(value, prefix = "", output = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const messageKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") output.set(messageKey, child);
    else if (child && typeof child === "object") flattenMessages(child, messageKey, output);
  }
  return output;
}

export function differingKeys(desired, exported) {
  return [...desired.keys()].filter((key) => exported.get(key) !== desired.get(key));
}

export function parseArguments(argv) {
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  if (positional.length !== 2) {
    throw new Error("Usage: verify.mjs <crowdinLanguageId> <catalogFile> [--reconcile]");
  }
  return {
    languageId: positional[0],
    catalogFile: positional[1],
    reconcile: argv.includes("--reconcile"),
  };
}

function createClient(token, projectId) {
  async function request(endpoint, init = {}) {
    const response = await fetch(`${API}${endpoint}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${endpoint}: ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : null;
  }

  return {
    request,

    async sourceFileId() {
      for (let offset = 0; ; offset += 500) {
        const page = await request(`/projects/${projectId}/files?limit=500&offset=${offset}`);
        const match = page.data.find((entry) => entry.data.path.endsWith(SOURCE_PATH_SUFFIX));
        if (match) return match.data.id;
        if (page.data.length < 500) throw new Error(`No source file ending in ${SOURCE_PATH_SUFFIX}`);
      }
    },

    async stringIds(fileId) {
      const ids = new Map();
      for (let offset = 0; ; offset += 500) {
        const page = await request(`/projects/${projectId}/strings?fileId=${fileId}&limit=500&offset=${offset}`);
        for (const entry of page.data) ids.set(entry.data.identifier, entry.data.id);
        if (page.data.length < 500) return ids;
      }
    },

    async exportedCatalog(fileId, languageId) {
      const link = await request(`/projects/${projectId}/translations/builds/files/${fileId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLanguageId: languageId }),
      });
      const download = await fetch(link.data.url);
      if (!download.ok) throw new Error(`Export download failed: ${download.status}`);
      return flattenMessages(JSON.parse(await download.text()));
    },

    async putTranslation(languageId, stringId, text) {
      try {
        await request(`/projects/${projectId}/translations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stringId, languageId, text }),
        });
        return;
      } catch (error) {
        if (!/Duplicate translation/i.test(error.message)) throw error;
      }

      // The wanted text already exists for this string but a newer translation
      // shadows it, so Crowdin rejects the write as a duplicate. Crowdin exports
      // the most recent translation, so drop the newer ones to make the wanted
      // text current again. Older history is left alone.
      const existing = await request(`/projects/${projectId}/translations?stringId=${stringId}&languageId=${languageId}&limit=100`);
      const match = existing.data.find((entry) => entry.data.text === text);
      if (!match) throw new Error(`Duplicate translation reported for string ${stringId} but no stored translation matches the catalog value`);

      const shadowing = existing.data.filter(
        (entry) => entry.data.id !== match.data.id && Date.parse(entry.data.createdAt) >= Date.parse(match.data.createdAt),
      );
      for (const entry of shadowing) {
        await request(`/projects/${projectId}/translations/${entry.data.id}`, { method: "DELETE" });
      }
    },
  };
}

async function main() {
  const { languageId, catalogFile, reconcile } = parseArguments(process.argv.slice(2));
  const token = process.env.CROWDIN_TOKEN;
  if (!token) throw new Error("CROWDIN_TOKEN is required");
  const projectId = process.env.CROWDIN_PROJECT_ID ?? "912891";

  const client = createClient(token, projectId);
  const fileId = await client.sourceFileId();
  const desired = flattenMessages(JSON.parse(await readFile(path.join(localesDirectory, catalogFile), "utf8")));

  // Crowdin serves a briefly cached export build, so a rebuild taken immediately
  // after a write can still show the old content. Retry before believing a
  // non-zero result.
  async function differencesNow(attempts = 1) {
    let missing = [];
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      missing = differingKeys(desired, await client.exportedCatalog(fileId, languageId));
      if (missing.length === 0) return missing;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    return missing;
  }

  let missing = await differencesNow();
  console.log(`${languageId}: ${missing.length} of ${desired.size} keys differ from ${catalogFile}`);

  if (missing.length > 0 && reconcile) {
    const ids = await client.stringIds(fileId);
    let pushed = 0;
    for (const key of missing) {
      const stringId = ids.get(key);
      if (!stringId) {
        console.log(`  skipped ${key}: not present in Crowdin`);
        continue;
      }
      await client.putTranslation(languageId, stringId, desired.get(key));
      pushed += 1;
    }
    console.log(`  pushed ${pushed} translations through the per-string endpoint`);
    missing = await differencesNow(4);
    console.log(`${languageId}: ${missing.length} keys still differ after reconcile`);
  }

  for (const key of missing.slice(0, 20)) console.log(`  ~ ${key}`);
  if (missing.length > 20) console.log(`  ... and ${missing.length - 20} more`);

  if (missing.length > 0) {
    console.error(`\n${languageId} is NOT safe to export: Crowdin would overwrite ${missing.length} keys in ${catalogFile}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${languageId} matches ${catalogFile} exactly; exporting cannot change it.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
