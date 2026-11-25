import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./classify-translation-pr.sh", import.meta.url));
const l10n = "koreader-plugin/bookorbit.koplugin/l10n";

const makeRepo = (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "translation-pr-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };
  const commit = (message) => {
    git("add", "-A");
    git("commit", "--quiet", "-m", message);
    return git("rev-parse", "HEAD");
  };
  write(`${l10n}/es.po`, 'msgid "Sync now"\nmsgstr ""\n');
  write("koreader-plugin/bookorbit.koplugin/main.lua", "return {}\n");
  const base = commit("base");
  const classify = (head) => execFileSync("bash", [scriptPath, base, head], { cwd: dir, encoding: "utf8" }).trim();
  return { git, write, commit, classify };
};

test("a catalog change is translation-only", (t) => {
  const repo = makeRepo(t);
  repo.write(`${l10n}/es.po`, 'msgid "Sync now"\nmsgstr "Sincronizar"\n');
  assert.equal(repo.classify(repo.commit("es")), "true");
});

test("a new language with its languages.lua row and guide entry is translation-only", (t) => {
  const repo = makeRepo(t);
  repo.write(`${l10n}/pt_BR.po`, 'msgid "Sync now"\nmsgstr "Sincronizar"\n');
  repo.write(`${l10n}/languages.lua`, "return {}\n");
  repo.write("koreader-plugin/l10n/README.md", "# Guide\n");
  assert.equal(repo.classify(repo.commit("pt_BR")), "true");
});

test("a code change is not translation-only", (t) => {
  const repo = makeRepo(t);
  repo.write(`${l10n}/es.po`, 'msgid "Sync now"\nmsgstr "Sincronizar"\n');
  repo.write("koreader-plugin/bookorbit.koplugin/main.lua", "return { changed = true }\n");
  assert.equal(repo.classify(repo.commit("mixed")), "false");
});

test("a file in a subfolder of l10n is not a catalog", (t) => {
  const repo = makeRepo(t);
  repo.write(`${l10n}/extra/es.po`, "x\n");
  assert.equal(repo.classify(repo.commit("nested")), "false");
});

test("an empty change is not translation-only", (t) => {
  const repo = makeRepo(t);
  assert.equal(repo.classify(repo.git("rev-parse", "HEAD")), "false");
});
