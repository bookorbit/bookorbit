import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { checkPluginVersion, isNewer, readVersion } from "./check-plugin-version.mjs";

const pluginDir = "koreader-plugin/bookorbit.koplugin";

const makeRepo = (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "plugin-version-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  mkdirSync(path.join(dir, pluginDir, "l10n"), { recursive: true });
  const write = (file, content) => writeFileSync(path.join(dir, file), content);
  const commit = (message) => {
    git("add", "-A");
    git("commit", "--quiet", "-m", message);
  };
  const version = (value) => write(`${pluginDir}/main.lua`, `local x = 1\nlocal PLUGIN_VERSION = "${value}"\nreturn x\n`);
  return { dir, git, write, commit, version };
};

test("readVersion finds the plugin version", () => {
  assert.equal(readVersion('local PLUGIN_VERSION = "2.4.2"\n'), "2.4.2");
  assert.equal(readVersion("local OTHER = 1\n"), null);
});

test("isNewer compares numerically", () => {
  assert.equal(isNewer("2.4.10", "2.4.9"), true);
  assert.equal(isNewer("2.5.0", "2.4.9"), true);
  assert.equal(isNewer("2.4.2", "2.4.2"), false);
  assert.equal(isNewer("2.4.1", "2.4.2"), false);
});

test("passes when there is no previous tag", (t) => {
  const repo = makeRepo(t);
  repo.version("1.0.0");
  repo.commit("first");
  assert.equal(checkPluginVersion({ cwd: repo.dir }).ok, true);
});

test("passes when the plugin did not change", (t) => {
  const repo = makeRepo(t);
  repo.version("1.0.0");
  repo.commit("first");
  repo.git("tag", "v1.0.0");
  repo.write("README.md", "other change\n");
  repo.commit("docs");
  assert.equal(checkPluginVersion({ cwd: repo.dir }).ok, true);
});

test("fails when a translation changed but the version did not", (t) => {
  const repo = makeRepo(t);
  repo.version("1.0.0");
  repo.commit("first");
  repo.git("tag", "v1.0.0");
  repo.write(`${pluginDir}/l10n/es.po`, 'msgid "Sync now"\nmsgstr "Sincronizar"\n');
  repo.commit("translation");
  const result = checkPluginVersion({ cwd: repo.dir });
  assert.equal(result.ok, false);
  assert.match(result.message, /PLUGIN_VERSION is 1\.0\.0/);
});

test("fails when the version went backwards", (t) => {
  const repo = makeRepo(t);
  repo.version("1.2.0");
  repo.commit("first");
  repo.git("tag", "v1.0.0");
  repo.version("1.1.9");
  repo.commit("downgrade");
  assert.equal(checkPluginVersion({ cwd: repo.dir }).ok, false);
});

test("passes when the plugin changed and the version moved forward", (t) => {
  const repo = makeRepo(t);
  repo.version("1.0.0");
  repo.commit("first");
  repo.git("tag", "v1.0.0");
  repo.write(`${pluginDir}/l10n/es.po`, 'msgid "Sync now"\nmsgstr "Sincronizar"\n');
  repo.version("1.0.1");
  repo.commit("translation and bump");
  const result = checkPluginVersion({ cwd: repo.dir });
  assert.equal(result.ok, true);
  assert.match(result.message, /1\.0\.0 -> 1\.0\.1/);
});
