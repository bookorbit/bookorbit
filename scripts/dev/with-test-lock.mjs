#!/usr/bin/env node

// Serializes test runs across concurrent agents sharing this worktree, and puts a hard
// wall-clock cap on each run. Without it, every runner sizes its worker pool to the whole
// machine independently, and a few simultaneous runs drive the box into swap.

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, "..", "..");
const lockDir = join(rootDir, "node_modules", ".cache", "bookorbit");
const lockPath = join(lockDir, "test-run.lock");

const DEFAULT_RUN_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_WAIT_TIMEOUT_MS = 45 * 60 * 1000;
const POLL_MS = 750;
const SIGKILL_GRACE_MS = 5000;
// The lock file exists but is empty between its exclusive create and the payload write. A
// waiter that reads it in that window must not mistake it for debris and delete it.
const UNREADABLE_GRACE_MS = 3000;

function parseArgs(argv) {
  const options = { runTimeoutMs: DEFAULT_RUN_TIMEOUT_MS, waitTimeoutMs: DEFAULT_WAIT_TIMEOUT_MS };
  const separator = argv.indexOf("--");
  if (separator < 0) {
    console.error("Usage: with-test-lock.mjs [--run-timeout=ms] [--wait-timeout=ms] -- <command> [args...]");
    process.exit(2);
  }
  for (const flag of argv.slice(0, separator)) {
    const runMatch = /^--run-timeout=(\d+)$/.exec(flag);
    if (runMatch) options.runTimeoutMs = Number(runMatch[1]);
    const waitMatch = /^--wait-timeout=(\d+)$/.exec(flag);
    if (waitMatch) options.waitTimeoutMs = Number(waitMatch[1]);
  }
  return { options, command: argv.slice(separator + 1) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readHolder() {
  try {
    const holder = JSON.parse(readFileSync(lockPath, "utf8"));
    return typeof holder?.pid === "number" ? holder : null;
  } catch {
    return null;
  }
}

function lockAgeMs() {
  try {
    return Date.now() - statSync(lockPath).mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function holderIsAlive(holder) {
  if (!holder || typeof holder.pid !== "number") return false;
  try {
    process.kill(holder.pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return err.code === "EPERM";
  }
}

function tryAcquire(command) {
  mkdirSync(lockDir, { recursive: true });
  let fd;
  try {
    fd = openSync(lockPath, "wx");
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    return false;
  }
  writeSync(fd, JSON.stringify({ pid: process.pid, command: command.join(" "), startedAt: new Date().toISOString() }));
  closeSync(fd);
  return true;
}

function release() {
  const holder = readHolder();
  if (holder && holder.pid !== process.pid) return;
  try {
    unlinkSync(lockPath);
  } catch {
    // Already gone.
  }
}

async function acquire(command, waitTimeoutMs) {
  const deadline = Date.now() + waitTimeoutMs;
  let announced = false;
  while (Date.now() < deadline) {
    if (tryAcquire(command)) return true;

    const holder = readHolder();
    if (!holder) {
      // Unreadable: either mid-write by the winner, or a truncated leftover. Only the second
      // case is safe to clear, and age is what separates them.
      if (lockAgeMs() < UNREADABLE_GRACE_MS) {
        await sleep(POLL_MS);
        continue;
      }
      console.warn("[test-lock] clearing unreadable lock file");
      try {
        unlinkSync(lockPath);
      } catch {
        // Another waiter cleared it first.
      }
      continue;
    }

    if (!holderIsAlive(holder)) {
      console.warn(`[test-lock] clearing stale lock from dead pid ${holder.pid}`);
      try {
        unlinkSync(lockPath);
      } catch {
        // Another waiter cleared it first.
      }
      continue;
    }

    if (!announced) {
      console.log(`[test-lock] waiting for pid ${holder.pid} running "${holder.command}" (since ${holder.startedAt})`);
      announced = true;
    }
    await sleep(POLL_MS);
  }
  return false;
}

function runChild(command, runTimeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: process.cwd(),
      stdio: "inherit",
      detached: true,
      env: {
        ...process.env,
        // The lock holder owns the machine, so it may use the wider pool. Unlocked runs fall
        // back to the conservative default baked into the vitest configs.
        BO_TEST_MAX_WORKERS: process.env.BO_TEST_MAX_WORKERS ?? String(Math.max(2, availableParallelism() - 2)),
      },
    });

    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };

    const killTree = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // Group already gone.
      }
    };

    const timer = setTimeout(() => {
      console.error(`\n[test-lock] run exceeded ${Math.round(runTimeoutMs / 1000)}s, terminating "${command.join(" ")}"`);
      killTree("SIGTERM");
      setTimeout(() => killTree("SIGKILL"), SIGKILL_GRACE_MS);
      finish(124);
    }, runTimeoutMs);

    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => {
        killTree(signal);
        finish(130);
      });
    }

    child.once("error", (err) => {
      console.error(`[test-lock] failed to start: ${err.message}`);
      finish(127);
    });
    child.once("exit", (code, signal) => finish(signal ? 128 : (code ?? 1)));
  });
}

const { options, command } = parseArgs(process.argv.slice(2));
process.once("exit", release);

if (!(await acquire(command, options.waitTimeoutMs))) {
  console.error(`[test-lock] gave up waiting after ${Math.round(options.waitTimeoutMs / 1000)}s`);
  process.exit(75);
}

const exitCode = await runChild(command, options.runTimeoutMs);
release();
process.exit(exitCode);
