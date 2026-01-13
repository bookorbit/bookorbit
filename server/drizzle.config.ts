import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://projectx:projectx@postgres:5432/projectx',
  },
} satisfies Config;
