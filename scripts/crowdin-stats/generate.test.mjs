import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLayout, extractLanguages, fetchCrowdinApiProgress, fetchStats, generateSvg, parseArguments } from "./generate.mjs";

function language(id, name, locale, translationProgress, translated = 0, total = 0) {
  return { data: { languageId: id, language: { name, locale }, translationProgress, words: { translated, total } } };
}

const sampleStats = {
  progress: [
    language("de", "German", "de-DE", "96%", 18675, 19358),
    language("en", "English", "en-US", "95%", 18465, 19358),
    language("nl", "Dutch", "nl-NL", "95%", 18535, 19358),
    language("pt-BR", "Portuguese, Brazilian", "pt-BR", "97%", 18868, 19358),
    language("sl", "Slovenian", "sl-SI", "95%", 18554, 19358),
  ],
};

test("parseArguments parses flags", () => {
  const options = parseArguments(["--out", "custom.svg", "--url", "https://example.com/stats.json"]);
  assert.equal(options.outputPath, "custom.svg");
  assert.equal(options.statsUrl, "https://example.com/stats.json");
});

test("parseArguments rejects unknown flags and missing values", () => {
  assert.throws(() => parseArguments(["--nope", "x"]), /Unknown argument/);
  assert.throws(() => parseArguments(["--out"]), /Missing value for --out/);
});

test("parseArguments accepts a project override", () => {
  assert.equal(parseArguments([]).projectId, "912891");
  assert.equal(parseArguments(["--project", "42"]).projectId, "42");
});

test("fetchStats reads live progress from the Crowdin API when a token is available", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, authorization: init.headers.Authorization });
    return new Response(JSON.stringify({ data: [language("de", "German", "de-DE", 93, 4921, 5322)] }));
  };

  const { stats, source } = await fetchStats({ token: "secret-token", fetchImpl });

  assert.equal(source, "Crowdin API");
  assert.match(calls[0].url, /\/projects\/912891\/languages\/progress/);
  assert.equal(calls[0].authorization, "Bearer secret-token");
  // The API payload is remapped into the badge feed shape the generator expects.
  assert.equal(stats.progress[0].data.languageId, "de");
  assert.equal(extractLanguages(stats)[0].percent, 93);
});

test("fetchStats falls back to the cached badge feed when no token is set", async () => {
  let requested;
  const fetchImpl = async (url) => {
    requested = url;
    return new Response(JSON.stringify(sampleStats));
  };

  const { stats, source } = await fetchStats({ fetchImpl });

  assert.equal(source, "cached badge feed");
  assert.match(requested, /badges\.awesome-crowdin\.com/);
  assert.equal(stats.progress.length, sampleStats.progress.length);
});

test("fetchCrowdinApiProgress rejects failed requests and malformed payloads", async () => {
  await assert.rejects(() => fetchCrowdinApiProgress("token", { fetchImpl: async () => new Response("nope", { status: 500 }) }), /HTTP 500/);
  await assert.rejects(
    () => fetchCrowdinApiProgress("token", { fetchImpl: async () => new Response(JSON.stringify({ unexpected: true })) }),
    /Invalid Crowdin progress response format/,
  );
});

test("extractLanguages pins the source language at 100% and sorts targets by progress", () => {
  const languages = extractLanguages(sampleStats);
  assert.deepEqual(
    languages.map((item) => item.id),
    ["en", "pt-BR", "de", "nl", "sl"],
  );
  assert.deepEqual(languages[0].percent, 100);
  assert.equal(languages[0].isSource, true);
  assert.equal(languages[1].isSource, false);
});

test("extractLanguages derives flags from the locale and defaults missing progress to zero", () => {
  const [german] = extractLanguages({ progress: [language("de", "German", "de-DE", "96%")] });
  assert.equal(german.flag, "🇩🇪");

  const [brazilian] = extractLanguages({ progress: [language("pt-BR", "Portuguese, Brazilian", "pt-BR", "97%")] });
  assert.equal(brazilian.name, "Portuguese");
  assert.equal(brazilian.flag, "🇧🇷");

  const [unflagged] = extractLanguages({ progress: [language("pt-BR", "Portuguese, Brazilian", "pt", "97%")] });
  assert.equal(unflagged.name, "Portuguese, Brazilian");

  const [unknown] = extractLanguages({ progress: [{ data: { languageId: "eo" } }] });
  assert.equal(unknown.name, "eo");
  assert.equal(unknown.flag, "");
  assert.equal(unknown.percent, 0);
});

test("generateSvg renders every target language with its percentage", () => {
  const svg = generateSvg(sampleStats);
  assert.match(svg, /^<svg /);
  assert.match(svg, /🇩🇪 {2}German/);
  assert.match(svg, /🇳🇱 {2}Dutch/);
  assert.match(svg, /🇧🇷 {2}Portuguese</);
  assert.match(svg, /🇸🇮 {2}Slovenian/);
  assert.match(svg, />97%</);
  assert.match(svg, /4 target languages · 96% average/);
  assert.match(svg, /English/);
});

test("generateSvg renders the source language like any other completed row but keeps it out of the average", () => {
  const svg = generateSvg(sampleStats);
  const [source] = extractLanguages(sampleStats);
  const layout = computeLayout(extractLanguages(sampleStats));

  assert.equal(source.isSource, true);
  assert.equal(source.percent, 100);
  assert.doesNotMatch(svg, /bar-source/);
  // English sits at 100%, so it takes the completed tier and fills the whole bar.
  assert.match(svg, new RegExp(`width="${layout.barWidth}" height="8" rx="4" class="bar-done"`));
  assert.match(svg, /96% average/);
});

test("generateSvg renders at its natural size so label type is never scaled down", () => {
  const { height } = computeLayout(extractLanguages(sampleStats));
  assert.match(generateSvg(sampleStats), new RegExp(`<svg [^>]*width="540" height="${height}" viewBox="0 0 540 ${height}"`));
});

test("generateSvg grows the canvas instead of overflowing when languages are added", () => {
  const withExtra = generateSvg({ progress: [...sampleStats.progress, language("es", "Spanish", "es-ES", "40%", 4000, 19358)] });
  assert.match(withExtra, /viewBox="0 0 540 278"/);
  assert.match(withExtra, /🇪🇸 {2}Spanish/);
  assert.match(generateSvg(sampleStats), /viewBox="0 0 540 250"/);
});

test("computeLayout keeps horizontal rows at any language count", () => {
  const rows = (count) => Array.from({ length: count }, (_, index) => ({ name: `Language ${index}`, flag: "", percent: 50 }));
  const nine = computeLayout(rows(9));
  const twenty = computeLayout(rows(20));

  assert.equal(nine.count, 9);
  assert.equal(twenty.height - nine.height, 11 * 28, "each extra language adds exactly one row");
});

test("generateSvg renders many languages as rows without rotating labels", () => {
  const many = {
    progress: [
      language("en", "English", "en-US", "95%", 1, 2),
      ...Array.from({ length: 12 }, (_, index) => language(`l${index}`, `Language ${index}`, "xx-XX", "50%", 1, 2)),
    ],
  };
  const layout = computeLayout(extractLanguages(many));
  const svg = generateSvg(many);

  assert.equal(layout.count, 13);
  assert.match(svg, new RegExp(`viewBox="0 0 540 ${layout.height}"`));
  assert.equal(svg.match(/class="bar-bg"/g).length, 13);
  assert.doesNotMatch(svg, /rotate\(/);
});

test("computeLayout sizes the label column to the widest name", () => {
  const short = computeLayout([{ name: "Thai", flag: "", percent: 50 }]);
  const long = computeLayout([
    { name: "Thai", flag: "", percent: 50 },
    { name: "Portuguese, Brazilian", flag: "", percent: 50 },
  ]);

  assert.ok(long.barX > short.barX, "a longer name must push the bar right");
  assert.equal(short.barX + short.barWidth, long.barX + long.barWidth, "bars stay right-aligned against the percentage column");
});

test("computeLayout caps the label column so one long name cannot squeeze out the bar", () => {
  const layout = computeLayout([{ name: "A".repeat(200), flag: "🇦🇽", percent: 50 }]);
  assert.ok(layout.barWidth > 200, `bar collapsed to ${layout.barWidth}px`);
  assert.match(generateSvg({ progress: [language("xx", "A".repeat(200), "ax-AX", "50%")] }), /…/);
});

test("generateSvg keeps bars inside the card", () => {
  const svg = generateSvg(sampleStats);
  assert.equal(svg.match(/class="bar-bg"/g).length, 5, "one track per language row");

  for (const [, x, width] of svg.matchAll(/<rect x="(\d+)" y="\d+" width="(\d+)"[^>]*class="bar-(?:bg|done|progress|low)"/g)) {
    assert.ok(Number(x) >= 24, "bar must not overflow the left padding");
    assert.ok(Number(x) + Number(width) <= 540 - 24, "bar must not overflow the right padding");
  }
});

test("generateSvg colours bars by progress and always explains the scale", () => {
  const svg = generateSvg({
    progress: [language("de", "German", "de-DE", "100%"), language("nl", "Dutch", "nl-NL", "70%"), language("sl", "Slovenian", "sl-SI", "12%")],
  });
  assert.match(svg, /class="bar-done"/);
  assert.match(svg, /class="bar-progress"/);
  assert.match(svg, /class="bar-low"/);

  // Every tier stays in the legend even when no language currently falls in it.
  const complete = generateSvg({ progress: [language("de", "German", "de-DE", "100%")] });
  for (const label of ["Complete", "In progress", "Needs work"]) {
    assert.match(complete, new RegExp(`>${label}<`));
  }
});

test("generateSvg escapes language names and handles empty data", () => {
  const svg = generateSvg({ progress: [language("xx", "A & B <Test>", "xx-XX", "10%")] });
  assert.match(svg, /A &amp; B &lt;Test&gt;/);

  const empty = generateSvg({ progress: [] });
  assert.match(empty, /no translation data/);
  assert.match(empty, /viewBox="0 0 540 96"/);
  assert.doesNotMatch(empty, /NaN|undefined/);
});
