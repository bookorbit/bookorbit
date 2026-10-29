import type { Redaction } from "./protocol.js";

const MAX_LOG_VALUE_LENGTH = 500;

type LogValue = string | number | boolean | null | undefined;

/** Mirrors the server's sanitizeLogValue: one line, bounded, quotes escaped. */
export function sanitizeLogValue(value: unknown, maxLength = MAX_LOG_VALUE_LENGTH): string {
  return String(value)
    .replace(/[\r\n\t]/g, " ")
    .slice(0, maxLength)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

/** Replaces configured absolute folders (longest first) with placeholders such as <work> or <library>. */
export function redact(text: string, redactions: readonly Redaction[]): string {
  let result = text;
  const ordered = [...redactions].filter((entry) => entry.path.length > 1).sort((a, b) => b.path.length - a.path.length);
  for (const { path, placeholder } of ordered) result = result.split(path).join(placeholder);
  return result;
}

export function cleanMessage(text: string, redactions: readonly Redaction[], maxLength = MAX_LOG_VALUE_LENGTH): string {
  return redact(text, redactions)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function logLine(event: string, phase: "start" | "end" | "fail" | null, fields: Record<string, LogValue>, message: string): void {
  const parts = [`[${event}]`];
  if (phase) parts.push(`[${phase}]`);
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(typeof value === "string" && needsQuotes(key) ? `${key}="${sanitizeLogValue(value)}"` : `${key}=${formatValue(value)}`);
  }
  process.stdout.write(`${parts.join(" ")} - ${message.replace(/[\r\n]+/g, " ")}\n`);
}

function needsQuotes(key: string): boolean {
  return key === "error" || key === "message" || key === "path" || key === "reason";
}

function formatValue(value: LogValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return value.replace(/\s+/g, "_").slice(0, 200);
  return String(value);
}

export function errorClass(error: unknown): string {
  if (error instanceof Error) return error.name || error.constructor.name || "Error";
  return typeof error;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
