#!/usr/bin/env node

import { evaluatePullRequest, formatState, WARNING_MARKER } from "./policy.mjs";

const [mode, numberArg] = process.argv.slice(2);
if (!["--dry-run", "--apply"].includes(mode) || (numberArg && !/^\d+$/.test(numberArg))) {
  console.error("Usage: node scripts/stale-prs/run.mjs <--dry-run|--apply> [pr-number]");
  process.exit(2);
}

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "") || !token) {
  console.error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
  process.exit(2);
}

const apiRoot = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const repoPath = `/repos/${repository}`;
const dryRun = mode === "--dry-run";
const pageSize = 100;

const request = async (method, path, body) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${apiRoot}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) return response.status === 204 ? null : response.json();
    if (method !== "GET" || ![429, 502, 503, 504].includes(response.status) || attempt === 2) {
      throw new Error(`GitHub API ${method} ${path} returned ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
};

const pages = async (path) => {
  const results = [];
  for (let page = 1; page <= 1000; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await request("GET", `${path}${separator}per_page=${pageSize}&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`GitHub API ${path} did not return a list`);
    results.push(...batch);
    if (batch.length < pageSize) return results;
  }
  throw new Error(`GitHub API ${path} exceeded the pagination limit`);
};

const listOpenPulls = async () => {
  const pulls = await pages(`${repoPath}/pulls?state=open&sort=created&direction=asc`);
  const numbers = pulls.map((pull) => pull.number);
  if (new Set(numbers).size !== numbers.length) throw new Error("Duplicate pull requests in API pagination");
  return numbers;
};

const loadPull = async (number) => request("GET", `${repoPath}/pulls/${number}`);

const loadHistory = async (number) => {
  const issuePath = `${repoPath}/issues/${number}`;
  const pullPath = `${repoPath}/pulls/${number}`;
  const [comments, reviews, reviewComments, events] = await Promise.all([
    pages(`${issuePath}/comments`),
    pages(`${pullPath}/reviews`),
    pages(`${pullPath}/comments`),
    pages(`${issuePath}/events`),
  ]);
  return { comments, reviews, reviewComments, events };
};

const warningBody = `${WARNING_MARKER}\nThis PR has had no qualifying activity for 30 days. It will be closed in 14 days unless someone comments, reviews, or pushes an update. A maintainer can add \`pinned\` to exempt it.`;

const applyPlan = async (number, pull, plan) => {
  const issuePath = `${repoPath}/issues/${number}`;
  if (plan.stateChanged) {
    const path = plan.commentId ? `${repoPath}/issues/comments/${plan.commentId}` : `${issuePath}/comments`;
    await request(plan.commentId ? "PATCH" : "POST", path, { body: formatState(plan.state) });
  }

  if (["warn", "complete-warning", "close"].includes(plan.action)) {
    const freshPull = await loadPull(number);
    if (freshPull.state !== "open" || freshPull.head.sha !== pull.head.sha) return "deferred";
    const freshPlan = evaluatePullRequest(freshPull, await loadHistory(number), new Date().toISOString());
    if (freshPlan.action !== plan.action || freshPlan.activity.at !== plan.activity.at || freshPlan.stateChanged) return "deferred";
  }

  if (plan.action === "unstale") {
    await request("DELETE", `${issuePath}/labels/stale`);
  } else if (plan.action === "warn") {
    await request("POST", `${issuePath}/labels`, { labels: ["stale"] });
    await request("POST", `${issuePath}/comments`, { body: warningBody });
  } else if (plan.action === "complete-warning") {
    await request("POST", `${issuePath}/comments`, { body: warningBody });
  } else if (plan.action === "close") {
    await request("PATCH", `${repoPath}/pulls/${number}`, { state: "closed" });
  }
  return plan.action;
};

const main = async () => {
  const numbers = numberArg ? [Number(numberArg)] : await listOpenPulls();
  const scans = [];
  for (const number of numbers) {
    const pull = await loadPull(number);
    if (pull.state !== "open") throw new Error(`PR #${number} changed state during the scan`);
    const history = await loadHistory(number);
    const plan = evaluatePullRequest(pull, history, new Date().toISOString());
    scans.push({ number, pull: { head: { sha: pull.head.sha } }, plan });
  }
  if (!numberArg) {
    const latestNumbers = await listOpenPulls();
    if (JSON.stringify(numbers) !== JSON.stringify(latestNumbers)) throw new Error("Open PR list changed during the scan");
  }

  for (const { number, pull, plan } of scans) {
    const action = dryRun ? plan.action : await applyPlan(number, pull, plan);
    console.log(
      JSON.stringify({
        number,
        action,
        activityAt: plan.activity.at,
        activitySource: plan.activity.source,
        humanActivityAt: plan.humanActivity?.at ?? null,
        humanActivitySource: plan.humanActivity?.source ?? null,
        warnedAt: plan.warnedAt,
        state: plan.stateChanged ? "initialize-or-update" : "current",
      }),
    );
  }
  console.log(JSON.stringify({ inspected: scans.length, total: numbers.length, mode: dryRun ? "dry-run" : "apply" }));
};

main().catch((error) => {
  console.error(`PR inactivity check failed: ${error.message}`);
  process.exitCode = 1;
});
