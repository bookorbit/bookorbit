import { vi } from 'vitest';

vi.mock('../src/common/utils/fs-stability.utils', () => ({
  waitForStability: vi.fn().mockResolvedValue(undefined),
  waitForDirectoryStability: vi.fn().mockResolvedValue(undefined),
}));
