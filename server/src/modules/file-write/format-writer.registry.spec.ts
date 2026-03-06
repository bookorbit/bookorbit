import { FormatWriterRegistry } from './format-writer.registry';

describe('FormatWriterRegistry', () => {
  it('normalizes format key lookups to lowercase', () => {
    const epub = { format: 'EPUB', write: jest.fn() };
    const pdf = { format: 'pdf', write: jest.fn() };

    const registry = new FormatWriterRegistry([epub, pdf] as never);

    expect(registry.supports('epub')).toBe(true);
    expect(registry.supports('EPUB')).toBe(true);
    expect(registry.get('Pdf')).toBe(pdf);
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('keeps the last writer when duplicate format keys exist', () => {
    const first = { format: 'cbz', write: jest.fn() };
    const second = { format: 'CBZ', write: jest.fn() };

    const registry = new FormatWriterRegistry([first, second] as never);

    expect(registry.get('cbz')).toBe(second);
  });
});
