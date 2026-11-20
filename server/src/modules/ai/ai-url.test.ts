import { BadRequestException } from '@nestjs/common';
import { AI_PRESET_IDS, AI_PRESETS, aiEndpointUrl, detectAiConnection, type AiApiType } from '@bookorbit/types';

import { normaliseAiBaseUrl } from './ai-url';

describe('normaliseAiBaseUrl', () => {
  it.each<[string, AiApiType, string]>([
    // Presets as listed, unchanged.
    ['https://api.openai.com/v1', 'openai-responses', 'https://api.openai.com/v1'],
    ['https://api.anthropic.com', 'anthropic-messages', 'https://api.anthropic.com'],
    ['https://generativelanguage.googleapis.com/v1beta/openai', 'openai-chat', 'https://generativelanguage.googleapis.com/v1beta/openai'],
    ['https://openrouter.ai/api/v1', 'openai-chat', 'https://openrouter.ai/api/v1'],
    ['http://localhost:8317/v1', 'openai-chat', 'http://localhost:8317/v1'],
    ['http://localhost:11434/v1', 'openai-chat', 'http://localhost:11434/v1'],
    ['http://localhost:1234/v1', 'openai-chat', 'http://localhost:1234/v1'],
    ['http://localhost:8000/v1', 'openai-chat', 'http://localhost:8000/v1'],
    ['https://myres.openai.azure.com/openai/v1', 'openai-chat', 'https://myres.openai.azure.com/openai/v1'],
    // Pasted with a request path.
    ['https://api.example.com/v1/chat/completions', 'openai-chat', 'https://api.example.com/v1'],
    ['https://api.openai.com/v1/responses', 'openai-responses', 'https://api.openai.com/v1'],
    ['https://api.example.com/v1/models', 'openai-chat', 'https://api.example.com/v1'],
    ['https://api.anthropic.com/v1/messages', 'anthropic-messages', 'https://api.anthropic.com'],
    ['https://openrouter.ai/api/v1/chat/completions', 'openai-chat', 'https://openrouter.ai/api/v1'],
    // Trailing slashes, and with or without /v1.
    ['https://api.example.com/v1/', 'openai-chat', 'https://api.example.com/v1'],
    ['https://api.example.com', 'openai-chat', 'https://api.example.com/v1'],
    ['https://api.example.com/', 'openai-chat', 'https://api.example.com/v1'],
    ['http://localhost:11434', 'openai-chat', 'http://localhost:11434/v1'],
    ['http://192.168.1.20:1234/', 'openai-chat', 'http://192.168.1.20:1234/v1'],
    ['https://api.anthropic.com/v1', 'anthropic-messages', 'https://api.anthropic.com'],
    ['https://api.anthropic.com/v1/', 'anthropic-messages', 'https://api.anthropic.com'],
    ['https://openrouter.ai/api', 'openai-chat', 'https://openrouter.ai/api/v1'],
    ['https://openrouter.ai', 'openai-chat', 'https://openrouter.ai/api/v1'],
    // Anthropic Messages behind other hosts keeps their prefix.
    ['https://api.deepseek.com/anthropic', 'anthropic-messages', 'https://api.deepseek.com/anthropic'],
    ['https://api.deepseek.com/anthropic/v1/messages', 'anthropic-messages', 'https://api.deepseek.com/anthropic'],
    ['https://openrouter.ai/api/v1/messages', 'anthropic-messages', 'https://openrouter.ai/api'],
    ['http://localhost:8317/v1', 'anthropic-messages', 'http://localhost:8317'],
    // Rewrites.
    ['https://generativelanguage.googleapis.com', 'openai-chat', 'https://generativelanguage.googleapis.com/v1beta/openai'],
    [
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      'openai-chat',
      'https://generativelanguage.googleapis.com/v1beta/openai',
    ],
    ['https://myres.openai.azure.com', 'openai-chat', 'https://myres.openai.azure.com/openai/v1'],
    ['https://myres.openai.azure.com/openai/deployments/gpt/chat/completions', 'openai-chat', 'https://myres.openai.azure.com/openai/v1'],
    ['https://myres.services.ai.azure.com/', 'openai-chat', 'https://myres.services.ai.azure.com/openai/v1'],
    // Other versioned paths are kept.
    ['https://api.groq.com/openai/v1', 'openai-chat', 'https://api.groq.com/openai/v1'],
    ['https://example.com/proxy/v2', 'openai-chat', 'https://example.com/proxy/v2'],
    ['https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1', 'openai-chat', 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1'],
    // Query strings and fragments dropped; a missing scheme filled in.
    ['https://api.example.com/v1?foo=bar#x', 'openai-chat', 'https://api.example.com/v1'],
    ['localhost:11434', 'openai-chat', 'http://localhost:11434/v1'],
    ['api.example.com/v1', 'openai-chat', 'https://api.example.com/v1'],
    ['  https://api.example.com/v1  ', 'openai-chat', 'https://api.example.com/v1'],
  ])('%s as %s is %s', (raw, apiType, expected) => {
    expect(normaliseAiBaseUrl(raw, apiType)).toBe(expected);
  });

  it.each([
    ['ftp://example.com/v1', 'http or https'],
    ['https://user:secret@example.com/v1', 'not in the URL'],
    ['user:secret@example.com/v1', 'not in the URL'],
    ['', 'Enter the provider URL'],
    ['http://exa mple.com', 'Enter the provider URL'],
  ])('refuses %s', (raw, message) => {
    expect(() => normaliseAiBaseUrl(raw, 'openai-chat')).toThrow(BadRequestException);
    expect(() => normaliseAiBaseUrl(raw, 'openai-chat')).toThrow(message);
  });

  it('shows where each API type is called', () => {
    expect(aiEndpointUrl('https://api.anthropic.com', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/messages');
    expect(aiEndpointUrl('https://api.openai.com/v1', 'openai-responses')).toBe('https://api.openai.com/v1/responses');
    expect(aiEndpointUrl('http://localhost:11434/v1/', 'openai-chat')).toBe('http://localhost:11434/v1/chat/completions');
  });
});

describe('detectAiConnection', () => {
  it.each<[string, string, AiApiType, string]>([
    ['https://api.anthropic.com', 'anthropic', 'anthropic-messages', 'https://api.anthropic.com'],
    // Anthropic's OpenAI-style URL still points at Messages.
    ['https://api.anthropic.com/v1/', 'anthropic', 'anthropic-messages', 'https://api.anthropic.com'],
    ['https://api.anthropic.com/v1/chat/completions', 'anthropic', 'anthropic-messages', 'https://api.anthropic.com'],
    ['https://api.deepseek.com/anthropic', 'other', 'anthropic-messages', 'https://api.deepseek.com/anthropic'],
    ['https://api.openai.com/v1', 'openai', 'openai-responses', 'https://api.openai.com/v1'],
    ['https://api.openai.com/v1/chat/completions', 'openai', 'openai-responses', 'https://api.openai.com/v1'],
    ['https://generativelanguage.googleapis.com/', 'gemini', 'openai-chat', 'https://generativelanguage.googleapis.com/v1beta/openai'],
    ['https://contoso.openai.azure.com/', 'azure', 'openai-chat', 'https://contoso.openai.azure.com/openai/v1'],
    ['https://contoso.services.ai.azure.com/models', 'azure', 'openai-chat', 'https://contoso.services.ai.azure.com/openai/v1'],
    ['https://openrouter.ai/api/v1', 'openrouter', 'openai-chat', 'https://openrouter.ai/api/v1'],
    ['http://localhost:11434', 'ollama', 'openai-chat', 'http://localhost:11434/v1'],
    ['http://192.168.1.5:1234/v1', 'lmstudio', 'openai-chat', 'http://192.168.1.5:1234/v1'],
    ['http://gpu-box:8000/v1/chat/completions', 'vllm', 'openai-chat', 'http://gpu-box:8000/v1'],
    ['http://localhost:8317/v1', 'cliproxyapi', 'openai-chat', 'http://localhost:8317/v1'],
    // A pasted Messages or Responses endpoint names its API type.
    ['http://localhost:8317/v1/messages', 'cliproxyapi', 'anthropic-messages', 'http://localhost:8317'],
    ['http://localhost:11434/v1/messages', 'ollama', 'anthropic-messages', 'http://localhost:11434'],
    ['http://localhost:8317/v1/responses', 'cliproxyapi', 'openai-responses', 'http://localhost:8317/v1'],
    ['https://api.together.xyz/v1', 'other', 'openai-chat', 'https://api.together.xyz/v1'],
    ['https://api.deepseek.com', 'other', 'openai-chat', 'https://api.deepseek.com/v1'],
  ])('%s is %s over %s at %s', (raw, preset, apiType, baseUrl) => {
    expect(detectAiConnection(raw)).toEqual({ preset, apiType, baseUrl, keyOptional: AI_PRESETS[preset as keyof typeof AI_PRESETS].keyOptional });
  });

  it('marks the local runners and proxies as needing no key', () => {
    for (const raw of ['http://localhost:11434', 'http://localhost:1234', 'http://localhost:8000', 'http://localhost:8317']) {
      expect(detectAiConnection(raw)?.keyOptional).toBe(true);
    }
    expect(detectAiConnection('https://api.openai.com/v1')?.keyOptional).toBe(false);
  });

  it('never decides from anything but the URL', () => {
    expect(detectAiConnection('http://localhost:8317/v1')?.preset).toBe('cliproxyapi');
    expect(detectAiConnection('not a url at all')).toBeNull();
  });

  it('normalises every preset URL to itself', () => {
    for (const id of AI_PRESET_IDS) {
      const preset = AI_PRESETS[id];
      if (!preset.baseUrl || preset.baseUrl.includes('<')) continue;
      expect(normaliseAiBaseUrl(preset.baseUrl, preset.apiType)).toBe(preset.baseUrl);
      expect(detectAiConnection(preset.baseUrl)).toMatchObject({ preset: id, apiType: preset.apiType, baseUrl: preset.baseUrl });
    }
  });
});
