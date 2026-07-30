import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, mock } from "node:test";

import {
  HistoryLimitError,
  appendSnapshot,
  buildExactSeries,
  condensePoints,
  fetchStarDates,
  loadSeries,
  niceYAxis,
  normalizeSeries,
  renderSvg,
  saveSeries,
  updateSeries,
} from "./generate.mjs";

const REPOSITORY = "bookorbit/bookorbit";
const temporaryDirectories = [];

function dateFromDay(value) {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}

afterEach(async () => {
  mock.restoreAll();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function series(overrides = {}) {
  return {
    schemaVersion: 1,
    repository: REPOSITORY,
    updatedAt: "2026-07-27",
    lastExactFetch: "2026-07-26",
    source: "snapshot",
    points: [
      { date: "2026-05-15", stars: 1 },
      { date: "2026-06-15", stars: 540 },
      { date: "2026-07-27", stars: 1768 },
    ],
    ...overrides,
  };
}

describe("series data", () => {
  it("collapses exact timestamps into cumulative daily points", () => {
    assert.deepEqual(buildExactSeries(["2026-05-16", "2026-05-15", "2026-05-16", "2026-05-18"], "2026-05-20"), [
      { date: "2026-05-15", stars: 1 },
      { date: "2026-05-16", stars: 3 },
      { date: "2026-05-18", stars: 4 },
      { date: "2026-05-20", stars: 4 },
    ]);
  });

  it("replaces a same-day snapshot and permits legitimate decreases", () => {
    assert.deepEqual(
      appendSnapshot(
        [
          { date: "2026-07-26", stars: 101 },
          { date: "2026-07-27", stars: 103 },
        ],
        "2026-07-27",
        100,
      ),
      [
        { date: "2026-07-26", stars: 101 },
        { date: "2026-07-27", stars: 100 },
      ],
    );
  });

  it("rejects exact timestamps in the future", () => {
    assert.throws(() => buildExactSeries(["2026-07-28"], "2026-07-27"), /in the future/);
  });

  it("rejects repository mismatches and duplicate dates", () => {
    assert.throws(() => normalizeSeries(series({ repository: "someone/else" }), REPOSITORY), /belongs to someone\/else/);
    assert.throws(
      () =>
        normalizeSeries(
          series({
            points: [
              { date: "2026-07-27", stars: 10 },
              { date: "2026-07-27", stars: 11 },
            ],
          }),
          REPOSITORY,
        ),
      /strictly increasing/,
    );
  });

  it("round-trips an atomically written series", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bookorbit-star-history-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "series.json");

    await saveSeries(path, series());

    assert.deepEqual(await loadSeries(path, REPOSITORY), series());
  });

  it("reports malformed JSON with its path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bookorbit-star-history-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "broken.json");
    await writeFile(path, "{", "utf8");

    await assert.rejects(loadSeries(path, REPOSITORY), /broken\.json is not valid JSON/);
  });
});

describe("GitHub data sources", () => {
  it("requests timestamped stargazers and returns sorted dates", async () => {
    const fetchImpl = mock.fn(async (_url, options) => {
      assert.equal(options.headers.Accept, "application/vnd.github.star+json");
      return new Response(JSON.stringify([{ starred_at: "2026-05-16T03:20:51Z" }, { starred_at: "2026-05-15T18:12:51Z" }]), { status: 200 });
    });

    assert.deepEqual(await fetchStarDates(REPOSITORY, "token", { fetchImpl }), ["2026-05-15", "2026-05-16"]);
    assert.equal(fetchImpl.mock.callCount(), 1);
  });

  it("fails instead of silently truncating exact history", async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify([{ starred_at: "2026-05-15T18:12:51Z" }]), {
        status: 200,
      });

    await assert.rejects(
      fetchStarDates(REPOSITORY, "token", {
        fetchImpl,
        maxPages: 1,
        perPage: 1,
      }),
      HistoryLimitError,
    );
  });

  it("rejects oversized API responses before reading them", async () => {
    const fetchImpl = async () =>
      new Response("[]", {
        status: 200,
        headers: { "content-length": "2000001" },
      });

    await assert.rejects(fetchStarDates(REPOSITORY, "token", { fetchImpl }), /exceeds 2000000 bytes/);
  });

  it("rejects invalid repository identifiers", async () => {
    await assert.rejects(fetchStarDates("../private", "token", { fetchImpl: mock.fn() }), /Invalid GitHub repository/);
  });

  it("falls back to the current count while preserving exact-history metadata", async () => {
    mock.method(console, "warn", () => {});
    const fetchImpl = async (url) => {
      if (String(url).includes("/stargazers")) {
        return new Response(JSON.stringify({ message: "Forbidden" }), {
          status: 403,
        });
      }
      return new Response(JSON.stringify({ stargazers_count: 1771 }), {
        status: 200,
      });
    };

    const updated = await updateSeries({
      repository: REPOSITORY,
      existingSeries: series(),
      exactToken: "exact-token",
      metadataToken: "metadata-token",
      today: "2026-07-28",
      fetchImpl,
    });

    assert.equal(updated.source, "snapshot");
    assert.equal(updated.lastExactFetch, "2026-07-26");
    assert.deepEqual(updated.points.at(-1), {
      date: "2026-07-28",
      stars: 1771,
    });
  });
});

describe("SVG rendering", () => {
  it("chooses readable rounded y-axis intervals", () => {
    assert.deepEqual(niceYAxis(1768), { maximum: 2000, step: 500 });
    assert.deepEqual(niceYAxis(8), { maximum: 10, step: 2.5 });
  });

  it("renders a deterministic self-contained BookOrbit star card", () => {
    const svg = renderSvg(series());

    assert.equal(svg, renderSvg(series()));
    assert.match(svg, /bookorbit\/bookorbit/);
    assert.match(svg, /id="bookorbit-mark"/);
    assert.match(svg, /id="current-coordinate"/);
    assert.match(svg, /id="current-total"/);
    assert.match(svg, /class="twinkle"/);
    assert.match(svg, /prefers-reduced-motion/);
    assert.match(svg, /GitHub stars over time/);
    assert.match(svg, /updated 2026-07-27/);
    assert.match(svg, /1,768 stars/);
    assert.doesNotMatch(svg, /<script|<animate|(?:href|src)=["']https?:/);
  });

  it("condenses long histories so the card stays small", () => {
    const points = Array.from({ length: 900 }, (_, index) => ({
      date: dateFromDay(20_000 + index),
      stars: index + 1,
    }));

    const condensed = condensePoints(points);

    assert.ok(condensed.length <= 180);
    assert.deepEqual(condensed[0], points[0]);
    assert.deepEqual(condensed.at(-1), points.at(-1));
    assert.ok(condensed.every((point, index) => index === 0 || point.date > condensed[index - 1].date));
    assert.equal(condensePoints(points.slice(0, 40)).length, 40);
  });

  it("keeps the trend line visible when CSS animations are unsupported", () => {
    const svg = renderSvg(series());

    assert.match(svg, /@keyframes draw \{ from \{ stroke-dashoffset: \d+; \} to \{ stroke-dashoffset: 0; \} \}/);
    assert.doesNotMatch(svg, /\.trend[^{]*\{[^}]*stroke-dashoffset:/);
  });

  it("escapes repository text used in SVG markup", () => {
    const svg = renderSvg(series({ repository: "book&orbit/<chart>" }));

    assert.match(svg, /book&amp;orbit\/&lt;chart&gt;/);
    assert.doesNotMatch(svg, /book&orbit\/<chart>/);
  });
});
