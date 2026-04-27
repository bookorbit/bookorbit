"use strict";

const { spawnSync } = require("child_process");

const DOCKER_IMAGE = "ghcr.io/neonsolstice/bookorbit";

// Maps local git author names to GitHub usernames for @-mentions in release notes.
const AUTHOR_MAP = {
  neon: "neonsolstice",
};

const TYPES = [
  { type: "feat", section: "Features" },
  { type: "fix", section: "Bug Fixes" },
  { type: "security", section: "Security" },
  { type: "perf", section: "Performance" },
  { type: "db", section: "Database" },
  { type: "style", section: "Visual Changes" },
];

// Commit partial: standard conventional-changelog layout with an optional
// author @-mention inserted before the hash link.
// Based on conventional-changelog-conventionalcommits@8 commit.hbs.
const commitPartial = `\
*{{#if scope}} **{{scope}}:**
{{~/if}} {{#if subject}}
  {{~subject}}
{{~else}}
  {{~header}}
{{~/if}}
{{~#if githubUser}} by @{{githubUser}}{{/if}}
{{~!-- commit link --}}{{~#if hash}} {{#if @root.linkReferences~}}
  ([{{shortHash}}]({{commitUrlFormat}}))
{{~else}}
  {{~shortHash}}
{{~/if}}{{~/if}}

{{~!-- commit references --}}
{{~#if references~}}
  , closes
  {{~#each references}} {{#if @root.linkReferences~}}
    [
    {{~#if this.owner}}
      {{~this.owner}}/
    {{~/if}}
    {{~this.repository}}{{this.prefix}}{{this.issue}}]({{issueUrlFormat}})
  {{~else}}
    {{~#if this.owner}}
      {{~this.owner}}/
    {{~/if}}
    {{~this.repository}}{{this.prefix}}{{this.issue}}
  {{~/if}}{{/each}}
{{~/if}}`;

// Main template: removes the version header (GitHub Release already shows it),
// strips the warning emoji from breaking-changes headings, and appends a
// Docker pull block after the commit groups.
const mainTemplate = [
  "{{#if noteGroups}}",
  "{{#each noteGroups}}",
  "",
  "### {{title}}",
  "",
  "{{#each notes}}",
  "* {{#if commit.scope}}**{{commit.scope}}:** {{/if}}{{text}}",
  "{{/each}}",
  "{{/each}}",
  "{{/if}}",
  "{{#each commitGroups}}",
  "",
  "{{#if title}}",
  "### {{title}}",
  "",
  "{{/if}}",
  "{{#each commits}}",
  "{{> commit root=@root}}",
  "{{/each}}",
  "",
  "{{/each}}",
  "---",
  "",
  "**Docker**",
  "",
  "```bash",
  `docker pull ${DOCKER_IMAGE}:{{version}}`,
  "```",
  "",
  "Multi-arch: `linux/amd64` and `linux/arm64`.",
].join("\n");

// Runs after the preset transform. Looks up each commit's author via git log,
// maps git name -> GitHub username, and injects githubUser into each commit
// for the commitPartial.
function finalizeContext(ctx) {
  try {
    const result = spawnSync("git", ["log", "--format=%h %aN", "--max-count=500"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });

    const shaToGithubUser = new Map();
    if (result.status === 0) {
      for (const line of result.stdout.split("\n").filter(Boolean)) {
        const spaceIdx = line.indexOf(" ");
        const shortSha = line.substring(0, spaceIdx);
        const authorName = line.substring(spaceIdx + 1).trim();
        if (!authorName || /\[bot\]/i.test(authorName)) continue;
        shaToGithubUser.set(shortSha, AUTHOR_MAP[authorName] ?? authorName);
      }
    }

    for (const group of ctx.commitGroups ?? []) {
      for (const commit of group.commits ?? []) {
        if (commit.shortHash) {
          const githubUser = shaToGithubUser.get(commit.shortHash);
          if (githubUser) commit.githubUser = githubUser;
        }
      }
    }
  } catch {
    // non-fatal: commits render without author attribution
  }
  return ctx;
}

module.exports = {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules: [
          { type: "feat", release: "minor" },
          { type: "fix", release: "patch" },
          { type: "perf", release: "patch" },
          { type: "security", release: "patch" },
          { type: "db", release: "patch" },
          { type: "style", release: "patch" },
          { type: "revert", release: false },
        ],
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        preset: "conventionalcommits",
        presetConfig: { types: TYPES },
        writerOpts: {
          commitPartial,
          mainTemplate,
          finalizeContext,
        },
      },
    ],
    "@semantic-release/github",
  ],
};
