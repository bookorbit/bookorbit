#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const [baseSha, headSha, isCrowdin] = process.argv.slice(2);

if (!baseSha || !headSha || !["true", "false"].includes(isCrowdin)) {
  console.error("usage: validate-locale-pr.mjs <base-sha> <head-sha> <is-crowdin>");
  process.exit(2);
}

if (isCrowdin === "true") {
  process.exit(0);
}

const git = (args, options = {}) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });

const pathExists = (revision, path) => {
  try {
    git(["cat-file", "-e", `${revision}:${path}`]);
    return true;
  } catch {
    return false;
  }
};

const changedPaths = git(["diff", "--name-only", "-z", baseSha, headSha]).split("\0").filter(Boolean);

const targetCatalogs = changedPaths.filter((path) => /^client\/src\/locales\/[^/]+\.json$/.test(path) && path !== "client/src/locales/en.json");

const errors = [];

for (const path of targetCatalogs) {
  if (pathExists(baseSha, path)) {
    errors.push(`${path} is a Crowdin-owned target catalog and cannot be changed in an ordinary pull request.`);
    continue;
  }

  if (!pathExists(headSha, path)) {
    errors.push(`${path} cannot be deleted or renamed in an ordinary pull request.`);
    continue;
  }

  const contents = git(["show", `${headSha}:${path}`]);
  let catalog;

  try {
    catalog = JSON.parse(contents);
  } catch {
    errors.push(`${path} must be valid JSON.`);
    continue;
  }

  const isEmptyObject = catalog !== null && typeof catalog === "object" && !Array.isArray(catalog) && Object.keys(catalog).length === 0;

  if (!isEmptyObject) {
    errors.push(`${path} is a new target catalog but is not empty. New languages must start with an empty catalog before Crowdin export is enabled.`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`::error::${error}`);
  }
  console.error(
    "::error::Add or update application copy only in client/src/locales/en.json. Apply translations in Crowdin and let the controlled translation workflow update target catalogs.",
  );
  process.exit(1);
}
