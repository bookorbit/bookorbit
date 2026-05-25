"use strict";

const { spawnSync } = require("child_process");

const DOCKER_IMAGE = "ghcr.io/bookorbit/bookorbit";

const TYPES = [
  { type: "feat", section: "Features" },
  { type: "fix", section: "Bug Fixes" },
  { type: "security", section: "Security" },
  { type: "perf", section: "Performance" },
  { type: "db", section: "Database" },
  { type: "style", section: "Visual Changes" },
];

// Uses {{commitUrl}} (pre-computed per-commit in finalizeContext) instead of
// {{commitUrlFormat}} which does not resolve inside Handlebars partials.
const commitPartial = `\
*{{#if scope}} **{{scope}}:**
{{~/if}} {{#if subject}}
  {{~subject}}
{{~else}}
  {{~header}}
{{~/if}}
{{~!-- commit link --}}{{~#if hash}} {{#if commitUrl~}}
  ([{{shortHash}}]({{commitUrl}}))
{{~else}}
  {{~shortHash}}
{{~/if}}{{~/if}}
{{~#if githubUser}} by @{{githubUser}}{{/if}}

{{~!-- commit references --}}
{{~#if references~}}
  , closes
  {{~#each references}} {{#if @root.linkReferences~}}
    [
    {{~#if this.owner}}
      {{~this.owner}}/
    {{~/if}}
    {{~this.repository}}{{this.prefix}}{{this.issue}}]({{@root.host}}/{{@root.owner}}/{{@root.repository}}/issues/{{this.issue}})
  {{~else}}
    {{~#if this.owner}}
      {{~this.owner}}/
    {{~/if}}
    {{~this.repository}}{{this.prefix}}{{this.issue}}
  {{~/if}}{{/each}}
{{~/if}}
`;

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
  "",
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
    const shaToGithubUser = new Map();

    try {
      const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      if (ghToken && ctx.owner && ctx.repository) {
        const curlResult = spawnSync(
          "curl",
          [
            "-s",
            "-H", `Authorization: Bearer ${ghToken}`,
            "-H", "X-GitHub-Api-Version: 2022-11-28",
            `https://api.github.com/repos/${ctx.owner}/${ctx.repository}/commits?per_page=100`
          ],
          { encoding: "utf8" }
        );
        if (curlResult.status === 0) {
          const apiCommits = JSON.parse(curlResult.stdout);
          if (Array.isArray(apiCommits)) {
            for (const c of apiCommits) {
              if (c.sha && c.author && c.author.login) {
                shaToGithubUser.set(c.sha, c.author.login);
              }
            }
          }
        }
      }
    } catch (e) {
      // Ignore API errors, fall back to local git log
    }

    const result = spawnSync("git", ["log", "--format=%H %aN", "--max-count=500"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });

    if (result.status === 0) {
      for (const line of result.stdout.split("\n").filter(Boolean)) {
        const spaceIdx = line.indexOf(" ");
        const hash = line.substring(0, spaceIdx);
        const authorName = line.substring(spaceIdx + 1).trim();
        if (!authorName || /\[bot\]/i.test(authorName)) continue;
        if (!shaToGithubUser.has(hash)) {
          shaToGithubUser.set(hash, authorName);
        }
      }
    }

    for (const group of ctx.commitGroups ?? []) {
      for (const commit of group.commits ?? []) {
        if (commit.hash) {
          const githubUser = shaToGithubUser.get(commit.hash);
          if (githubUser) commit.githubUser = githubUser;
        }
        // Pre-compute commit URL — {{commitUrlFormat}} does not resolve inside
        // Handlebars partials because partials don't walk the parent context chain.
        if (commit.hash && ctx.host && ctx.owner && ctx.repository) {
          commit.commitUrl = `${ctx.host}/${ctx.owner}/${ctx.repository}/commit/${commit.hash}`;
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
  repositoryUrl: "https://github.com/bookorbit/bookorbit",
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
        linkReferences: true,
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
