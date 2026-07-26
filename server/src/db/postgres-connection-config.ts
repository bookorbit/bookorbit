import type { PoolConfig } from 'pg';
import { parse, toClientConfig } from 'pg-connection-string';

export function createPostgresClientConfig(connectionString: string, overrides: PoolConfig = {}): PoolConfig {
  const parsed = parse(connectionString);
  const parsedConfig = toClientConfig(parsed);
  if (parsed.ssl === 'no-verify') {
    parsedConfig.ssl = { rejectUnauthorized: false };
  }

  const config = {
    ...overrides,
    ...parsedConfig,
  };

  if (!config.ssl || !config.host || (config.ssl !== true && typeof config.ssl !== 'object')) {
    return config;
  }

  return {
    ...config,
    ssl: {
      ...(typeof config.ssl === 'object' ? config.ssl : {}),
      host: config.host,
    },
  };
}
