import { vi } from 'vitest';

vi.mock('../src/modules/scanner/lib/stability', () => ({
  waitForStability: vi.fn().mockResolvedValue(undefined),
}));
