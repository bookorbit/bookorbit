#!/usr/bin/env node

import { rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The badge feed is a cached snapshot and can lag the project by hours, which
// silently renders a stale chart. Prefer the Crowdin API when a token is
// available and keep the badge feed as the tokenless fallback.
const STATS_URL = "https://badges.awesome-crowdin.com/stats-17791545-912891.json";
const API_BASE = "https://api.crowdin.com/api/v2";
const PROJECT_ID = "912891";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const SOURCE_LANGUAGE_ID = "en";

const WIDTH = 540;
const PADDING_X = 24;
const DIVIDER_Y = 51;

const ROW_BASELINE = 78;
const ROW_HEIGHT = 28;
const BAR_HEIGHT = 8;
const BAR_RADIUS = 4;
const BAR_BASELINE_OFFSET = 9;

const FLAG_WIDTH = 26;
const LABEL_CHAR_WIDTH = 7.6;
const LABEL_MAX_WIDTH = 180;
const LABEL_GAP = 18;
const PERCENT_WIDTH = 42;
const PERCENT_GAP = 14;

const LEGEND_SWATCH = 8;
const LEGEND_CHAR_WIDTH = 5.9;
const LEGEND_TEXT_GAP = 14;
const LEGEND_ITEM_GAP = 22;
const LEGEND_RULE_GAP = 20;
const LEGEND_BASELINE_GAP = 40;
const LEGEND_BOTTOM_PADDING = 20;
const EMPTY_HEIGHT = 96;

// Ordered high to low; the first tier a percentage clears wins. Three tiers is a
// hard ceiling, not a style choice: a fourth needs an amber that sits at deuteranopia
// ΔE 1.4 against the orange, which no threshold tuning can separate.
const TIERS = [
  { className: "bar-done", label: "Complete", min: 100 },
  { className: "bar-progress", label: "In progress", min: 70 },
  { className: "bar-low", label: "Needs work", min: 0 },
];

export class CrowdinStatsError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = "CrowdinStatsError";
    this.status = status;
    this.url = url;
  }
}

export function parseArguments(argv) {
  const options = {
    outputPath: "translation-progress.svg",
    statsUrl: STATS_URL,
    projectId: PROJECT_ID,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (!["--out", "--url", "--project"].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }

    if (flag === "--out") options.outputPath = value;
    if (flag === "--url") options.statsUrl = value;
    if (flag === "--project") options.projectId = value;
    index += 1;
  }

  return options;
}

async function readJsonResponse(response, url) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new CrowdinStatsError(`Crowdin response exceeds ${MAX_RESPONSE_BYTES} bytes`, { url });
  }
  if (!response.body) {
    throw new CrowdinStatsError("Crowdin response has no body", { url });
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new CrowdinStatsError(`Crowdin response exceeds ${MAX_RESPONSE_BYTES} bytes`, { url });
    }
    chunks.push(Buffer.from(value));
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CrowdinStatsError("Crowdin response is not valid JSON", { url });
  }
}

export async function fetchCrowdinStats(url = STATS_URL, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "bookorbit-crowdin-stats" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new CrowdinStatsError(`Failed to fetch Crowdin stats: HTTP ${response.status}`, {
      status: response.status,
      url,
    });
  }

  const json = await readJsonResponse(response, url);
  if (!json || !Array.isArray(json.progress)) {
    throw new CrowdinStatsError("Invalid Crowdin stats response format", { url });
  }

  return json;
}

export async function fetchCrowdinApiProgress(token, { projectId = PROJECT_ID, fetchImpl = fetch } = {}) {
  const url = `${API_BASE}/projects/${projectId}/languages/progress?limit=500`;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "bookorbit-crowdin-stats" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new CrowdinStatsError(`Failed to fetch Crowdin progress: HTTP ${response.status}`, {
      status: response.status,
      url,
    });
  }

  const json = await readJsonResponse(response, url);
  if (!json || !Array.isArray(json.data)) {
    throw new CrowdinStatsError("Invalid Crowdin progress response format", { url });
  }

  // Present the API payload in the same shape as the badge feed so the rest of
  // the generator does not care which source produced it.
  return { progress: json.data };
}

export async function fetchStats({ token, statsUrl = STATS_URL, projectId = PROJECT_ID, fetchImpl = fetch } = {}) {
  if (token) {
    return { stats: await fetchCrowdinApiProgress(token, { projectId, fetchImpl }), source: "Crowdin API" };
  }
  return { stats: await fetchCrowdinStats(statsUrl, fetchImpl), source: "cached badge feed" };
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function flagFromLocale(locale) {
  const region = /[-_]([A-Za-z]{2})$/.exec(locale || "")?.[1];
  if (!region) return "";

  return String.fromCodePoint(...[...region.toUpperCase()].map((letter) => letter.codePointAt(0) + 0x1f1a5));
}

function displayFor(languageId, apiLanguage) {
  const flag = flagFromLocale(apiLanguage?.locale);
  const name = apiLanguage?.name || languageId;

  return {
    name: flag ? name.split(",")[0].trim() : name,
    flag,
  };
}

function toPercent(value) {
  const parsed = Number.parseInt(String(value).replace("%", ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
}

export function extractLanguages(statsData) {
  const targets = [];
  let source;

  for (const entry of statsData?.progress ?? []) {
    const data = entry?.data;
    const languageId = data?.languageId;
    if (!languageId) continue;

    const display = displayFor(languageId, data.language);

    if (languageId === SOURCE_LANGUAGE_ID) {
      source = { id: languageId, ...display, percent: 100, isSource: true, translatedWords: 0, totalWords: 0 };
      continue;
    }

    targets.push({
      id: languageId,
      ...display,
      percent: toPercent(data.translationProgress),
      isSource: false,
      translatedWords: data.words?.translated || 0,
      totalWords: data.words?.total || 0,
    });
  }

  targets.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name, "en"));

  return source ? [source, ...targets] : targets;
}

function averagePercent(languages) {
  const targets = languages.filter((language) => !language.isSource);
  if (targets.length === 0) return 0;

  const totalWords = targets.reduce((sum, language) => sum + language.totalWords, 0);
  if (totalWords > 0) {
    const translatedWords = targets.reduce((sum, language) => sum + language.translatedWords, 0);
    return Math.round((translatedWords / totalWords) * 100);
  }

  return Math.round(targets.reduce((sum, language) => sum + language.percent, 0) / targets.length);
}

function truncateToWidth(name, availableWidth, charWidth) {
  const maxCharacters = Math.floor(availableWidth / charWidth);
  if (maxCharacters <= 1 || name.length <= maxCharacters) return name;
  return `${name.slice(0, maxCharacters - 1).trimEnd()}…`;
}

function labelFor(language, availableWidth, charWidth) {
  const textWidth = availableWidth - (language.flag ? FLAG_WIDTH : 0);
  const name = truncateToWidth(language.name, textWidth, charWidth);

  return {
    text: language.flag ? `${language.flag}  ${name}` : name,
    width: (language.flag ? FLAG_WIDTH : 0) + name.length * charWidth,
  };
}

export function computeLayout(languages) {
  const count = languages.length;
  const labels = languages.map((language) => labelFor(language, LABEL_MAX_WIDTH, LABEL_CHAR_WIDTH));
  // The label column tracks the widest name rather than a fixed slab, so a short
  // language list does not open a gap between each name and its bar.
  const labelWidth = count ? Math.max(...labels.map((label) => label.width)) : 0;
  const barX = Math.round(PADDING_X + labelWidth + LABEL_GAP);
  const lastRowY = ROW_BASELINE + Math.max(0, count - 1) * ROW_HEIGHT;

  return {
    count,
    labels,
    barX,
    barWidth: WIDTH - PADDING_X - PERCENT_WIDTH - PERCENT_GAP - barX,
    lastRowY,
    legendY: lastRowY + LEGEND_BASELINE_GAP,
    height: count ? lastRowY + LEGEND_BASELINE_GAP + LEGEND_BOTTOM_PADDING : EMPTY_HEIGHT,
  };
}

function barClass(language) {
  return TIERS.find((tier) => language.percent >= tier.min).className;
}

function renderRow(language, index, layout) {
  const baseline = ROW_BASELINE + index * ROW_HEIGHT;
  const barY = baseline - BAR_BASELINE_OFFSET;
  const fillWidth = Math.round((language.percent / 100) * layout.barWidth);

  return `
  <text x="${PADDING_X}" y="${baseline}" class="lang-label">${escapeXml(layout.labels[index].text)}</text>
  <rect x="${layout.barX}" y="${barY}" width="${layout.barWidth}" height="${BAR_HEIGHT}" rx="${BAR_RADIUS}" class="bar-bg" />
  <rect x="${layout.barX}" y="${barY}" width="${fillWidth}" height="${BAR_HEIGHT}" rx="${BAR_RADIUS}" class="${barClass(language)}" />
  <text x="${WIDTH - PADDING_X}" y="${baseline}" text-anchor="end" class="pct-label">${language.percent}%</text>`;
}

// Every tier is listed even when no language currently falls in it, so the colour
// scale stays self-describing and the card height does not shift as progress moves.
function renderLegend(layout) {
  let x = PADDING_X;

  const entries = TIERS.map((tier) => {
    const entry = `
  <rect x="${x}" y="${layout.legendY - LEGEND_SWATCH}" width="${LEGEND_SWATCH}" height="${LEGEND_SWATCH}" rx="2" class="${tier.className}" />
  <text x="${x + LEGEND_TEXT_GAP}" y="${layout.legendY}" class="legend-label">${tier.label}</text>`;
    x += LEGEND_TEXT_GAP + tier.label.length * LEGEND_CHAR_WIDTH + LEGEND_ITEM_GAP;
    return entry;
  }).join("");

  return `
  <line x1="${PADDING_X}" y1="${layout.lastRowY + LEGEND_RULE_GAP}" x2="${WIDTH - PADDING_X}" y2="${layout.lastRowY + LEGEND_RULE_GAP}" class="grid" />${entries}`;
}

function renderBody(languages, layout) {
  if (layout.count === 0) return "";

  return languages.map((language, index) => renderRow(language, index, layout)).join("") + renderLegend(layout);
}

export function generateSvg(statsData) {
  const languages = extractLanguages(statsData);
  const layout = computeLayout(languages);
  const targetCount = languages.filter((language) => !language.isSource).length;
  const summary =
    targetCount > 0
      ? `Crowdin · ${targetCount} target ${targetCount === 1 ? "language" : "languages"} · ${averagePercent(languages)}% average`
      : "Crowdin · no translation data";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${layout.height}" viewBox="0 0 ${WIDTH} ${layout.height}" fill="none" role="img" aria-label="BookOrbit translation progress">
  <title>BookOrbit translation progress</title>
  <style>
    .card { fill: #0d1117; stroke: #30363d; stroke-width: 1px; rx: 12px; }
    .title { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; fill: #f0f6fc; }
    .subtitle { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 400; fill: #8b949e; }
    .lang-label { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 500; fill: #e6edf3; }
    .pct-label { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13.5px; font-weight: 600; fill: #e6edf3; font-variant-numeric: tabular-nums; }
    .legend-label { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11px; font-weight: 400; fill: #8b949e; }
    .grid { stroke: #21262d; stroke-width: 1; }
    .bar-bg { fill: #21262d; }
    .bar-done { fill: #2ea043; }
    .bar-progress { fill: #2f81f7; }
    .bar-low { fill: #db6d28; }
  </style>
  <rect width="${WIDTH - 2}" height="${layout.height - 2}" x="1" y="1" class="card" />

  <text x="${PADDING_X}" y="35" class="title">Translation Progress</text>
  <text x="${WIDTH - PADDING_X}" y="35" text-anchor="end" class="subtitle">${escapeXml(summary)}</text>

  <line x1="${PADDING_X}" y1="${DIVIDER_Y}" x2="${WIDTH - PADDING_X}" y2="${DIVIDER_Y}" class="grid" />
${renderBody(languages, layout)}
</svg>
`;
}

async function writeFileAtomically(path, contents) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const { stats, source } = await fetchStats({
    token: process.env.CROWDIN_TOKEN,
    statsUrl: options.statsUrl,
    projectId: options.projectId,
  });
  const svg = generateSvg(stats);
  const resolvedPath = resolve(process.cwd(), options.outputPath);
  await writeFileAtomically(resolvedPath, svg);

  console.log(`Wrote ${resolvedPath} with ${extractLanguages(stats).length} languages from the ${source}`);
  if (!process.env.CROWDIN_TOKEN) {
    console.warn("CROWDIN_TOKEN is not set, so these numbers may lag the project. Set it to read live progress.");
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entryPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
