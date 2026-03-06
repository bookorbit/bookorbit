import { FORMAT_WRITERS } from './format-writer.interface';

describe('FORMAT_WRITERS token', () => {
  it('is a stable symbol for dependency injection', () => {
    expect(typeof FORMAT_WRITERS).toBe('symbol');
    expect(FORMAT_WRITERS.description).toBe('FORMAT_WRITERS');
  });
});
