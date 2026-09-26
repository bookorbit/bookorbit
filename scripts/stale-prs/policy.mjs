export const STATE_MARKER = "<!-- bookorbit-stale-pr-state:v1 ";
export const WARNING_MARKER = "<!-- bookorbit-stale-pr-warning:v1 -->";

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const CLOSE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const BOT_LOGIN = "github-actions[bot]";
const SHA_PATTERN = /^[0-9a-f]{40}$/;

const isHuman = (actor) => actor?.type === "User";
const isAutomation = (actor) => actor?.login === BOT_LOGIN && actor?.type === "Bot";

const timestamp = (value) => {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error("Invalid activity timestamp");
  return time;
};

export const formatState = (state) =>
  `${STATE_MARKER}${JSON.stringify(state)} -->\nAutomation state for PR inactivity. This records when the current head commit was first seen.`;

export const findState = (comments) => {
  const matches = comments.filter((comment) => isAutomation(comment.user) && comment.body?.startsWith(STATE_MARKER));
  if (matches.length > 1) throw new Error("Multiple PR inactivity state comments");
  if (matches.length === 0) return null;

  const raw = matches[0].body.slice(STATE_MARKER.length).split(" -->", 1)[0];
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    throw new Error("Invalid PR inactivity state comment");
  }
  if (
    !state ||
    !SHA_PATTERN.test(state.headSha) ||
    !Number.isFinite(Date.parse(state.baselineAt)) ||
    !Number.isFinite(Date.parse(state.headSeenAt))
  ) {
    throw new Error("Invalid PR inactivity state fields");
  }
  return { commentId: matches[0].id, state };
};

const latestHumanActivity = ({ comments, reviews, reviewComments, events }) => {
  const activity = [];
  for (const comment of comments) {
    if (isHuman(comment.user)) activity.push({ at: comment.updated_at || comment.created_at, source: "comment" });
  }
  for (const review of reviews) {
    if (isHuman(review.user) && review.submitted_at) activity.push({ at: review.submitted_at, source: "review" });
  }
  for (const comment of reviewComments) {
    if (isHuman(comment.user)) activity.push({ at: comment.updated_at || comment.created_at, source: "review-comment" });
  }
  for (const event of events) {
    if (isHuman(event.actor) && ["reopened", "ready_for_review"].includes(event.event)) {
      activity.push({ at: event.created_at, source: event.event });
    }
  }
  return activity;
};

export const evaluatePullRequest = (pull, history, nowIso) => {
  const now = timestamp(nowIso);
  const previous = findState(history.comments);
  const state = previous ? { ...previous.state } : { baselineAt: nowIso, headSha: pull.head.sha, headSeenAt: nowIso };
  let stateChanged = !previous;

  if (state.headSha !== pull.head.sha) {
    state.headSha = pull.head.sha;
    state.headSeenAt = nowIso;
    stateChanged = true;
  }

  const humanActivity = latestHumanActivity(history).sort((a, b) => timestamp(b.at) - timestamp(a.at))[0] ?? null;
  const activity = [
    { at: state.baselineAt, source: "baseline" },
    { at: state.headSeenAt, source: "head" },
    ...(humanActivity ? [humanActivity] : []),
  ].sort((a, b) => timestamp(b.at) - timestamp(a.at))[0];
  const lastActivity = timestamp(activity.at);
  if (lastActivity > now) throw new Error("PR activity is in the future");

  const labels = new Set(pull.labels.map((label) => label.name));
  const isStale = labels.has("stale");
  const isPinned = labels.has("pinned");
  const warnings = history.comments
    .filter((comment) => isAutomation(comment.user) && comment.body?.startsWith(WARNING_MARKER))
    .map((comment) => timestamp(comment.created_at))
    .filter((created) => created > lastActivity);
  const warnedAt = warnings.length ? Math.max(...warnings) : null;

  let action = "none";
  if (isPinned || now - lastActivity < STALE_AFTER_MS) {
    if (isStale) action = "unstale";
  } else if (!isStale) {
    action = "warn";
  } else if (warnedAt === null) {
    action = "complete-warning";
  } else if (now - warnedAt >= CLOSE_AFTER_MS) {
    action = "close";
  }

  return {
    action,
    activity,
    humanActivity,
    commentId: previous?.commentId ?? null,
    state,
    stateChanged,
    warnedAt: warnedAt === null ? null : new Date(warnedAt).toISOString(),
  };
};
