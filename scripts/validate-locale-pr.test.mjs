import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./validate-locale-pr.mjs", import.meta.url));

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_AUTHOR_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
};

const git = (cwd, args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: gitEnv,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const createRepository = () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "bookorbit-locale-policy-"));
  git(cwd, ["init", "--quiet"]);
  mkdirSync(path.join(cwd, "client/src/locales"), { recursive: true });
  writeFileSync(path.join(cwd, "client/src/locales/en.json"), '{"example":"Example"}\n');
  writeFileSync(path.join(cwd, "client/src/locales/de.json"), '{"example":"Beispiel"}\n');
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "--quiet", "-m", "base"]);
  return cwd;
};

const commitChanges = (cwd) => {
  git(cwd, ["add", "--all"]);
  git(cwd, ["commit", "--quiet", "-m", "change"]);
};

const validate = (cwd, isCrowdin = false) => {
  const headSha = git(cwd, ["rev-parse", "HEAD"]);
  const baseSha = git(cwd, ["rev-parse", "HEAD^"]);
  return spawnSync(process.execPath, [scriptPath, baseSha, headSha, String(isCrowdin)], { cwd, encoding: "utf8" });
};

const withRepository = (callback) => {
  const cwd = createRepository();
  try {
    callback(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

test("allows an ordinary pull request to change en.json", () => {
  withRepository((cwd) => {
    writeFileSync(path.join(cwd, "client/src/locales/en.json"), '{"example":"Updated"}\n');
    commitChanges(cwd);

    assert.equal(validate(cwd).status, 0);
  });
});

test("rejects an ordinary pull request that changes a target catalog", () => {
  withRepository((cwd) => {
    writeFileSync(path.join(cwd, "client/src/locales/de.json"), '{"example":"Geandert"}\n');
    commitChanges(cwd);

    const result = validate(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Crowdin-owned target catalog/);
    assert.match(result.stderr, /client\/src\/locales\/en\.json/);
  });
});

test("rejects deletion of an existing target catalog", () => {
  withRepository((cwd) => {
    rmSync(path.join(cwd, "client/src/locales/de.json"));
    commitChanges(cwd);

    assert.equal(validate(cwd).status, 1);
  });
});

test("allows an empty catalog for new-language setup", () => {
  withRepository((cwd) => {
    writeFileSync(path.join(cwd, "client/src/locales/ja.json"), "{}\n");
    commitChanges(cwd);

    assert.equal(validate(cwd).status, 0);
  });
});

test("rejects a translated catalog added outside Crowdin", () => {
  withRepository((cwd) => {
    writeFileSync(path.join(cwd, "client/src/locales/ja.json"), '{"example":"Rei"}\n');
    commitChanges(cwd);

    const result = validate(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /new target catalog but is not empty/);
  });
});

test("allows a classified Crowdin pull request to change target catalogs", () => {
  withRepository((cwd) => {
    writeFileSync(path.join(cwd, "client/src/locales/de.json"), '{"example":"Aktualisiert"}\n');
    commitChanges(cwd);

    assert.equal(validate(cwd, true).status, 0);
  });
});
