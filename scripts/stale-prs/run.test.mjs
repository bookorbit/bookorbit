import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatState, WARNING_MARKER } from "./policy.mjs";

const script = fileURLToPath(new URL("./run.mjs", import.meta.url));
const bot = { login: "github-actions[bot]", type: "Bot" };
const sha = "a".repeat(40);

const startServer = async (handler) => {
  const server = createServer(async (request, response) => {
    try {
      const body = await new Promise((resolve) => {
        let value = "";
        request.on("data", (chunk) => (value += chunk));
        request.on("end", () => resolve(value ? JSON.parse(value) : null));
      });
      const result = handler(request, body);
      response.writeHead(result.status || 200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result.body ?? null));
    } catch {
      response.writeHead(500);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
};

const run = (server, mode) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [script, mode], {
      env: {
        ...process.env,
        GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
        GITHUB_REPOSITORY: "example/repo",
        GITHUB_TOKEN: "test-token",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });

test("dry-run inspects every page and performs no writes", async (t) => {
  let writes = 0;
  const server = await startServer((request) => {
    if (request.method !== "GET") writes++;
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/repos/example/repo/pulls") {
      const page = Number(url.searchParams.get("page"));
      const numbers = page === 1 ? Array.from({ length: 100 }, (_, index) => index + 1) : [101];
      return { body: numbers.map((number) => ({ number })) };
    }
    const match = url.pathname.match(/^\/repos\/example\/repo\/pulls\/(\d+)$/);
    if (match) return { body: { number: Number(match[1]), state: "open", head: { sha }, labels: [] } };
    return { body: [] };
  });
  t.after(() => server.close());

  const result = await run(server, "--dry-run");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(writes, 0);
  assert.match(result.stdout, /"inspected":101,"total":101,"mode":"dry-run"/);
});

test("apply rechecks activity before closing a warned PR", async (t) => {
  const now = Date.now();
  const daysAgo = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const comments = [
    {
      id: 1,
      user: bot,
      body: formatState({ baselineAt: daysAgo(60), headSeenAt: daysAgo(60), headSha: sha }),
      created_at: daysAgo(60),
    },
    { id: 2, user: bot, body: WARNING_MARKER, created_at: daysAgo(15) },
  ];
  const writes = [];
  const server = await startServer((request, body) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method !== "GET") writes.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === "/repos/example/repo/pulls") return { body: [{ number: 7 }] };
    if (url.pathname === "/repos/example/repo/pulls/7") {
      if (request.method === "PATCH") return { body: { state: "closed" } };
      return { body: { number: 7, state: "open", head: { sha }, labels: [{ name: "stale" }] } };
    }
    if (url.pathname === "/repos/example/repo/issues/7/comments") return { body: comments };
    return { body: [] };
  });
  t.after(() => server.close());

  const result = await run(server, "--apply");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(writes, [{ method: "PATCH", path: "/repos/example/repo/pulls/7", body: { state: "closed" } }]);
});

test("apply defers closure when a human comments during the final recheck", async (t) => {
  const now = Date.now();
  const daysAgo = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  let commentReads = 0;
  let closed = false;
  const server = await startServer((request) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/repos/example/repo/pulls") return { body: [{ number: 7 }] };
    if (url.pathname === "/repos/example/repo/pulls/7") {
      if (request.method === "PATCH") closed = true;
      return { body: { number: 7, state: "open", head: { sha }, labels: [{ name: "stale" }] } };
    }
    if (url.pathname === "/repos/example/repo/issues/7/comments") {
      commentReads++;
      return {
        body: [
          { id: 1, user: bot, body: formatState({ baselineAt: daysAgo(60), headSeenAt: daysAgo(60), headSha: sha }), created_at: daysAgo(60) },
          { id: 2, user: bot, body: WARNING_MARKER, created_at: daysAgo(15) },
          ...(commentReads > 1
            ? [{ id: 3, user: { login: "contributor", type: "User" }, created_at: daysAgo(0.01), updated_at: daysAgo(0.01) }]
            : []),
        ],
      };
    }
    return { body: [] };
  });
  t.after(() => server.close());

  const result = await run(server, "--apply");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(commentReads, 2);
  assert.equal(closed, false);
  assert.match(result.stdout, /"action":"deferred"/);
});

test("apply labels and warns an inactive PR", async (t) => {
  const baselineAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const writes = [];
  const server = await startServer((request, body) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method !== "GET") writes.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === "/repos/example/repo/pulls") return { body: [{ number: 7 }] };
    if (url.pathname === "/repos/example/repo/pulls/7") return { body: { number: 7, state: "open", head: { sha }, labels: [] } };
    if (url.pathname === "/repos/example/repo/issues/7/comments") {
      return { body: [{ id: 1, user: bot, body: formatState({ baselineAt, headSeenAt: baselineAt, headSha: sha }), created_at: baselineAt }] };
    }
    return { body: [] };
  });
  t.after(() => server.close());

  const result = await run(server, "--apply");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], { method: "POST", path: "/repos/example/repo/issues/7/labels", body: { labels: ["stale"] } });
  assert.equal(writes[1].method, "POST");
  assert.equal(writes[1].path, "/repos/example/repo/issues/7/comments");
  assert.match(writes[1].body.body, /bookorbit-stale-pr-warning:v1/);
});

test("apply updates the recorded head and removes stale after a push", async (t) => {
  const baselineAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const writes = [];
  const server = await startServer((request, body) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method !== "GET") writes.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === "/repos/example/repo/pulls") return { body: [{ number: 7 }] };
    if (url.pathname === "/repos/example/repo/pulls/7") {
      return { body: { number: 7, state: "open", head: { sha: "b".repeat(40) }, labels: [{ name: "stale" }] } };
    }
    if (url.pathname === "/repos/example/repo/issues/7/comments") {
      return { body: [{ id: 31, user: bot, body: formatState({ baselineAt, headSeenAt: baselineAt, headSha: sha }), created_at: baselineAt }] };
    }
    return { body: [] };
  });
  t.after(() => server.close());

  const result = await run(server, "--apply");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].method, "PATCH");
  assert.equal(writes[0].path, "/repos/example/repo/issues/comments/31");
  assert.match(writes[0].body.body, /b{40}/);
  assert.deepEqual(writes[1], { method: "DELETE", path: "/repos/example/repo/issues/7/labels/stale", body: null });
});
