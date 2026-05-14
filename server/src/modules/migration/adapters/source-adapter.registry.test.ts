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
    const grimmoryAdapter = {
      type: 'grimmory',
      validate: vi.fn(),
      snapshot: vi.fn(),
      exportData: vi.fn(),
    };
    return {
      registry: new SourceAdapterRegistry(bookloreAdapter as never, grimmoryAdapter as never),
      bookloreAdapter,
      grimmoryAdapter,
    };
  }

  it('lists supported source types in sorted order', () => {
    const { registry } = makeRegistry();
    expect(registry.listTypes()).toEqual(['booklore', 'grimmory']);
  });

  it('retrieves adapter by normalized source type', () => {
    const { registry, bookloreAdapter, grimmoryAdapter } = makeRegistry();

    expect(registry.get('booklore')).toBe(bookloreAdapter);
    expect(registry.get('  BOOKLORE ')).toBe(bookloreAdapter);
    expect(registry.get('grimmory')).toBe(grimmoryAdapter);
    expect(registry.get('  GRIMMORY ')).toBe(grimmoryAdapter);
  });

  it('throws BadRequestException for unsupported source types', () => {
    const { registry } = makeRegistry();

    expect(() => registry.get('unknown')).toThrow(BadRequestException);
  });
});
