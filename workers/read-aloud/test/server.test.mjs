import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, describe, test } from "node:test";
import { ReadableRoots } from "../dist/paths.js";
import { TERMINAL, TOKEN, jobRequest, makeSandbox, resetStageLog, stagesRun, startTestWorker, waitForJob } from "./helpers.mjs";

describe("HTTP surface", () => {
  let sandbox;
  let client;

  before(async () => {
    sandbox = makeSandbox();
    // A folder beside the library, reachable from inside it only through `..` or a symlink.
    const outside = join(sandbox.root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.epub"), "secret-epub");
    writeFileSync(join(outside, "secret.mp3"), "secret-audio");
    symlinkSync(join(outside, "secret.epub"), join(sandbox.book, "linked.epub"));
    symlinkSync(outside, join(sandbox.library, "escape"));
    client = await startTestWorker(sandbox);
  });

  after(async () => {
    await client.close();
    sandbox.cleanup();
  });

  test("rejects missing, wrong and differently sized tokens", async () => {
    assert.equal((await client.call("GET", "/health", undefined, null)).status, 401);
    assert.equal((await client.call("GET", "/health", undefined, "x".repeat(TOKEN.length))).status, 401);
    const wrongLength = await client.call("GET", "/health", undefined, "short");
    assert.equal(wrongLength.status, 401);
    assert.equal(wrongLength.body.errorCode, "worker_unavailable");
  });

  test("health reports the protocol, roots, device and free space", async () => {
    const { status, body } = await client.call("GET", "/health");
    assert.equal(status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.protocol, 1);
    assert.equal(body.activeJobId, null);
    assert.equal(body.activeJobs, 0);
    assert.equal(body.capacity, 1);
    assert.equal(body.device, "cpu");
    assert.equal(body.configuredDevice, "cpu");
    assert.equal(body.deviceCheck, "not_checked");
    assert.deepEqual(body.libraryRoots, [sandbox.library]);
    assert.equal(body.workRoot, sandbox.workRoot);
    assert.equal(typeof body.freeBytes, "number");
    assert.equal(body.platform, process.platform);
    assert.equal(body.architecture, process.arch);
  });

  test("unknown jobs and routes are 404", async () => {
    const job = await client.call("GET", "/v1/jobs/00000000-0000-4000-8000-000000000000");
    assert.equal(job.status, 404);
    assert.equal(job.body.errorCode, "worker_unavailable");
    assert.equal((await client.call("DELETE", "/v1/jobs/00000000-0000-4000-8000-000000000000")).status, 404);
    const route = await client.call("GET", "/v2/nothing");
    assert.equal(route.status, 404);
    assert.equal(route.body.errorCode, "worker_incompatible");
  });

  test("a job id with broken percent-encoding is a 404, not a 500", async () => {
    for (const method of ["GET", "DELETE"]) {
      for (const id of ["%E0%A4%A", "%ZZ", "00000000-0000-4000-8000-%"]) {
        const response = await client.call(method, `/v1/jobs/${id}`);
        assert.equal(response.status, 404, `${method} ${id}`);
        assert.equal(response.body.errorCode, "worker_unavailable");
      }
    }
    const traversal = await client.call("GET", "/v1/jobs/..%2F..%2Fhealth");
    assert.equal(traversal.status, 404);
    assert.equal(traversal.body.errorCode, "worker_unavailable");
  });

  const rejected = [
    ["malformed JSON", () => "{", "worker_incompatible"],
    ["a missing field", () => ({ ...jobRequest(sandbox), granularity: "paragraph" }), "worker_incompatible"],
    ["a work folder elsewhere", () => ({ ...jobRequest(sandbox), workDir: join(sandbox.root, "elsewhere") }), "worker_incompatible"],
    ["a source outside every root", () => ({ ...jobRequest(sandbox), epubPath: "/somewhere/else/book.epub" }), "library_not_mounted"],
    ["a missing source", () => ({ ...jobRequest(sandbox), audioPaths: [join(sandbox.book, "03.mp3")] }), "source_missing"],
    ["a folder as source", () => ({ ...jobRequest(sandbox), epubPath: sandbox.book }), "invalid_source"],
    ["a relative source", () => ({ ...jobRequest(sandbox), epubPath: "book.epub" }), "invalid_source"],
    ["a language QuartzNet lacks", () => ({ ...jobRequest(sandbox), language: "nl" }), "unsupported_language"],
    ["an invalid language tag", () => ({ ...jobRequest(sandbox), language: "not a tag" }), "unsupported_language"],
    ["a bad decision", () => ({ ...jobRequest(sandbox), decisions: { chapters: { "a.xhtml": "maybe" }, audio: [] } }), "worker_incompatible"],
    // Paths are joined by hand below: path.join would resolve the `..` before the worker sees it.
    [
      "an EPUB reached through `..`",
      () => ({ ...jobRequest(sandbox), epubPath: `${sandbox.library}/../outside/secret.epub` }),
      "library_not_mounted",
    ],
    [
      "an audio file reached through `..`",
      () => ({ ...jobRequest(sandbox), audioPaths: [`${sandbox.book}/../../../outside/secret.mp3`] }),
      "library_not_mounted",
    ],
    [
      "a work folder reached through `..`",
      () => {
        const request = jobRequest(sandbox);
        return { ...request, workDir: `${request.workDir}/../../escaped` };
      },
      "worker_incompatible",
    ],
    [
      "a symlinked file that points outside every root",
      () => ({ ...jobRequest(sandbox), epubPath: join(sandbox.book, "linked.epub") }),
      "library_not_mounted",
    ],
    [
      "a file under a symlinked folder that points outside every root",
      () => ({ ...jobRequest(sandbox), audioPaths: [join(sandbox.library, "escape", "secret.mp3")] }),
      "library_not_mounted",
    ],
  ];
  for (const [name, body, code] of rejected) {
    test(`400 for ${name}`, async () => {
      const response = await client.call("POST", "/v1/jobs", body());
      assert.equal(response.status, 400);
      assert.equal(response.body.errorCode, code);
      assert.equal(typeof response.body.error, "string");
      assert.equal((await client.call("GET", "/health")).body.activeJobId, null);
    });
  }
});

describe("paths inside a root", () => {
  test("are accepted after `..` and symlinks resolve back into the library", async () => {
    const sandbox = makeSandbox();
    symlinkSync(join(sandbox.book, "book.epub"), join(sandbox.library, "shortcut.epub"));
    const client = await startTestWorker(sandbox);
    try {
      const request = jobRequest(sandbox, {
        epubPath: join(sandbox.library, "shortcut.epub"),
        audioPaths: [`${sandbox.book}/../Book/01.mp3`, join(sandbox.book, "02.mp3")],
      });
      const created = await client.call("POST", "/v1/jobs", request);
      assert.equal(created.status, 202, JSON.stringify(created.body));
      const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
      assert.equal(job.status, "completed", JSON.stringify(job));
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });
});

describe("library roots", () => {
  test("a root that is not readable at startup is picked up later without a restart", async () => {
    const sandbox = makeSandbox();
    const later = join(sandbox.root, "automount");
    const client = await startTestWorker(sandbox, { libraryRoots: [sandbox.library, later], rootChecks: { maxAgeMs: 0 } });
    try {
      assert.deepEqual((await client.call("GET", "/health")).body.libraryRoots, [sandbox.library]);
      mkdirSync(later);
      assert.deepEqual((await client.call("GET", "/health")).body.libraryRoots, [sandbox.library, later]);
      rmSync(later, { recursive: true });
      assert.deepEqual((await client.call("GET", "/health")).body.libraryRoots, [sandbox.library]);
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });

  test("a job checks the roots again even while health reuses its last answer", async () => {
    const sandbox = makeSandbox();
    const later = join(sandbox.root, "automount");
    const client = await startTestWorker(sandbox, { libraryRoots: [sandbox.library, later] });
    try {
      assert.deepEqual((await client.call("GET", "/health")).body.libraryRoots, [sandbox.library]);
      mkdirSync(later);
      writeFileSync(join(later, "book.epub"), "epub-bytes");
      writeFileSync(join(later, "01.mp3"), "a".repeat(1000));
      assert.deepEqual((await client.call("GET", "/health")).body.libraryRoots, [sandbox.library], "health reuses a recent check");

      const request = jobRequest(sandbox, { epubPath: join(later, "book.epub"), audioPaths: [join(later, "01.mp3")] });
      const created = await client.call("POST", "/v1/jobs", request);
      assert.equal(created.status, 202, JSON.stringify(created.body));
      assert.deepEqual((await client.call("GET", "/health")).body.libraryRoots, [sandbox.library, later]);
      const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
      assert.equal(job.status, "completed", JSON.stringify(job));
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });

  test("a hung root is left out within the timeout and is not checked again until it answers", async () => {
    const calls = new Map();
    let answer;
    const hung = new Promise((resolve) => (answer = resolve));
    const roots = new ReadableRoots(["/books", "/hung"], {
      maxAgeMs: 0,
      timeoutMs: 50,
      check: async (path) => {
        calls.set(path, (calls.get(path) ?? 0) + 1);
        if (path === "/hung" && calls.get(path) === 1) await hung;
      },
    });
    const startedAt = Date.now();
    assert.deepEqual(await roots.get(), ["/books"]);
    assert.ok(Date.now() - startedAt < 1_000, "the check is bounded by its timeout");
    assert.deepEqual(await roots.get(), ["/books"]);
    assert.equal(calls.get("/hung"), 1, "a check still waiting on the mount is reused, not repeated");
    assert.equal(calls.get("/books"), 2);

    answer();
    await sleep(0);
    assert.deepEqual(await roots.get(), ["/books", "/hung"]);
  });
});

describe("job lifecycle", () => {
  let sandbox;
  let client;

  before(async () => {
    sandbox = makeSandbox();
    client = await startTestWorker(sandbox, { mode: "slow" });
  });

  after(async () => {
    await client.close();
    sandbox.cleanup();
  });

  test("runs a job with progress, events and the scratch environment", async () => {
    const request = jobRequest(sandbox);
    const created = await client.call("POST", "/v1/jobs", request);
    assert.equal(created.status, 202);
    assert.equal(created.body.jobId, request.jobId);

    const again = await client.call("POST", "/v1/jobs", request);
    assert.equal(again.status, 200, "a running job is returned, not restarted");

    const other = await client.call("POST", "/v1/jobs", jobRequest(sandbox));
    assert.equal(other.status, 503);
    assert.equal(other.body.errorCode, "worker_unavailable");

    const health = await client.call("GET", "/health");
    assert.equal(health.body.activeJobId, request.jobId);

    const progress = [];
    const job = await waitForJob(client, request.jobId, (body) => {
      progress.push(body.progress);
      return TERMINAL.has(body.status);
    });
    assert.equal(job.status, "completed", JSON.stringify(job));
    assert.equal(job.progress, 100);
    assert.equal(job.errorCode, null);
    assert.equal(job.outputBytes, "output-epub-bytes".length);
    assert.deepEqual(
      progress,
      [...progress].sort((a, b) => a - b),
      "progress never goes backwards",
    );

    const seqs = job.events.map((event) => event.seq);
    assert.deepEqual(
      seqs,
      seqs.map((_, index) => index + 1),
    );
    const codes = job.events.map((event) => `${event.stage ?? "-"}:${event.code}`);
    for (const expected of [
      "-:job_accepted",
      "-:disk_checked",
      "preparing_audio:stage_started",
      "preparing_audio:stage_finished",
      "generating_emissions:stage_finished",
      "marking_up_ebook:stage_finished",
      "aligning:stage_finished",
      "validating:stage_finished",
      "-:job_completed",
    ]) {
      assert.ok(codes.includes(expected), `missing ${expected} in ${codes.join(", ")}`);
    }
    const finished = job.events.find((event) => event.code === "stage_finished" && event.stage === "generating_emissions");
    assert.equal(typeof finished.data.durationMs, "number");

    const tail = await client.call("GET", `/v1/jobs/${request.jobId}?afterSeq=${seqs.at(-2)}`);
    assert.deepEqual(
      tail.body.events.map((event) => event.seq),
      [seqs.at(-1)],
    );

    const runs = stagesRun(sandbox, request.jobId);
    assert.deepEqual(
      runs.map((entry) => entry.stage),
      ["preparing_audio", "generating_emissions", "marking_up_ebook", "aligning"],
    );
    assert.equal(runs[0].tmpdir, join(sandbox.tmpDir, "read-aloud-worker"));
    assert.equal(runs[0].scratch, join(request.workDir, "scratch"));
    for (const stage of ["preparing_audio", "generating_emissions", "marking_up_ebook", "aligning"]) {
      assert.ok(existsSync(join(request.workDir, `.done-${stage}`)), `marker for ${stage}`);
    }
    assert.ok(existsSync(join(request.workDir, "source-audio", "0001.mp3")));
    assert.equal((await client.call("GET", "/health")).body.activeJobId, null);
  });
});

describe("resume from the work folder", () => {
  let sandbox;
  let client;
  let request;

  before(async () => {
    sandbox = makeSandbox();
    client = await startTestWorker(sandbox, { modelDir: undefined });
    request = jobRequest(sandbox);
    assert.equal((await client.call("POST", "/v1/jobs", request)).status, 202);
    const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
    assert.equal(job.status, "completed");
  });

  after(async () => {
    await client.close();
    sandbox.cleanup();
  });

  async function rerun(overrides) {
    resetStageLog(sandbox);
    const response = await client.call("POST", "/v1/jobs", { ...request, ...overrides });
    assert.equal(response.status, 202, "a terminal job starts a fresh run");
    const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
    assert.equal(job.status, "completed", JSON.stringify(job));
    return { job, stages: stagesRun(sandbox, request.jobId).map((entry) => entry.stage) };
  }

  test("a repeat run skips every cached stage and keeps the event sequence", async () => {
    const before = (await client.call("GET", `/v1/jobs/${request.jobId}`)).body.events.at(-1).seq;
    const { job, stages } = await rerun({});
    assert.deepEqual(stages, []);
    const fresh = job.events.filter((event) => event.seq > before);
    assert.equal(fresh[0].seq, before + 1);
    assert.equal(fresh[0].code, "job_accepted");
    assert.equal(fresh[0].data.attempt, 2);
    assert.deepEqual(
      fresh.filter((event) => event.code === "stage_skipped").map((event) => event.stage),
      ["preparing_audio", "generating_emissions", "marking_up_ebook", "aligning"],
    );
    assert.ok(fresh.some((event) => event.code === "stage_finished" && event.stage === "validating"));
  });

  test("changed decisions rerun only alignment", async () => {
    const { stages, job } = await rerun({ decisions: { chapters: { "chapter-1.xhtml": "excluded" }, audio: [] } });
    assert.deepEqual(stages, ["aligning"]);
    assert.equal(job.progress, 100);
  });

  test("resumeFrom forces that stage and every later one", async () => {
    const { stages } = await rerun({ decisions: { chapters: { "chapter-1.xhtml": "excluded" }, audio: [] }, resumeFrom: "marking_up_ebook" });
    assert.deepEqual(stages, ["marking_up_ebook", "aligning"]);
  });

  test("a changed source reruns the audio stages and alignment, not markup", async () => {
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(sandbox.book, "02.mp3"), later, later);
    const { stages } = await rerun({ decisions: { chapters: { "chapter-1.xhtml": "excluded" }, audio: [] } });
    assert.deepEqual(stages, ["preparing_audio", "generating_emissions", "aligning"]);
  });
});

describe("control plane", () => {
  test("health keeps answering while the runner is blocked in a synchronous loop", async () => {
    const sandbox = makeSandbox();
    const client = await startTestWorker(sandbox, { mode: "block-align" });
    try {
      const request = jobRequest(sandbox);
      await client.call("POST", "/v1/jobs", request);
      await waitForJob(client, request.jobId, (body) => body.stage === "aligning");
      let slowest = 0;
      let answered = 0;
      const until = Date.now() + 1_500;
      while (Date.now() < until) {
        const sentAt = Date.now();
        const health = await client.call("GET", "/health");
        assert.equal(health.status, 200);
        slowest = Math.max(slowest, Date.now() - sentAt);
        answered += 1;
      }
      assert.ok(answered > 10, `answered ${answered}`);
      assert.ok(slowest < 500, `slowest health answer ${slowest} ms`);
      const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
      assert.equal(job.status, "completed");
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });
});

describe("worker restart", () => {
  test("a resubmitted job resumes from its folder and keeps numbering events", async () => {
    const sandbox = makeSandbox();
    const request = jobRequest(sandbox);
    let client = await startTestWorker(sandbox);
    try {
      await client.call("POST", "/v1/jobs", request);
      const first = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
      const lastSeq = first.events.at(-1).seq;
      await client.close();

      client = await startTestWorker(sandbox);
      assert.equal((await client.call("GET", `/v1/jobs/${request.jobId}`)).status, 404, "the new process has never seen the job");
      resetStageLog(sandbox);
      const resubmitted = await client.call("POST", "/v1/jobs", request);
      assert.equal(resubmitted.status, 202);
      assert.equal(resubmitted.body.events[0].seq, lastSeq + 1);
      const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
      assert.equal(job.status, "completed");
      assert.deepEqual(stagesRun(sandbox, request.jobId), []);
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });

  test("shutting down while a job is still starting cancels it before a runner starts", async () => {
    const sandbox = makeSandbox();
    let inDiskCheck;
    const reachedDiskCheck = new Promise((resolve) => (inDiskCheck = resolve));
    let finishDiskCheck;
    const diskChecked = new Promise((resolve) => (finishDiskCheck = resolve));
    const client = await startTestWorker(sandbox, {
      freeBytes: async () => {
        inDiskCheck();
        await diskChecked;
        return null;
      },
    });
    try {
      const request = jobRequest(sandbox);
      const submitted = client.call("POST", "/v1/jobs", request);
      await reachedDiskCheck;
      const stopped = client.worker.registry.shutdown();
      finishDiskCheck();
      await stopped;

      const response = await submitted;
      assert.equal(response.status, 202);
      assert.equal(response.body.status, "cancelled");
      assert.equal(response.body.errorCode, "cancelled");
      assert.equal(client.worker.registry.active, null);
      await sleep(300);
      assert.equal((await client.call("GET", `/v1/jobs/${request.jobId}`)).body.status, "cancelled");
      assert.deepEqual(stagesRun(sandbox, request.jobId), [], "no runner ran a stage");
      assert.ok(!existsSync(join(request.workDir, "source-audio")), "no runner prepared the job folder");
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });

  test("shutting down while a job's sources are being checked refuses it with a 503", async () => {
    const sandbox = makeSandbox();
    let inRootCheck;
    const reachedRootCheck = new Promise((resolve) => (inRootCheck = resolve));
    let finishRootCheck;
    const rootChecked = new Promise((resolve) => (finishRootCheck = resolve));
    const client = await startTestWorker(sandbox, {
      rootChecks: {
        timeoutMs: 10_000,
        check: async () => {
          inRootCheck();
          await rootChecked;
        },
      },
    });
    try {
      const request = jobRequest(sandbox);
      const submitted = client.call("POST", "/v1/jobs", request);
      await reachedRootCheck;
      const stopped = client.worker.registry.shutdown();
      finishRootCheck();
      await stopped;

      const response = await submitted;
      assert.equal(response.status, 503);
      assert.equal(response.body.errorCode, "worker_unavailable");
      assert.equal((await client.call("GET", `/v1/jobs/${request.jobId}`)).status, 404, "no record, so the next process takes it");
      assert.equal(client.worker.registry.active, null);
      assert.deepEqual(stagesRun(sandbox, request.jobId), []);
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });

  test("shutting down stops the running job, keeps its work, and refuses new jobs", async () => {
    const sandbox = makeSandbox();
    const client = await startTestWorker(sandbox, { mode: "hang", cancelGraceMs: 10_000 });
    try {
      const running = jobRequest(sandbox);
      await client.call("POST", "/v1/jobs", running);
      await waitForJob(client, running.jobId, (body) => body.stage === "generating_emissions");

      await client.worker.registry.shutdown();
      const stopped = await client.call("GET", `/v1/jobs/${running.jobId}`);
      assert.equal(stopped.body.status, "cancelled");
      assert.ok(existsSync(join(running.workDir, ".done-preparing_audio")), "finished stages stay cached for the next process");

      // The slot is free now, so only the shutdown flag keeps a fresh runner from starting.
      const refused = await client.call("POST", "/v1/jobs", jobRequest(sandbox));
      assert.equal(refused.status, 503);
      assert.equal(refused.body.errorCode, "worker_unavailable");
      const resubmitted = await client.call("POST", "/v1/jobs", running);
      assert.equal(resubmitted.status, 503);
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });
});

describe("model download", () => {
  test("runs as its own stage only while the model is missing", async () => {
    const sandbox = makeSandbox();
    const client = await startTestWorker(sandbox, { modelDir: sandbox.modelDir });
    try {
      const first = jobRequest(sandbox);
      await client.call("POST", "/v1/jobs", first);
      const job = await waitForJob(client, first.jobId, (body) => TERMINAL.has(body.status));
      assert.equal(job.status, "completed");
      const codes = job.events.map((event) => event.code);
      assert.ok(codes.includes("model_download_started"));
      assert.ok(codes.includes("model_download_finished"));
      assert.deepEqual(
        stagesRun(sandbox, first.jobId).map((entry) => entry.stage),
        ["preparing_audio", "downloading_model", "generating_emissions", "marking_up_ebook", "aligning"],
      );

      const second = jobRequest(sandbox);
      await client.call("POST", "/v1/jobs", second);
      await waitForJob(client, second.jobId, (body) => TERMINAL.has(body.status));
      assert.ok(!stagesRun(sandbox, second.jobId).some((entry) => entry.stage === "downloading_model"));
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });
});

describe("cancellation and failures", () => {
  test("cancel stops a cooperative runner within the grace period", async () => {
    const sandbox = makeSandbox();
    const client = await startTestWorker(sandbox, { mode: "hang", cancelGraceMs: 10_000 });
    try {
      const request = jobRequest(sandbox);
      await client.call("POST", "/v1/jobs", request);
      await waitForJob(client, request.jobId, (body) => body.stage === "generating_emissions");
      const startedAt = Date.now();
      const cancel = await client.call("DELETE", `/v1/jobs/${request.jobId}`);
      assert.equal(cancel.status, 200);
      const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
      assert.ok(Date.now() - startedAt < 5_000, "stopped well inside the grace period");
      assert.equal(job.status, "cancelled");
      assert.equal(job.errorCode, "cancelled");
      assert.ok(!job.events.some((event) => event.code === "runner_killed"));
      assert.ok(existsSync(join(request.workDir, ".done-preparing_audio")), "finished stages stay cached");
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });

  test("cancel also stops processes the runner started, such as an ffmpeg STAlign left behind", async () => {
    const sandbox = makeSandbox();
    const client = await startTestWorker(sandbox, { mode: "orphan-child", cancelGraceMs: 10_000 });
    try {
      const request = jobRequest(sandbox);
      await client.call("POST", "/v1/jobs", request);
      const pidFile = join(request.workDir, "orphan.pid");
      await waitForJob(client, request.jobId, () => existsSync(pidFile));
      const pid = Number(readFileSync(pidFile, "utf8"));
      assert.ok(isAlive(pid), "the stand-in ffmpeg is running");
      await client.call("DELETE", `/v1/jobs/${request.jobId}`);
      const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
      assert.equal(job.status, "cancelled");
      const deadline = Date.now() + 3_000;
      while (isAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(!isAlive(pid), "the orphaned child was killed with the runner's process group");
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });

  test("a runner that ignores cancel is killed after the grace period", async () => {
    const sandbox = makeSandbox();
    const client = await startTestWorker(sandbox, { mode: "ignore-cancel", cancelGraceMs: 400 });
    try {
      const request = jobRequest(sandbox);
      await client.call("POST", "/v1/jobs", request);
      await waitForJob(client, request.jobId, (body) => body.stage === "generating_emissions");
      await client.call("DELETE", `/v1/jobs/${request.jobId}`);
      const running = await client.call("GET", `/v1/jobs/${request.jobId}`);
      assert.equal(running.body.status, "running", "still running until the runner exits");
      const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
      assert.equal(job.status, "cancelled");
      assert.ok(job.events.some((event) => event.code === "runner_killed"));
      assert.equal((await client.call("GET", "/health")).body.activeJobId, null);
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });

  test("a runner that exits without a result is worker_crashed and frees the slot", async () => {
    const sandbox = makeSandbox();
    const client = await startTestWorker(sandbox, { mode: "crash" });
    try {
      const request = jobRequest(sandbox);
      await client.call("POST", "/v1/jobs", request);
      const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
      assert.equal(job.status, "failed");
      assert.equal(job.errorCode, "worker_crashed");
      assert.match(job.error, /exit code 7/);
      const failed = job.events.find((event) => event.code === "job_failed");
      assert.equal(failed.level, "error");
      assert.equal(failed.data.exitCode, 7);
      assert.equal((await client.call("POST", "/v1/jobs", jobRequest(sandbox))).status, 202);
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });

  test("a stage failure carries its stage code and a redacted message", async () => {
    const sandbox = makeSandbox();
    const client = await startTestWorker(sandbox, { mode: "fail-markup" });
    try {
      const request = jobRequest(sandbox);
      await client.call("POST", "/v1/jobs", request);
      const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
      assert.equal(job.status, "failed");
      assert.equal(job.errorCode, "markup_failed");
      assert.match(job.error, /<work>\//);
      assert.ok(!job.error.includes(sandbox.root));
      for (const event of job.events) assert.ok(!(event.message ?? "").includes(sandbox.root), event.message);
      assert.ok(job.events.some((event) => event.code === "stage_failed" && event.stage === "marking_up_ebook"));
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });

  test("an empty output fails validation as invalid_output", async () => {
    const sandbox = makeSandbox();
    const client = await startTestWorker(sandbox, { mode: "empty-output" });
    try {
      const request = jobRequest(sandbox);
      await client.call("POST", "/v1/jobs", request);
      const job = await waitForJob(client, request.jobId, (body) => TERMINAL.has(body.status));
      assert.equal(job.errorCode, "invalid_output");
      assert.equal(job.stage, "validating");
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });

  test("too little free space fails the job before the runner starts", async () => {
    const sandbox = makeSandbox();
    const client = await startTestWorker(sandbox, { freeBytes: async () => 1_000 });
    try {
      const request = jobRequest(sandbox);
      const response = await client.call("POST", "/v1/jobs", request);
      assert.equal(response.status, 202);
      assert.equal(response.body.status, "failed");
      assert.equal(response.body.errorCode, "insufficient_storage");
      const event = response.body.events.find((entry) => entry.code === "disk_check_failed");
      assert.equal(event.data.availableBytes, 1_000);
      assert.ok(event.data.neededBytes > 512 * 1024 * 1024);
      assert.deepEqual(stagesRun(sandbox, request.jobId), []);
      assert.equal((await client.call("GET", "/health")).body.activeJobId, null);
    } finally {
      await client.close();
      sandbox.cleanup();
    }
  });
});

test("the control process never imports the pipeline", () => {
  for (const file of ["main", "server", "jobs", "config", "stages", "paths", "validation", "log", "accelerator", "protocol", "toolchain"]) {
    const source = readFileSync(new URL(`../dist/${file}.js`, import.meta.url), "utf8");
    assert.ok(!source.includes("@storyteller-platform/align"), `${file}.js imports STAlign`);
    assert.ok(!/from "\.\/(runner|pipeline)\.js"/.test(source), `${file}.js imports the runner`);
  }
});

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
