"use strict";

const { spawnSync } = require("child_process");

const DOCKER_IMAGE = "ghcr.io/bookorbit/bookorbit";

const TYPES = [
  { type: "feat", section: "Features" },
  { type: "fix", section: "Bug Fixes" },
  { type: "i18n", section: "Internationalization" },
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
  "## Highlights",
  "",
  "<!-- Author: write 1 line per user-facing highlight ABOVE this comment, then delete this block.",
  "     Full guide: docs/whats-new-authoring-guide.md",
  "     Format:  - **Title** - short user benefit  {icon comment}",
  "       - Optional icon: end the line with an HTML comment GitHub hides, using a PascalCase",
  "         lucide.dev name, e.g. BookHeart. Omit it for the default icon. Literal syntax in the guide.",
  "       - Image/video: drag the file in; leave GitHub's inserted <img> tag or bare URL as-is.",
  "     Example:  - **Kobo highlight sync** - your highlights now sync both ways.  {icon: BookHeart}",
  "     Validate before publishing: cd server && pnpm whats-new:check <tag>",
  "     Leaving this comment in place (no bullets) means no What's New popup for this release.",
  "{{{highlightCandidatesBlock}}}-->",
  "",
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
        // Pre-compute commit URL: {{commitUrlFormat}} does not resolve inside
        // Handlebars partials because partials don't walk the parent context chain.
        if (commit.hash && ctx.host && ctx.owner && ctx.repository) {
          commit.commitUrl = `${ctx.host}/${ctx.owner}/${ctx.repository}/commit/${commit.hash}`;
        }
      }
    }

    // Collect this release's feat commits as candidate highlights for the author
    // to curate. Rendered inside the scaffold's HTML comment (never shown publicly)
    // as a pre-built string, so the comment never gains an inner "-->".
    const candidates = [];
    for (const group of ctx.commitGroups ?? []) {
      if (group.title !== "Features") continue;
      for (const commit of group.commits ?? []) {
        const text = (commit.subject || commit.header || "").trim();
        if (!text || text.includes("-->")) continue;
        candidates.push(text.charAt(0).toUpperCase() + text.slice(1));
        if (candidates.length >= 8) break;
      }
    }
    ctx.highlightCandidatesBlock = candidates.length
      ? "\n     Candidates from this release (curate the good ones into real bullets above, then delete):\n" +
        candidates.map((c) => `       - **${c}**`).join("\n") +
        "\n"
      : "";
  } catch {
    // non-fatal: commits render without author attribution / candidates
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
          { type: "i18n", release: "patch" },
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
    // Create the GitHub release as a DRAFT so the maintainer can author the
    // "## Highlights" section (see docs/whats-new-authoring-guide.md) before it
    // goes public, then click "Publish release". The git tag and Docker images
    // are still produced; BookOrbit hides draft releases until they are published.
    ["@semantic-release/github", { draftRelease: true }],
  ],
};
