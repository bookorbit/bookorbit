#!/usr/bin/env node

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_ROOT = "https://api.github.com";
const DEFAULT_REPOSITORY = "bookorbit/bookorbit";
const MAX_PAGES = 400;
const PER_PAGE = 100;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2_000_000;

const WIDTH = 680;
const HEIGHT = 380;
const RENDERED_WIDTH = 580;
const PANEL_X = 18;
const PANEL_Y = 58;
const PANEL_WIDTH = 644;
const PANEL_HEIGHT = 252;
const PLOT_LEFT = 76;
const PLOT_RIGHT = 642;
const GRID_RIGHT = 646;
const PLOT_TOP = 86;
const BASELINE = 288;
const AXIS_LABEL_Y = 332;
const MAX_DATE_TICKS = 4;
const MAX_RENDERED_POINTS = 180;

export class GitHubApiError extends Error {
  constructor(message, { status, url, headers }) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.url = url;
    this.headers = headers;
  }
}

export class HistoryLimitError extends Error {
  constructor(limit) {
    super(`GitHub returned at least ${limit.toLocaleString("en-US")} stargazers, which exceeds the exact-history pagination limit`);
    this.name = "HistoryLimitError";
  }
}

function parseArguments(argv) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
    seriesPath: "star-history.json",
    bootstrapPath: undefined,
    outputPath: "star-history.svg",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (!["--repo", "--series", "--bootstrap", "--out"].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }

    if (flag === "--repo") options.repository = value;
    if (flag === "--series") options.seriesPath = value;
    if (flag === "--bootstrap") options.bootstrapPath = value;
    if (flag === "--out") options.outputPath = value;
    index += 1;
  }

  return options;
}

function utcToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function dayNumber(value) {
  return Date.parse(`${value}T00:00:00Z`) / 86_400_000;
}

function dateFromDayNumber(value) {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}

function xmlEscape(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function repositoryApiPath(repository) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);
  if (!match || [match[1], match[2]].some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  return `${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`;
}

export function normalizeSeries(payload, repository) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Star history must be a JSON object");
  }
  if (payload.schemaVersion !== 1) {
    throw new Error(`Unsupported star-history schema version: ${payload.schemaVersion}`);
  }
  if (payload.repository !== repository) {
    throw new Error(`Star history belongs to ${payload.repository ?? "an unknown repository"}, not ${repository}`);
  }
  if (!Array.isArray(payload.points) || payload.points.length === 0) {
    throw new Error("Star history must contain at least one point");
  }

  let previousDate;
  const points = payload.points.map((point, index) => {
    if (!point || typeof point !== "object" || Array.isArray(point)) {
      throw new Error(`Point ${index + 1} must be an object`);
    }
    if (!isIsoDate(point.date)) {
      throw new Error(`Point ${index + 1} has an invalid date`);
    }
    if (!Number.isSafeInteger(point.stars) || point.stars < 0) {
      throw new Error(`Point ${index + 1} has an invalid star count`);
    }
    if (previousDate && point.date <= previousDate) {
      throw new Error("Star-history dates must be unique and strictly increasing");
    }
    previousDate = point.date;
    return { date: point.date, stars: point.stars };
  });

  if (payload.updatedAt !== undefined && !isIsoDate(payload.updatedAt)) {
    throw new Error("Star history has an invalid updatedAt date");
  }
  if (payload.lastExactFetch !== undefined && !isIsoDate(payload.lastExactFetch)) {
    throw new Error("Star history has an invalid lastExactFetch date");
  }
  if (payload.source !== "exact" && payload.source !== "snapshot") {
    throw new Error("Star history source must be exact or snapshot");
  }

  return {
    schemaVersion: 1,
    repository,
    updatedAt: payload.updatedAt,
    lastExactFetch: payload.lastExactFetch,
    source: payload.source,
    points,
  };
}

export async function loadSeries(path, repository) {
  try {
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) return undefined;
    return normalizeSeries(JSON.parse(raw), repository);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) {
      throw new Error(`${path} is not valid JSON: ${error.message}`);
    }
    throw error;
  }
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

export async function saveSeries(path, series) {
  await writeFileAtomically(path, `${JSON.stringify(series, null, 2)}\n`);
}

async function readJsonResponse(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`GitHub response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`GitHub response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(Buffer.from(value));
  }

  const body = Buffer.concat(chunks).toString("utf8");
  try {
    return body ? JSON.parse(body) : undefined;
  } catch {
    return undefined;
  }
}

async function requestJson(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bookorbit-star-history",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    const apiMessage = payload && typeof payload.message === "string" ? payload.message : "GitHub returned no message body";
    throw new GitHubApiError(`GitHub API returned ${response.status}: ${apiMessage}`, {
      status: response.status,
      url,
      headers: response.headers,
    });
  }

  return payload;
}

export async function fetchStarDates(repository, token, { fetchImpl = fetch, maxPages = MAX_PAGES, perPage = PER_PAGE } = {}) {
  const dates = [];
  const repositoryPath = repositoryApiPath(repository);

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`${API_ROOT}/repos/${repositoryPath}/stargazers`);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github.star+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "bookorbit-star-history",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const batch = await readJsonResponse(response);

    if (!response.ok) {
      const apiMessage = batch && typeof batch.message === "string" ? batch.message : "GitHub returned no message body";
      throw new GitHubApiError(`GitHub API returned ${response.status}: ${apiMessage}`, {
        status: response.status,
        url: url.toString(),
        headers: response.headers,
      });
    }
    if (!Array.isArray(batch)) {
      throw new Error("GitHub returned an invalid stargazer response");
    }

    for (const entry of batch) {
      const date = entry?.starred_at?.slice(0, 10);
      if (!isIsoDate(date)) {
        throw new Error("GitHub returned a stargazer without a valid starred_at timestamp");
      }
      dates.push(date);
    }

    if (batch.length < perPage) {
      return dates.sort();
    }
  }

  throw new HistoryLimitError(maxPages * perPage);
}

export async function fetchStarCount(repository, token, { fetchImpl = fetch } = {}) {
  const repositoryPath = repositoryApiPath(repository);
  const payload = await requestJson(`${API_ROOT}/repos/${repositoryPath}`, token, fetchImpl);
  if (!Number.isSafeInteger(payload?.stargazers_count) || payload.stargazers_count < 0) {
    throw new Error("GitHub returned an invalid stargazers_count");
  }
  return payload.stargazers_count;
}

export function buildExactSeries(starDates, today) {
  if (!isIsoDate(today)) throw new Error("today must be an ISO date");
  if (starDates.length === 0) throw new Error("GitHub returned no stargazers");

  const points = [];
  let count = 0;

  for (const date of [...starDates].sort()) {
    if (!isIsoDate(date)) throw new Error(`Invalid stargazer date: ${date}`);
    if (date > today) throw new Error(`Stargazer date is in the future: ${date}`);
    count += 1;
    if (points.at(-1)?.date === date) {
      points[points.length - 1] = { date, stars: count };
    } else {
      points.push({ date, stars: count });
    }
  }

  if (points.at(-1).date < today) {
    points.push({ date: today, stars: count });
  }

  return points;
}

export function appendSnapshot(points, date, stars) {
  if (!isIsoDate(date)) throw new Error("Snapshot date must be an ISO date");
  if (!Number.isSafeInteger(stars) || stars < 0) {
    throw new Error("Snapshot count must be a non-negative integer");
  }

  const futurePoint = points.find((point) => point.date > date);
  if (futurePoint) {
    throw new Error(`Stored series contains a future point at ${futurePoint.date}`);
  }

  return [...points.filter((point) => point.date !== date), { date, stars }].sort((a, b) => a.date.localeCompare(b.date));
}

export function niceYAxis(maximum) {
  const target = Math.max(1, maximum * 1.1);
  const rawStep = target / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = Math.max(1, factor * magnitude);
  return {
    maximum: Math.ceil(target / step) * step,
    step,
  };
}

function formatCount(value) {
  return value.toLocaleString("en-US");
}

function formatDateLabel(value, { day = false, year = false } = {}) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    ...(day ? { day: "numeric" } : {}),
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function coordinate(value) {
  return Number(value.toFixed(1));
}

function fivePointStarPath(centerX, centerY, outerRadius) {
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outerRadius : outerRadius * 0.44;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    points.push(`${coordinate(centerX + Math.cos(angle) * radius)},${coordinate(centerY + Math.sin(angle) * radius)}`);
  }
  return `M${points.join(" L")}Z`;
}

function seededRandom(seed) {
  let state = 2_166_136_261;
  for (const character of seed) {
    state ^= character.codePointAt(0);
    state = Math.imul(state, 16_777_619);
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

/**
 * Keeps the rendered path small enough for a README-sized card. Years of daily
 * history would otherwise ship thousands of curve segments nobody can see.
 */
export function condensePoints(points, limit = MAX_RENDERED_POINTS) {
  if (points.length <= limit) return points;

  const stride = (points.length - 1) / (limit - 1);
  const indexes = new Set();
  for (let index = 0; index < limit; index += 1) {
    indexes.add(Math.round(index * stride));
  }
  indexes.add(points.length - 1);

  return [...indexes].sort((a, b) => a - b).map((index) => points[index]);
}

/**
 * Smooths the series with monotone cubic interpolation so the curve never
 * overshoots into a star count the repository never had.
 */
function monotoneCurve(coordinates) {
  const [first] = coordinates;
  const commands = [`M${coordinate(first[0])} ${coordinate(first[1])}`];
  const widths = [];
  const slopes = [];

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const width = coordinates[index + 1][0] - coordinates[index][0];
    widths.push(width);
    slopes.push(width === 0 ? 0 : (coordinates[index + 1][1] - coordinates[index][1]) / width);
  }

  const tangents = coordinates.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === coordinates.length - 1) return slopes.at(-1);
    if (slopes[index - 1] * slopes[index] <= 0) return 0;
    const left = 2 * widths[index] + widths[index - 1];
    const right = widths[index] + 2 * widths[index - 1];
    return (left + right) / (left / slopes[index - 1] + right / slopes[index]);
  });

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const [x0, y0] = coordinates[index];
    const [x1, y1] = coordinates[index + 1];
    const third = widths[index] / 3;
    commands.push(
      `C${coordinate(x0 + third)} ${coordinate(y0 + tangents[index] * third)} ${coordinate(x1 - third)} ${coordinate(y1 - tangents[index + 1] * third)} ${coordinate(x1)} ${coordinate(y1)}`,
    );
  }

  return commands.join(" ");
}

function polylineLength(coordinates) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += Math.hypot(coordinates[index][0] - coordinates[index - 1][0], coordinates[index][1] - coordinates[index - 1][1]);
  }
  return total;
}

const RESERVED_TEXT_BOXES = [
  { x: 16, y: 14, width: 290, height: 34 },
  { x: WIDTH - 190, y: 20, width: 174, height: 28 },
  { x: WIDTH - 170, y: HEIGHT - 34, width: 154, height: 26 },
];

function overlapsText(x, y) {
  return RESERVED_TEXT_BOXES.some((box) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height);
}

function renderStarfield(repository) {
  const random = seededRandom(repository);
  const dust = [];
  const twinkles = [];

  for (let index = 0; index < 48; index += 1) {
    const x = 14 + random() * (WIDTH - 28);
    const y = 12 + random() * (HEIGHT - 24);
    const roll = random();

    if (overlapsText(x, y)) continue;

    if (roll > 0.87) {
      const radius = 2.6 + random() * 1.9;
      const duration = 3.6 + random() * 3.4;
      const delay = -(random() * duration);
      twinkles.push(
        `<path class="twinkle" d="${fivePointStarPath(x, y, radius)}" fill="#dbe5ff" style="animation-duration:${duration.toFixed(1)}s;animation-delay:${delay.toFixed(1)}s"/>`,
      );
      continue;
    }

    const radius = 0.6 + random() * 1.1;
    const opacity = 0.12 + random() * 0.3;
    dust.push(`<circle cx="${coordinate(x)}" cy="${coordinate(y)}" r="${radius.toFixed(2)}" fill="#c8d6ff" opacity="${opacity.toFixed(2)}"/>`);
  }

  return [...dust, ...twinkles].join("\n      ");
}

function buildDateAxis(firstDate, lastDate) {
  const firstDay = dayNumber(firstDate);
  const span = Math.max(1, dayNumber(lastDate) - firstDay);
  const spansYears = firstDate.slice(0, 4) !== lastDate.slice(0, 4);

  if (span < 45) {
    return [0.08, 0.5, 0.92].map((fraction, index) => {
      const date = dateFromDayNumber(Math.round(firstDay + span * fraction));
      return { date, label: formatDateLabel(date, { day: true, year: index === 0 && spansYears }) };
    });
  }

  const months = [];
  const cursor = new Date(`${firstDate}T00:00:00Z`);
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.toISOString().slice(0, 10) < lastDate) {
    months.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const stride = Math.ceil(months.length / MAX_DATE_TICKS);
  return months.filter((_, index) => index % stride === 0).map((date, index) => ({ date, label: formatDateLabel(date, { year: index === 0 }) }));
}

export function renderSvg(series) {
  const { repository, points } = series;
  if (points.length < 2) {
    throw new Error("At least two data points are required to render the chart");
  }

  const first = points[0];
  const latest = points.at(-1);
  const firstDay = dayNumber(first.date);
  const daySpan = Math.max(1, dayNumber(latest.date) - firstDay);
  const plotWidth = PLOT_RIGHT - PLOT_LEFT;
  const plotHeight = BASELINE - PLOT_TOP;
  const yAxis = niceYAxis(Math.max(...points.map((point) => point.stars)));

  const x = (date) => PLOT_LEFT + ((dayNumber(date) - firstDay) / daySpan) * plotWidth;
  const y = (stars) => BASELINE - (stars / yAxis.maximum) * plotHeight;

  const curve = condensePoints(points).map((point) => [x(point.date), y(point.stars)]);
  const trendPath = monotoneCurve(curve);
  const areaPath = `${trendPath} L${coordinate(curve.at(-1)[0])} ${BASELINE} L${coordinate(curve[0][0])} ${BASELINE} Z`;
  const trendLength = Math.ceil(polylineLength(curve) * 1.08);

  const gridLines = [];
  for (let value = 0; value <= yAxis.maximum; value += yAxis.step) {
    const gridY = y(value);
    gridLines.push(`<line x1="${PLOT_LEFT}" y1="${coordinate(gridY)}" x2="${GRID_RIGHT}" y2="${coordinate(gridY)}" class="grid"/>`);
    if (Number.isInteger(value)) {
      gridLines.push(`<text x="${PLOT_LEFT - 14}" y="${coordinate(gridY + 4)}" text-anchor="end" class="axis-label">${formatCount(value)}</text>`);
    }
  }

  const dateLabels = buildDateAxis(first.date, latest.date).map(
    ({ date, label }) => `<text x="${coordinate(x(date))}" y="${AXIS_LABEL_Y}" text-anchor="middle" class="axis-label">${label}</text>`,
  );

  const endX = x(latest.date);
  const endY = y(latest.stars);
  const badgeLabel = `${formatCount(latest.stars)} stars`;
  const badgeWidth = Math.round(badgeLabel.length * 7.5 + 20);
  const badgeX = Math.min(endX - 14 - badgeWidth, PANEL_X + PANEL_WIDTH - badgeWidth - 12);
  const badgeY = Math.max(PANEL_Y + 8, endY - 38);
  const repositoryLabel = xmlEscape(repository);
  const updatedAt = xmlEscape(series.updatedAt || latest.date);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${RENDERED_WIDTH}" height="${Math.round((HEIGHT * RENDERED_WIDTH) / WIDTH)}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title description">
  <title id="title">${repositoryLabel} GitHub stars over time</title>
  <desc id="description">${repositoryLabel} reached ${formatCount(latest.stars)} GitHub stars on ${updatedAt}.</desc>
  <defs>
    <linearGradient id="plot" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#141f42"/>
      <stop offset="1" stop-color="#0a1024"/>
    </linearGradient>
    <linearGradient id="trend" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4f8dff"/>
      <stop offset="0.5" stop-color="#8fb0ff"/>
      <stop offset="0.79" stop-color="#e6d29a"/>
      <stop offset="1" stop-color="#ffcf6b"/>
    </linearGradient>
    <linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6b9cff" stop-opacity="0.36"/>
      <stop offset="1" stop-color="#6b9cff" stop-opacity="0.02"/>
    </linearGradient>
    <filter id="trendGlow" x="-6%" y="-40%" width="112%" height="180%">
      <feGaussianBlur stdDeviation="5"/>
    </filter>
    <filter id="headGlow" x="-150%" y="-150%" width="400%" height="400%">
      <feGaussianBlur stdDeviation="3.4" result="glow"/>
      <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="cardClip"><rect width="${WIDTH}" height="${HEIGHT}" rx="16"/></clipPath>
    <style>
      text { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .grid { stroke: #93a2cc; stroke-opacity: 0.18; stroke-width: 1; stroke-dasharray: 5 7; }
      .axis-label { fill: #97a3c4; font-size: 13px; }
      .twinkle { opacity: 0.55; transform-box: fill-box; transform-origin: center; animation: twinkle ease-in-out infinite; }
      .trend, .trend-glow { stroke-dasharray: ${trendLength}; animation: draw 2.1s cubic-bezier(0.22, 0.61, 0.36, 1) 1; }
      .satellite { transform-origin: 0 0; animation: spin 16s linear infinite; }
      @keyframes twinkle { 0%, 100% { opacity: 0.25; transform: scale(0.72); } 50% { opacity: 1; transform: scale(1.12); } }
      @keyframes draw { from { stroke-dashoffset: ${trendLength}; } to { stroke-dashoffset: 0; } }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .twinkle, .trend, .trend-glow, .satellite { animation: none; }
        .twinkle { opacity: 0.65; }
      }
    </style>
  </defs>
  <g clip-path="url(#cardClip)">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#080d1c"/>
    <rect x="${PANEL_X}" y="${PANEL_Y}" width="${PANEL_WIDTH}" height="${PANEL_HEIGHT}" rx="14" fill="url(#plot)"/>
    <g>
      ${renderStarfield(repository)}
    </g>
    <g>
      ${gridLines.join("\n      ")}
    </g>
    <path d="${areaPath}" fill="url(#trendArea)"/>
    <path class="trend-glow" d="${trendPath}" fill="none" stroke="url(#trend)" stroke-width="9" stroke-linecap="round" opacity="0.32" filter="url(#trendGlow)"/>
    <path class="trend" d="${trendPath}" fill="none" stroke="url(#trend)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g id="bookorbit-mark" transform="translate(22 20)" fill="none" stroke="#a9c8ff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20.341 6.484A10 10 0 0 1 10.266 21.85"/>
    <path d="M3.659 17.516A10 10 0 0 1 13.74 2.152"/>
    <circle cx="12" cy="12" r="3"/>
    <g transform="translate(12 12)">
      <g class="satellite">
        <circle cx="7" cy="-7" r="2" fill="#ffcf6b" stroke="#ffcf6b"/>
        <circle cx="-7" cy="7" r="2"/>
      </g>
    </g>
  </g>
  <text x="56" y="39" fill="#f1f5ff" font-size="17" font-weight="700">${repositoryLabel}</text>
  <text x="${WIDTH - 22}" y="39" text-anchor="end" fill="#8390b4" font-size="13">GitHub stars over time</text>
  ${dateLabels.join("\n  ")}
  <g id="current-total" transform="translate(${coordinate(badgeX)} ${coordinate(badgeY)})">
    <rect width="${badgeWidth}" height="26" rx="13" fill="#101835" stroke="#3b4a78"/>
    <text x="${badgeWidth / 2}" y="17.5" text-anchor="middle" fill="#ffcf6b" font-size="13.5" font-weight="700">${badgeLabel}</text>
  </g>
  <g id="current-coordinate" transform="translate(${coordinate(endX)} ${coordinate(endY)})">
    <path d="${fivePointStarPath(0, 0, 8.5)}" fill="#ffcf6b" filter="url(#headGlow)"/>
  </g>
  <text x="${WIDTH - 22}" y="${HEIGHT - 16}" text-anchor="end" fill="#5f6b8c" font-size="11.5">updated ${updatedAt}</text>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="16" fill="none" stroke="#232e4e"/>
</svg>
`;
}

function describeFallback(error) {
  if (error instanceof GitHubApiError) {
    const remaining = error.headers?.get?.("x-ratelimit-remaining");
    const rateLimit = remaining === "0" ? " Rate limit exhausted." : "";
    return `${error.message}.${rateLimit}`;
  }
  return error.message;
}

export async function updateSeries({ repository, existingSeries, exactToken, metadataToken, today = utcToday(), fetchImpl = fetch }) {
  repositoryApiPath(repository);

  if (exactToken) {
    try {
      const starDates = await fetchStarDates(repository, exactToken, { fetchImpl });
      return {
        schemaVersion: 1,
        repository,
        updatedAt: today,
        lastExactFetch: today,
        source: "exact",
        points: buildExactSeries(starDates, today),
      };
    } catch (error) {
      if (!existingSeries) throw error;
      console.warn(`Exact stargazer history is unavailable. ${describeFallback(error)}`);
    }
  }

  if (!existingSeries) {
    throw new Error("No stored series is available. Provide a bootstrap series or STAR_HISTORY_TOKEN.");
  }
  if (!metadataToken) {
    throw new Error("GITHUB_TOKEN is required to refresh the current star count");
  }

  const count = await fetchStarCount(repository, metadataToken, { fetchImpl });
  return {
    schemaVersion: 1,
    repository,
    updatedAt: today,
    ...(existingSeries.lastExactFetch ? { lastExactFetch: existingSeries.lastExactFetch } : {}),
    source: "snapshot",
    points: appendSnapshot(existingSeries.points, today, count),
  };
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const storedSeries = await loadSeries(options.seriesPath, options.repository);
  const bootstrapSeries = storedSeries || !options.bootstrapPath ? undefined : await loadSeries(options.bootstrapPath, options.repository);
  const existingSeries = storedSeries || bootstrapSeries;

  const series = await updateSeries({
    repository: options.repository,
    existingSeries,
    exactToken: process.env.STAR_HISTORY_TOKEN,
    metadataToken: process.env.GITHUB_TOKEN || process.env.STAR_HISTORY_TOKEN,
  });

  const svg = renderSvg(series);
  await saveSeries(options.seriesPath, series);
  await writeFileAtomically(options.outputPath, svg);

  console.log(
    `Wrote ${options.outputPath} with ${series.points.length} points and ${formatCount(series.points.at(-1).stars)} stars (${series.source})`,
  );
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entryPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
