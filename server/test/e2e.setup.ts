import { vi } from 'vitest';

vi.mock('../src/modules/scanner/lib/stability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/modules/scanner/lib/stability')>()),
  waitForStability: vi.fn().mockResolvedValue(undefined),
}));
