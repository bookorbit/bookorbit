import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePullRequest, formatState, STATE_MARKER, WARNING_MARKER } from "./policy.mjs";

const human = { login: "contributor", type: "User" };
const bot = { login: "github-actions[bot]", type: "Bot" };
const headSha = "a".repeat(40);
const day = 24 * 60 * 60 * 1000;
const at = (days) => new Date(Date.parse("2026-01-01T00:00:00Z") + days * day).toISOString();

const pull = ({ labels = [], sha = headSha, updatedAt = at(90) } = {}) => ({
  head: { sha },
  labels: labels.map((name) => ({ name })),
  updated_at: updatedAt,
});

const stateComment = ({ baselineAt = at(0), headSeenAt = at(0), sha = headSha } = {}) => ({
  id: 10,
  user: bot,
  body: formatState({ baselineAt, headSeenAt, headSha: sha }),
  created_at: at(0),
});

const warning = (createdAt) => ({
  id: 11,
  user: bot,
  body: `${WARNING_MARKER}\nWarning`,
  created_at: createdAt,
});

const history = ({ comments = [stateComment()], reviews = [], reviewComments = [], events = [] } = {}) => ({
  comments,
  reviews,
  reviewComments,
  events,
});

test("starts existing PRs with a safe baseline instead of GitHub's updated_at", () => {
  const result = evaluatePullRequest(
    pull({ updatedAt: at(60) }),
    history({ comments: [{ user: human, created_at: at(20), updated_at: at(20) }] }),
    at(90),
  );
  assert.equal(result.action, "none");
  assert.equal(result.activity.source, "baseline");
  assert.equal(result.activity.at, at(90));
  assert.deepEqual(result.humanActivity, { at: at(20), source: "comment" });
  assert.equal(result.stateChanged, true);
});

test("warns at 30 full days, then closes 14 full days after the warning", () => {
  assert.equal(evaluatePullRequest(pull(), history(), at(29.99)).action, "none");
  assert.equal(evaluatePullRequest(pull(), history(), at(30)).action, "warn");
  const warned = history({ comments: [stateComment(), warning(at(30))] });
  assert.equal(evaluatePullRequest(pull({ labels: ["stale"] }), warned, at(43.99)).action, "none");
  assert.equal(evaluatePullRequest(pull({ labels: ["stale"] }), warned, at(44)).action, "close");
});

test("ignores bot comments and a mass PR update timestamp", () => {
  const result = evaluatePullRequest(
    pull({ labels: ["stale"], updatedAt: at(43) }),
    history({ comments: [stateComment(), warning(at(30)), { user: bot, body: "CI update", created_at: at(43) }] }),
    at(44),
  );
  assert.equal(result.action, "close");
  assert.equal(result.activity.source, "baseline");
  assert.equal(result.humanActivity, null);
});

test("human comments and reviews clear a stale warning", () => {
  const comments = [stateComment(), warning(at(30)), { user: human, created_at: at(40), updated_at: at(40) }];
  assert.equal(evaluatePullRequest(pull({ labels: ["stale"] }), history({ comments }), at(44)).action, "unstale");

  const reviews = [{ user: human, submitted_at: at(40) }];
  assert.equal(
    evaluatePullRequest(pull({ labels: ["stale"] }), history({ comments: [stateComment(), warning(at(30))], reviews }), at(44)).action,
    "unstale",
  );

  const reviewComments = [{ user: human, created_at: at(40), updated_at: at(40) }];
  assert.equal(
    evaluatePullRequest(pull({ labels: ["stale"] }), history({ comments: [stateComment(), warning(at(30))], reviewComments }), at(44)).action,
    "unstale",
  );
});

test("a new head commit resets the clock even if its commit date is old", () => {
  const result = evaluatePullRequest(
    pull({ labels: ["stale"], sha: "b".repeat(40) }),
    history({ comments: [stateComment(), warning(at(30))] }),
    at(44),
  );
  assert.equal(result.action, "unstale");
  assert.equal(result.activity.source, "head");
  assert.equal(result.state.headSeenAt, at(44));
  assert.equal(result.stateChanged, true);
});

test("reopening, ready for review, and pinned labels prevent closure", () => {
  for (const event of ["reopened", "ready_for_review"]) {
    const events = [{ event, actor: human, created_at: at(40) }];
    assert.equal(
      evaluatePullRequest(pull({ labels: ["stale"] }), history({ comments: [stateComment(), warning(at(30))], events }), at(44)).action,
      "unstale",
    );
  }
  assert.equal(
    evaluatePullRequest(pull({ labels: ["stale", "pinned"] }), history({ comments: [stateComment(), warning(at(30))] }), at(44)).action,
    "unstale",
  );
});

test("a partial warning or removed stale label starts a fresh warning period", () => {
  assert.equal(evaluatePullRequest(pull({ labels: ["stale"] }), history(), at(44)).action, "complete-warning");
  assert.equal(evaluatePullRequest(pull(), history({ comments: [stateComment(), warning(at(30))] }), at(44)).action, "warn");
});

test("rejects ambiguous or malformed automation state", () => {
  assert.throws(() => evaluatePullRequest(pull(), history({ comments: [stateComment(), stateComment()] }), at(44)), /Multiple/);
  assert.throws(() => evaluatePullRequest(pull(), history({ comments: [{ ...stateComment(), body: `${STATE_MARKER}bad -->` }] }), at(44)), /Invalid/);
});
