import { execFile as execFileCallback } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

import { providerRequestKey, recordProviderRequest, recordProviderRequestError } from '../../../../common/provider-cache/provider-call-context';

const execFile = promisify(execFileCallback);

const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_ATTEMPTS = 15;
const DEADLINE_BUFFER_MS = 1_000;
const MAX_REQUEST_TIMEOUT_SEC = 10;
const BUNDLED_PYTHON_PATH = '/opt/bookorbit-python/bin/python';
const LOCAL_PYTHON_PATH =
  process.platform === 'win32'
    ? join(process.cwd(), '.venv', 'kobo-cloudscraper', 'Scripts', 'python.exe')
    : join(process.cwd(), '.venv', 'kobo-cloudscraper', 'bin', 'python');

const CLOUDSCRAPER_SCRIPT = String.raw`
import json
import sys
import time

try:
    import cloudscraper
except Exception as exc:
    print(json.dumps({"errorClass": exc.__class__.__name__, "error": str(exc), "unavailable": True}), file=sys.stderr)
    sys.exit(2)

CHALLENGE_MARKERS = (
    "challenge-error-text",
    "challenge-form",
    "cf-chl",
    "cf_chl",
    "challenged | kobo.com",
)


def is_challenge_page(text, response):
    lowered = (text or "").lower()
    if response.headers.get("cf-mitigated", "").lower() == "challenge":
        return True
    return any(marker in lowered for marker in CHALLENGE_MARKERS)


def build_result(response, attempts):
    text = response.text or ""
    return {
        "status": response.status_code,
        "url": response.url,
        "headers": dict(response.headers),
        "html": text,
        "attempts": attempts,
        "challenge": is_challenge_page(text, response),
    }


def main():
    payload = json.loads(sys.argv[1])
    url = payload["url"]
    request_timeout = max(1, int(payload.get("requestTimeoutSec", 30)))
    deadline_seconds = max(1.0, float(payload.get("deadlineSec", request_timeout)))
    deadline_at = time.monotonic() + deadline_seconds
    max_attempts = max(1, int(payload.get("maxAttempts", 15)))

    scraper = cloudscraper.create_scraper(
        browser={
            "custom": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
        },
        interpreter="native",
        ecdhCurve="secp384r1",
    )

    last_result = None
    last_error = None
    for attempt in range(1, max_attempts + 1):
        remaining = deadline_at - time.monotonic()
        if remaining <= 1.0:
            last_error = last_error or {"errorClass": "KoboCloudscraperTimeout", "error": "cloudscraper deadline exceeded", "attempts": attempt - 1}
            break

        try:
            response = scraper.get(url, timeout=max(1.0, min(request_timeout, remaining - 0.5)))
            last_result = build_result(response, attempt)
            if response.status_code == 200 and not last_result["challenge"]:
                print(json.dumps(last_result))
                return
            if response.status_code == 429:
                print(json.dumps(last_result))
                return
        except Exception as exc:
            last_error = {"errorClass": exc.__class__.__name__, "error": str(exc), "attempts": attempt}

        if attempt < max_attempts:
            remaining = deadline_at - time.monotonic()
            if remaining <= 1.0:
                break
            time.sleep(min(1.0, remaining - 0.5))

    if last_result is not None:
        print(json.dumps(last_result))
        return

    print(json.dumps(last_error or {"errorClass": "KoboCloudscraperError", "error": "no response"}), file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"errorClass": exc.__class__.__name__, "error": str(exc)}), file=sys.stderr)
        sys.exit(1)
`;

export interface KoboCloudscraperFetchResult {
  status: number;
  url: string;
  headers: Record<string, string>;
  html: string;
  attempts: number;
  challenge: boolean;
}

export interface KoboCloudscraperFetchOptions {
  maxAttempts?: number;
  pythonPath?: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

type ExecFileError = Error & {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals;
  stderr?: string | Buffer;
  stdout?: string | Buffer;
};

export class KoboCloudscraperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KoboCloudscraperError';
  }
}

export class KoboCloudscraperUnavailableError extends KoboCloudscraperError {
  constructor(message: string) {
    super(message);
    this.name = 'KoboCloudscraperUnavailableError';
  }
}

export async function fetchKoboHtmlWithCloudscraper(url: string, options: KoboCloudscraperFetchOptions): Promise<KoboCloudscraperFetchResult> {
  const requestKey = providerRequestKey(url);
  try {
    const result = await runCloudscraper(url, options);
    recordProviderRequest(requestKey, { kind: 'status', status: result.status });
    return result;
  } catch (error) {
    recordProviderRequestError(requestKey, error);
    throw error;
  }
}

async function runCloudscraper(url: string, options: KoboCloudscraperFetchOptions): Promise<KoboCloudscraperFetchResult> {
  const deadlineSec = Math.max(1, Math.floor((options.timeoutMs - DEADLINE_BUFFER_MS) / 1000));
  const payload = JSON.stringify({
    url,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    requestTimeoutSec: Math.max(1, Math.min(MAX_REQUEST_TIMEOUT_SEC, Math.ceil(deadlineSec / 3))),
    deadlineSec,
  });
  const errors: string[] = [];

  for (const pythonPath of getPythonCandidates(options.pythonPath)) {
    try {
      const output = await execFile(pythonPath, ['-c', CLOUDSCRAPER_SCRIPT, payload], {
        maxBuffer: MAX_STDOUT_BYTES,
        signal: options.signal,
        timeout: options.timeoutMs,
        windowsHide: true,
      });
      return parseCloudscraperResult(getExecStdout(output));
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const message = formatExecError(error);
      if (isUnavailableError(error, message)) {
        errors.push(`${pythonPath}: ${message}`);
        continue;
      }

      throw new KoboCloudscraperError(message);
    }
  }

  throw new KoboCloudscraperUnavailableError(errors.length ? errors.join('; ') : 'python cloudscraper unavailable');
}

function getExecStdout(output: string | Buffer | { stdout: string | Buffer }): string | Buffer {
  if (typeof output === 'string' || Buffer.isBuffer(output)) {
    return output;
  }
  return output.stdout;
}

function getPythonCandidates(configuredPath: string | undefined): string[] {
  const candidates: string[] = [];
  if (configuredPath) {
    candidates.push(configuredPath);
  }
  if (existsSync(LOCAL_PYTHON_PATH)) {
    candidates.push(LOCAL_PYTHON_PATH);
  }
  if (existsSync(BUNDLED_PYTHON_PATH)) {
    candidates.push(BUNDLED_PYTHON_PATH);
  }
  candidates.push('python3', 'python');
  return [...new Set(candidates)];
}

function parseCloudscraperResult(stdout: string | Buffer): KoboCloudscraperFetchResult {
  const raw = stdout.toString();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new KoboCloudscraperError(`invalid cloudscraper output: ${message}`);
  }

  if (!isRecord(parsed)) {
    throw new KoboCloudscraperError('invalid cloudscraper output');
  }

  return {
    status: toNumber(parsed.status),
    url: toStringValue(parsed.url),
    headers: normalizeHeaders(parsed.headers),
    html: toStringValue(parsed.html),
    attempts: Math.max(1, toNumber(parsed.attempts)),
    challenge: Boolean(parsed.challenge),
  };
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value)) {
    headers[key.toLowerCase()] = String(headerValue);
  }
  return headers;
}

function formatExecError(error: unknown): string {
  const execError = error as ExecFileError;
  const stderr = execError.stderr?.toString().trim();
  if (stderr) {
    try {
      const parsed = JSON.parse(stderr) as unknown;
      if (isRecord(parsed)) {
        const errorClass = toStringValue(parsed.errorClass) || 'PythonError';
        const message = toStringValue(parsed.error) || 'cloudscraper failed';
        return `${errorClass}: ${message}`;
      }
    } catch {
      return stderr;
    }
    return stderr;
  }
  if (execError.killed || execError.code === 'ETIMEDOUT') {
    return 'cloudscraper timed out';
  }
  return error instanceof Error ? error.message : String(error);
}

function isUnavailableError(error: unknown, message: string): boolean {
  const execError = error as ExecFileError;
  return execError.code === 'ENOENT' || /No module named ['"]cloudscraper['"]/.test(message);
}

function isAbortError(error: unknown): boolean {
  const execError = error as ExecFileError;
  return execError.name === 'AbortError' || execError.code === 'ABORT_ERR';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
