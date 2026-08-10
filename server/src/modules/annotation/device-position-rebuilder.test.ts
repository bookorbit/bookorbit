import { describe, expect, it, vi } from 'vitest';

import { DevicePositionRebuilderRegistry, type DevicePositionRebuilder } from './device-position-rebuilder';

function makeRebuilder(): DevicePositionRebuilder {
  return { rebuildCanonicalPositions: vi.fn().mockResolvedValue({ rebuilt: true }) };
}

describe('DevicePositionRebuilderRegistry', () => {
  it('reports no rebuilder until one registers', () => {
    expect(new DevicePositionRebuilderRegistry().get()).toBeNull();
  });

  it('returns the registered rebuilder', () => {
    const registry = new DevicePositionRebuilderRegistry();
    const rebuilder = makeRebuilder();

    registry.register(rebuilder);

    expect(registry.get()).toBe(rebuilder);
  });

  it('keeps the most recently registered rebuilder', () => {
    const registry = new DevicePositionRebuilderRegistry();
    const second = makeRebuilder();

    registry.register(makeRebuilder());
    registry.register(second);

    expect(registry.get()).toBe(second);
  });
});
