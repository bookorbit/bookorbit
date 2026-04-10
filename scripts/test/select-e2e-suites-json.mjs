import { execFileSync } from "node:child_process";
import { matchesGlob } from "node:path";
import process from "node:process";

import { E2E_GLOBAL_CHANGE_PATHS, listE2ESuites } from "./e2e-suites.mjs";

const ZERO_SHA_PATTERN = /^0+$/;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function hasCommit(sha) {
  if (!sha || ZERO_SHA_PATTERN.test(sha)) {
    return false;
  }

  try {
    git(["cat-file", "-e", `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function getChangedFiles(eventName, baseSha, headSha) {
  if (eventName !== "pull_request") {
    return null;
  }

  if (!hasCommit(baseSha) || !hasCommit(headSha)) {
    return null;
  }

  const diffRange = `${baseSha}...${headSha}`;
  const output = git(["diff", "--name-only", diffRange]);
  return output === "" ? [] : output.split("\n").filter(Boolean);
}

function fileMatchesAnyPattern(filePath, patterns) {
  return patterns.some((pattern) => matchesGlob(filePath, pattern));
}

function suiteMatchesChangedFiles(suite, changedFiles) {
  if (!Array.isArray(suite.changedPaths) || suite.changedPaths.length === 0) {
    return false;
  }

  return changedFiles.some((filePath) => fileMatchesAnyPattern(filePath, suite.changedPaths));
}

function toMatrixItems(suites) {
  return suites.map(({ id, name, timeout }) => ({ id, name, timeout }));
}

function selectSuitesForEvent(eventName, changedFiles) {
  const suites = listE2ESuites();

  if (eventName === "workflow_dispatch" || eventName === "push" || eventName === "schedule") {
    return toMatrixItems(suites);
  }

  if (eventName !== "pull_request") {
    return toMatrixItems(suites);
  }

  const smokeSuites = suites.filter((suite) => suite.lane === "smoke");
  if (!changedFiles || changedFiles.length === 0) {
    return changedFiles === null ? toMatrixItems(smokeSuites) : [];
  }

  if (changedFiles.some((filePath) => fileMatchesAnyPattern(filePath, E2E_GLOBAL_CHANGE_PATHS))) {
    return toMatrixItems(smokeSuites);
  }

  return toMatrixItems(smokeSuites.filter((suite) => suiteMatchesChangedFiles(suite, changedFiles)));
}

const eventName = process.env.GITHUB_EVENT_NAME ?? "";
const baseSha = process.env.GITHUB_BASE_SHA ?? "";
const headSha = process.env.GITHUB_HEAD_SHA ?? "";
const changedFiles = getChangedFiles(eventName, baseSha, headSha);
const selectedSuites = selectSuitesForEvent(eventName, changedFiles);

process.stdout.write(JSON.stringify(selectedSuites));
