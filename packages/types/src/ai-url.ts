import type { AiApiType } from "./ai";

export const AI_PRESET_IDS = ["openai", "anthropic", "gemini", "openrouter", "cliproxyapi", "ollama", "lmstudio", "vllm", "azure", "other"] as const;
export type AiPresetId = (typeof AI_PRESET_IDS)[number];

export interface AiPreset {
  id: AiPresetId;
  /** Brand names are product names, shown as typed. */
  name: string;
  baseUrl: string;
  apiType: AiApiType;
  keyOptional: boolean;
  /** Extra headers to prefill, with a value only where it is not a secret. */
  headers: Array<{ name: string; value: string }>;
  /** Azure takes a deployment name where others take a model ID. */
  modelLabel: "model" | "deployment";
  /** True when the form shows a warning for this preset. */
  warning: boolean;
}

export const AI_PRESETS: Record<AiPresetId, AiPreset> = {
  openai: { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiType: "openai-responses", keyOptional: false, headers: [], modelLabel: "model", warning: false },
  anthropic: { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", apiType: "anthropic-messages", keyOptional: false, headers: [], modelLabel: "model", warning: true },
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiType: "openai-chat",
    keyOptional: false,
    headers: [],
    modelLabel: "model",
    warning: true,
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiType: "openai-chat",
    keyOptional: false,
    headers: [
      { name: "HTTP-Referer", value: "https://bookorbit.app" },
      { name: "X-Title", value: "BookOrbit" },
    ],
    modelLabel: "model",
    warning: true,
  },
  cliproxyapi: { id: "cliproxyapi", name: "CLIProxyAPI", baseUrl: "http://localhost:8317/v1", apiType: "openai-chat", keyOptional: true, headers: [], modelLabel: "model", warning: true },
  ollama: { id: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/v1", apiType: "openai-chat", keyOptional: true, headers: [], modelLabel: "model", warning: true },
  lmstudio: { id: "lmstudio", name: "LM Studio", baseUrl: "http://localhost:1234/v1", apiType: "openai-chat", keyOptional: true, headers: [], modelLabel: "model", warning: true },
  vllm: { id: "vllm", name: "vLLM", baseUrl: "http://localhost:8000/v1", apiType: "openai-chat", keyOptional: true, headers: [], modelLabel: "model", warning: false },
  azure: {
    id: "azure",
    name: "Azure OpenAI",
    baseUrl: "https://<resource>.openai.azure.com/openai/v1",
    apiType: "openai-chat",
    keyOptional: true,
    headers: [{ name: "api-key", value: "" }],
    modelLabel: "deployment",
    warning: true,
  },
  other: { id: "other", name: "Other", baseUrl: "", apiType: "openai-chat", keyOptional: true, headers: [], modelLabel: "model", warning: false },
};

const PORT_PRESETS: Record<string, AiPresetId> = { "11434": "ollama", "1234": "lmstudio", "8000": "vllm", "8317": "cliproxyapi" };

/** Request paths an admin may paste along with the base. Longest first. */
const ENDPOINT_SUFFIXES = ["/chat/completions", "/completions", "/responses", "/messages", "/models", "/embeddings"];

const VERSION_SEGMENT_RE = /\/v\d+(?:(?:alpha|beta)\d*)?$/i;

/** A URL as typed, with a scheme added when it has none. Null when it cannot be read as a URL. */
function parseLoose(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `${looksLocal(trimmed) ? "http" : "https"}://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function looksLocal(hostAndPath: string): boolean {
  const host = hostAndPath.split(/[/?#]/, 1)[0].toLowerCase();
  const name = host.replace(/:\d+$/, "");
  return (
    /:\d+$/.test(host) ||
    name === "localhost" ||
    name.endsWith(".local") ||
    name.endsWith(".lan") ||
    name.endsWith(".internal") ||
    /^(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(name) ||
    name.startsWith("[")
  );
}

function hostOf(url: URL): string {
  return url.hostname.toLowerCase();
}

function isAzureHost(host: string): boolean {
  return host.endsWith(".openai.azure.com") || host.endsWith(".services.ai.azure.com") || host.endsWith(".cognitiveservices.azure.com");
}

/** The path with any pasted endpoint and trailing slashes removed. */
function stripEndpoint(pathname: string): string {
  let path = pathname.replace(/\/+$/, "");
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of ENDPOINT_SUFFIXES) {
      if (path.toLowerCase().endsWith(suffix)) {
        path = path.slice(0, -suffix.length).replace(/\/+$/, "");
        changed = true;
      }
    }
  }
  return path;
}

/**
 * The base URL a connection stores, given what the admin typed and the API type.
 *
 * OpenAI-style types keep a version segment (`/v1`, `/api/v1`, `/v1beta/openai`, `/openai/v1`) and
 * gain `/v1` when there is none. Anthropic Messages stores the root without `/v1`, since the
 * adapter adds `/v1/messages`. Returns the input trimmed when it cannot be read as a URL, so the
 * caller's validation can say why.
 */
export function normaliseAiBaseUrl(raw: string, apiType: AiApiType): string {
  const url = parseLoose(raw);
  if (!url) return raw.trim();
  const host = hostOf(url);
  let path = stripEndpoint(url.pathname);

  if (apiType === "anthropic-messages") {
    path = path.replace(/\/v1$/i, "");
  } else if (host === "generativelanguage.googleapis.com") {
    path = "/v1beta/openai";
  } else if (isAzureHost(host)) {
    path = "/openai/v1";
  } else if (host === "openrouter.ai" && !/\/api\/v1$/i.test(path)) {
    path = "/api/v1";
  } else if (!VERSION_SEGMENT_RE.test(path)) {
    path = `${path}/v1`;
  }

  return `${url.protocol}//${url.host}${path}`;
}

/** The request URL a connection's base is called at, shown under the field. */
export function aiEndpointUrl(baseUrl: string, apiType: AiApiType): string {
  const base = baseUrl.replace(/\/+$/, "");
  switch (apiType) {
    case "anthropic-messages":
      return `${base}/v1/messages`;
    case "openai-responses":
      return `${base}/responses`;
    default:
      return `${base}/chat/completions`;
  }
}

export interface AiUrlDetection {
  preset: AiPresetId;
  apiType: AiApiType;
  baseUrl: string;
  keyOptional: boolean;
}

/**
 * The preset and API type for a pasted URL. Never guesses from a key's prefix: proxies issue keys
 * that start with `sk-` like OpenAI's.
 */
export function detectAiConnection(raw: string): AiUrlDetection | null {
  const url = parseLoose(raw);
  if (!url) return null;
  const host = hostOf(url);
  const pasted = url.pathname.replace(/\/+$/, "").toLowerCase();
  const path = stripEndpoint(url.pathname).replace(/\/v1$/i, "");

  let preset: AiPresetId = "other";
  let apiType: AiApiType = "openai-chat";
  if (host === "api.anthropic.com") {
    preset = "anthropic";
    apiType = "anthropic-messages";
  } else if (/\/anthropic$/i.test(path) || pasted.endsWith("/messages")) {
    // A pasted Messages endpoint names its own API type, whoever serves it.
    apiType = "anthropic-messages";
    preset = PORT_PRESETS[url.port] ?? "other";
  } else if (pasted.endsWith("/responses") && host !== "openrouter.ai") {
    apiType = "openai-responses";
    preset = host === "api.openai.com" ? "openai" : (PORT_PRESETS[url.port] ?? "other");
  } else if (host === "api.openai.com") {
    preset = "openai";
    apiType = "openai-responses";
  } else if (host === "generativelanguage.googleapis.com") {
    preset = "gemini";
  } else if (isAzureHost(host)) {
    preset = "azure";
  } else if (host === "openrouter.ai") {
    preset = "openrouter";
  } else {
    preset = PORT_PRESETS[url.port] ?? "other";
  }

  return {
    preset,
    apiType,
    baseUrl: normaliseAiBaseUrl(raw, apiType),
    keyOptional: AI_PRESETS[preset].keyOptional,
  };
}
