import { BadRequestException } from '@nestjs/common';

import { SourceAdapterRegistry } from './source-adapter.registry';

describe('SourceAdapterRegistry', () => {
  function makeRegistry() {
    const bookloreAdapter = {
      type: 'booklore',
      validate: vi.fn(),
      snapshot: vi.fn(),
      exportData: vi.fn(),
    };
    return {
      registry: new SourceAdapterRegistry(bookloreAdapter as never),
      bookloreAdapter,
    };
  }

  it('lists supported source types in sorted order', () => {
    const { registry } = makeRegistry();
    expect(registry.listTypes()).toEqual(['booklore']);
  });

  it('retrieves adapter by normalized source type', () => {
    const { registry, bookloreAdapter } = makeRegistry();

    expect(registry.get('booklore')).toBe(bookloreAdapter);
    expect(registry.get('  BOOKLORE ')).toBe(bookloreAdapter);
  });

  it('throws BadRequestException for unsupported source types', () => {
    const { registry } = makeRegistry();

    expect(() => registry.get('unknown')).toThrow(BadRequestException);
  });
});
