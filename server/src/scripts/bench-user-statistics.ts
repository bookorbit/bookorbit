import { JwtService } from '@nestjs/jwt';
import { Client } from 'pg';

import { createPostgresClientConfig } from '../db/postgres-connection-config';

type BenchCase = {
  name: string;
  path: string;
};

type BenchResult = {
  name: string;
  requests: number;
  p50Ms: number;
  p95Ms: number;
  avgMs: number;
  maxMs: number;
  failures: number;
  statusCounts: Record<string, number>;
};

const REQUESTS = Number.parseInt(process.env.BENCH_REQUESTS ?? '8', 10);
const WARMUP = Number.parseInt(process.env.BENCH_WARMUP ?? '1', 10);
const REQUEST_DELAY_MS = Number.parseInt(process.env.BENCH_REQUEST_DELAY_MS ?? '0', 10);
const MAX_429_RETRIES = Number.parseInt(process.env.BENCH_MAX_429_RETRIES ?? '2', 10);
const OUTPUT_PATH = process.env.BENCH_OUTPUT_PATH ?? '';
const BENCH_BASE_URL = process.env.BENCH_BASE_URL;
const CANDIDATE_BASE_URLS = ['http://localhost:3010', 'http://localhost:3000'];

const CASES: BenchCase[] = [
  { name: 'summary', path: '/api/v1/user-statistics/summary' },
  { name: 'heatmap-30d', path: '/api/v1/user-statistics/reading-heatmap?days=30' },
  { name: 'heatmap-90d', path: '/api/v1/user-statistics/reading-heatmap?days=90' },
  { name: 'heatmap-365d', path: '/api/v1/user-statistics/reading-heatmap?days=365' },
  { name: 'peak-hours-365d', path: '/api/v1/user-statistics/peak-hours?days=365' },
  { name: 'favorite-days-365d', path: '/api/v1/user-statistics/favorite-days?days=365' },
  { name: 'completion-timeline-365d', path: '/api/v1/user-statistics/completion-timeline?days=365' },
  { name: 'completion-timeline-1825d', path: '/api/v1/user-statistics/completion-timeline?days=1825' },
  { name: 'goal-trajectory-365d', path: '/api/v1/user-statistics/goal-trajectory?days=365&goalBooks=12' },
  { name: 'progress-funnel-365d', path: '/api/v1/user-statistics/progress-funnel?days=365' },
  { name: 'completion-latency-365d', path: '/api/v1/user-statistics/completion-latency?days=365' },
  { name: 'completion-latency-1825d', path: '/api/v1/user-statistics/completion-latency?days=1825' },
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, idx))];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return null;
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveBaseUrl(): Promise<string> {
  if (BENCH_BASE_URL) return normalizeBaseUrl(BENCH_BASE_URL);

  for (const candidate of CANDIDATE_BASE_URLS.map(normalizeBaseUrl)) {
    if (await isHealthy(candidate)) return candidate;
  }

  throw new Error('Could not detect a running API base URL. Set BENCH_BASE_URL (for example: http://localhost:3000).');
}

async function getBenchUser(): Promise<{ id: number; tokenVersion: number }> {
  if (process.env.BENCH_USER_ID && process.env.BENCH_USER_VER) {
    return {
      id: Number.parseInt(process.env.BENCH_USER_ID, 10),
      tokenVersion: Number.parseInt(process.env.BENCH_USER_VER, 10),
    };
  }

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (or BENCH_USER_ID/BENCH_USER_VER).');

  const client = new Client(createPostgresClientConfig(process.env.DATABASE_URL));
  await client.connect();
  try {
    const result = await client.query<{ id: number; token_version: number }>(
      'select id, token_version from users where active = true order by id asc limit 1',
    );
    const row = result.rows[0];
    if (!row) throw new Error('No active user found for benchmarking');
    return { id: row.id, tokenVersion: row.token_version };
  } finally {
    await client.end();
  }
}

function signToken(userId: number, tokenVersion: number): string {
  const secret = process.env.JWT_SECRET ?? 'change-me-in-production';
  const jwt = new JwtService({ secret, signOptions: { expiresIn: '30m' } });
  return jwt.sign({ sub: userId, ver: tokenVersion });
}

async function hit(url: string, token: string): Promise<{ ok: boolean; ms: number; status: number }> {
  let attempt = 0;
  while (true) {
    const startedAt = performance.now();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const ms = performance.now() - startedAt;

    if (response.status !== 429 || attempt >= MAX_429_RETRIES) {
      return { ok: response.ok, ms, status: response.status };
    }

    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after')) ?? Math.min(5000, 1000 * (attempt + 1));
    await sleep(retryAfterMs);
    attempt += 1;
  }
}

async function benchCase(testCase: BenchCase, token: string, baseUrl: string): Promise<BenchResult> {
  const url = `${baseUrl}${testCase.path}`;
  for (let i = 0; i < WARMUP; i += 1) {
    await hit(url, token);
  }

  const timings: number[] = [];
  let failures = 0;
  const statusCounts = new Map<number, number>();

  for (let i = 0; i < REQUESTS; i += 1) {
    const result = await hit(url, token);
    if (!result.ok) {
      failures += 1;
      statusCounts.set(result.status, (statusCounts.get(result.status) ?? 0) + 1);
    }
    timings.push(result.ms);
    if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const total = timings.reduce((acc, value) => acc + value, 0);

  return {
    name: testCase.name,
    requests: REQUESTS,
    p50Ms: Number(percentile(sorted, 50).toFixed(2)),
    p95Ms: Number(percentile(sorted, 95).toFixed(2)),
    avgMs: Number((total / timings.length).toFixed(2)),
    maxMs: Number(Math.max(...timings).toFixed(2)),
    failures,
    statusCounts: Object.fromEntries([...statusCounts.entries()].map(([status, count]) => [String(status), count])),
  };
}

async function main() {
  const baseUrl = await resolveBaseUrl();
  const benchUser = await getBenchUser();
  const token = signToken(benchUser.id, benchUser.tokenVersion);
  const results: BenchResult[] = [];

  for (const testCase of CASES) {
    const result = await benchCase(testCase, token, baseUrl);
    results.push(result);
    const statusSuffix = Object.keys(result.statusCounts).length > 0 ? ` statuses=${JSON.stringify(result.statusCounts)}` : '';
    console.log(
      `${result.name.padEnd(28)} p50=${result.p50Ms.toFixed(2)}ms p95=${result.p95Ms.toFixed(2)}ms avg=${result.avgMs.toFixed(2)}ms max=${result.maxMs.toFixed(2)}ms failures=${result.failures}${statusSuffix}`,
    );
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    requestsPerCase: REQUESTS,
    warmupPerCase: WARMUP,
    requestDelayMs: REQUEST_DELAY_MS,
    benchmarkUserId: benchUser.id,
    results,
  };

  if (OUTPUT_PATH) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`Wrote benchmark JSON to ${OUTPUT_PATH}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
