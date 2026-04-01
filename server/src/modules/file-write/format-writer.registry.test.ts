import { FormatWriterRegistry } from './format-writer.registry';

describe('FormatWriterRegistry', () => {
  it('normalizes format key lookups to lowercase', () => {
    const epub = { format: 'EPUB', write: vi.fn() };
    const pdf = { format: 'pdf', write: vi.fn() };

    const registry = new FormatWriterRegistry([epub, pdf] as never);

    expect(registry.supports('epub')).toBe(true);
    expect(registry.supports('EPUB')).toBe(true);
    expect(registry.get('Pdf')).toBe(pdf);
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('throws when duplicate format keys are registered', () => {
    const first = { format: 'cbz', write: vi.fn() };
    const second = { format: 'CBZ', write: vi.fn() };

    expect(() => new FormatWriterRegistry([first, second] as never)).toThrow('Duplicate format writer registered: cbz');
  });
});
